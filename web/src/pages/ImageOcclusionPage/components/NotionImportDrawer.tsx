import { startTransition, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get2ankiApi } from '../../../lib/backend/get2ankiApi';
import NotionObject from '../../../lib/interfaces/NotionObject';
import { BlockIcon } from '../../SearchPage/components/BlockIcon';
import sharedStyles from '../../../styles/shared.module.css';
import styles from '../ImageOcclusionPage.module.css';
import { FREE_TIER_LIMIT } from '../freeTier';

interface NotionImageBlock {
  id: string;
  type: 'image';
  image: {
    type: 'external' | 'file';
    external?: { url: string };
    file?: { url: string };
    caption?: Array<{ plain_text: string }>;
  };
}

interface NotionChildPageBlock {
  id: string;
  type: 'child_page';
  child_page: { title: string };
}

type NotionBlock =
  | NotionImageBlock
  | NotionChildPageBlock
  | { id: string; type: string; has_children?: boolean };

interface GalleryItem {
  blockId: string;
  imageUrl: string;
  caption: string;
}

interface PageSection {
  id: string;
  title: string;
  icon?: string;
  images: GalleryItem[];
  loading: boolean;
  error: { isPermission: boolean } | null;
  showAll: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImport: (blockIds: string[]) => Promise<void>;
  isPaying: boolean;
  currentCount: number;
}

const PREVIEW_COUNT = 6;
const FETCH_CONCURRENCY = 6;

interface Sem {
  acquire(): Promise<void>;
  release(): void;
}

function makeSem(limit: number): Sem {
  let active = 0;
  const queue: Array<() => void> = [];
  return {
    acquire() {
      return new Promise<void>((resolve) => {
        if (active < limit) {
          active++;
          resolve();
        } else {
          queue.push(resolve);
        }
      });
    },
    release() {
      active--;
      const next = queue.shift();
      if (next) {
        active++;
        next();
      }
    },
  };
}

function getImageUrl(block: NotionImageBlock): string | null {
  if (block.image.type === 'file') return block.image.file?.url ?? null;
  if (block.image.type === 'external') return block.image.external?.url ?? null;
  return null;
}

interface FetchResult {
  images: GalleryItem[];
  childPages: Array<{ id: string; title: string }>;
  error: { isPermission: boolean } | null;
}

async function fetchBlocks(
  blockId: string,
  signal: AbortSignal,
  sem: Sem
): Promise<FetchResult> {
  await sem.acquire();
  let res: Response;
  try {
    res = await fetch(`/api/notion/blocks/${blockId}`, {
      credentials: 'include',
      signal,
    });
  } finally {
    sem.release();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const isPermission =
      res.status === 400 &&
      (body.includes('object_not_found') ||
        body.includes('not_found') ||
        body.includes('shared'));
    return { images: [], childPages: [], error: { isPermission } };
  }
  const data = (await res.json()) as
    | { results?: NotionBlock[] }
    | NotionBlock[];
  const blocks = Array.isArray(data) ? data : (data.results ?? []);

  const images: GalleryItem[] = [];
  const childPages: Array<{ id: string; title: string }> = [];
  const containerFetches: Promise<FetchResult>[] = [];

  for (const block of blocks) {
    if (block.type === 'image') {
      const url = getImageUrl(block as NotionImageBlock);
      if (url != null) {
        const caption =
          (block as NotionImageBlock).image.caption
            ?.map((c) => c.plain_text)
            .join('') ?? '';
        images.push({ blockId: block.id, imageUrl: url, caption });
      }
    } else if (block.type === 'child_page') {
      const title = (block as NotionChildPageBlock).child_page.title || '';
      childPages.push({ id: block.id, title });
    } else if (
      block.type !== 'child_database' &&
      (block as { has_children?: boolean }).has_children === true
    ) {
      // toggles, columns, callouts, synced blocks, etc. — recurse to find nested images
      containerFetches.push(fetchBlocks(block.id, signal, sem));
    }
  }

  if (containerFetches.length > 0) {
    const nested = await Promise.all(containerFetches);
    for (const r of nested) {
      images.push(...r.images);
      childPages.push(...r.childPages);
    }
  }

  const seenBlockIds = new Set<string>();
  const dedupedImages = images.filter((item) => {
    if (seenBlockIds.has(item.blockId)) return false;
    seenBlockIds.add(item.blockId);
    return true;
  });

  return { images: dedupedImages, childPages, error: null };
}

export function NotionImportDrawer({
  isOpen,
  onClose,
  onImport,
  isPaying,
  currentCount,
}: Readonly<Props>) {
  const { t } = useTranslation('tools');
  const [sections, setSections] = useState<PageSection[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const seenImageIds = useRef<Set<string>>(new Set());
  const pendingRef = useRef(0);
  const semRef = useRef<Sem>(makeSem(FETCH_CONCURRENCY));
  const [anyPending, setAnyPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const freeSlotsLeft = isPaying
    ? Infinity
    : Math.max(0, FREE_TIER_LIMIT - currentCount);
  const atFreeTierCap = !isPaying && currentCount >= FREE_TIER_LIMIT;

  const crawlPage = (
    id: string,
    title: string,
    icon: string | undefined,
    signal: AbortSignal
  ) => {
    if (seenIds.current.has(id)) return;
    seenIds.current.add(id);

    pendingRef.current += 1;
    setAnyPending(true);

    fetchBlocks(id, signal, semRef.current)
      .then((result) => {
        if (signal.aborted) return;

        const uniqueImages = result.images.filter((item) => {
          if (seenImageIds.current.has(item.blockId)) return false;
          seenImageIds.current.add(item.blockId);
          return true;
        });

        if (uniqueImages.length > 0 || result.error != null) {
          startTransition(() => {
            setSections((prev) => [
              ...prev,
              {
                id,
                title:
                  title.trim().length > 0 ? title : t('occlusion.untitledPage'),
                icon,
                images: uniqueImages,
                loading: false,
                error: result.error,
                showAll: false,
              },
            ]);
          });
        }

        if (result.error == null) {
          for (const child of result.childPages) {
            crawlPage(child.id, child.title, undefined, signal);
          }
        }
      })
      .catch(() => {
        // silently drop network errors mid-crawl
      })
      .finally(() => {
        if (signal.aborted) return;
        pendingRef.current -= 1;
        if (pendingRef.current === 0) {
          startTransition(() => setAnyPending(false));
        }
      });
  };

  const startCrawl = (controller: AbortController) => {
    seenIds.current = new Set();
    seenImageIds.current = new Set();
    pendingRef.current = 0;
    semRef.current = makeSem(FETCH_CONCURRENCY);
    setSections([]);
    setAnyPending(false);
    setPagesLoading(true);
    setPagesError(null);

    get2ankiApi()
      .searchTopLevelPages('')
      .then((pages) => {
        if (controller.signal.aborted) return;
        setPagesLoading(false);
        setTimeout(() => searchRef.current?.focus(), 50);
        for (const page of pages) {
          crawlPage(page.id, page.title || '', page.icon, controller.signal);
        }
      })
      .catch((err: Error) => {
        if (controller.signal.aborted) return;
        setPagesError(err.message);
        setPagesLoading(false);
      });
  };

  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setSelected(new Set());
    const controller = new AbortController();
    abortRef.current = controller;
    startCrawl(controller);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const toggleImage = (blockId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else if (isPaying || next.size < freeSlotsLeft) {
        next.add(blockId);
      }
      return next;
    });
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      await onImport(Array.from(selected));
      onClose();
    } finally {
      setImporting(false);
    }
  };

  if (!isOpen) return null;

  const visibleSections = sections
    .filter(
      (s) => s.images.length > 0 || (s.error != null && !s.error.isPermission)
    )
    .filter(
      (s) =>
        search.trim() === '' ||
        s.title.toLowerCase().includes(search.toLowerCase())
    );

  const stillLoading = pagesLoading || anyPending;

  const addLabel =
    selected.size === 0
      ? t('occlusion.selectImagesToAdd')
      : t('occlusion.addImagesCount', { count: selected.size });

  return (
    <div
      className={styles.drawer}
      role="dialog"
      aria-modal="true"
      aria-label={t('occlusion.importFromNotion')}
    >
      <div className={styles.drawerHeader}>
        <span className={styles.drawerTitle}>
          {t('occlusion.importFromNotion')}
        </span>
        <button
          type="button"
          className={styles.drawerCloseBtn}
          onClick={onClose}
          aria-label={t('occlusion.close')}
        >
          ×
        </button>
      </div>

      <div className={styles.drawerBody}>
        {pagesError != null && (
          <div className={styles.drawerEmpty}>
            <p>{t('occlusion.reachNotionError')}</p>
            <button
              type="button"
              className={styles.drawerRetryBtn}
              onClick={() => {
                abortRef.current?.abort();
                const controller = new AbortController();
                abortRef.current = controller;
                startCrawl(controller);
              }}
            >
              {t('occlusion.tryAgain')}
            </button>
          </div>
        )}

        {!pagesLoading &&
          pagesError == null &&
          visibleSections.length === 0 &&
          !stillLoading && (
            <div className={styles.drawerEmpty}>
              {search.trim().length > 0 ? (
                <p>
                  {t('occlusion.noPagesMatchPre')}
                  <strong>{search}</strong>
                  {t('occlusion.noPagesMatchPost')}
                </p>
              ) : (
                <>
                  <p>{t('occlusion.noImagesFound')}</p>
                  <p>{t('occlusion.sharePageHint')}</p>
                </>
              )}
            </div>
          )}

        {(visibleSections.length > 0 || stillLoading) && (
          <>
            {visibleSections.length > 0 && (
              <div
                className={`${sharedStyles.searchBarGroup} ${styles.drawerSearchBar}`}
              >
                <input
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('occlusion.searchPages')}
                  aria-label={t('occlusion.searchPages')}
                />
              </div>
            )}

            {atFreeTierCap && (
              <p className={styles.drawerFreeTierNote}>
                {t('occlusion.drawerFreeTier')}{' '}
                <a href="/pricing" className={styles.drawerUpgradeLink}>
                  {t('occlusion.upgradeForUnlimited')}
                </a>
              </p>
            )}

            <div className={styles.gallerySections}>
              {visibleSections.map((section) => {
                const visible = section.showAll
                  ? section.images
                  : section.images.slice(0, PREVIEW_COUNT);
                const hiddenCount = section.images.length - PREVIEW_COUNT;

                return (
                  <div key={section.id} className={styles.gallerySection}>
                    <div className={styles.gallerySectionHeader}>
                      {section.icon != null && (
                        <span className={styles.gallerySectionIcon}>
                          <BlockIcon icon={section.icon} />
                        </span>
                      )}
                      <span className={styles.gallerySectionTitle}>
                        {section.title}
                      </span>
                    </div>

                    {section.loading && (
                      <div className={styles.galleryGrid}>
                        {Array.from({ length: PREVIEW_COUNT }).map((_, i) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <div
                            key={i}
                            className={styles.gallerySkeletonTile}
                            aria-hidden="true"
                          />
                        ))}
                      </div>
                    )}

                    {section.error != null && (
                      <p className={styles.gallerySectionError}>
                        {section.error.isPermission
                          ? t('occlusion.notSharedError')
                          : t('occlusion.couldntLoadImages')}
                      </p>
                    )}

                    {visible.length > 0 && (
                      <div className={styles.galleryGrid}>
                        {visible.map((item) => {
                          const isSelected = selected.has(item.blockId);
                          const atLimit =
                            !isPaying &&
                            !isSelected &&
                            selected.size >= freeSlotsLeft;
                          return (
                            <button
                              key={item.blockId}
                              type="button"
                              className={`${styles.galleryTile} ${isSelected ? styles.galleryTileSelected : ''}`}
                              onClick={() =>
                                !atLimit && toggleImage(item.blockId)
                              }
                              disabled={atLimit && !isSelected}
                              aria-pressed={isSelected}
                              title={item.caption || undefined}
                            >
                              <img
                                src={item.imageUrl}
                                alt={
                                  item.caption || t('occlusion.notionImageAlt')
                                }
                                className={styles.galleryTileImg}
                                loading="lazy"
                                decoding="async"
                              />
                              {isSelected && (
                                <span className={styles.galleryCheckBadge}>
                                  ✓
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {!section.showAll && hiddenCount > 0 && (
                      <button
                        type="button"
                        className={styles.galleryShowMore}
                        onClick={() =>
                          setSections((prev) =>
                            prev.map((s) =>
                              s.id === section.id ? { ...s, showAll: true } : s
                            )
                          )
                        }
                      >
                        {t('occlusion.showMore', { count: hiddenCount })}
                      </button>
                    )}
                  </div>
                );
              })}

              {stillLoading && (
                <div
                  className={styles.gallerySection}
                  aria-label={t('occlusion.loadingMorePages')}
                >
                  <div
                    className={styles.gallerySectionHeaderSkeleton}
                    aria-hidden="true"
                  />
                  <div className={styles.galleryGrid}>
                    {Array.from({ length: PREVIEW_COUNT }).map((_, i) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <div
                        key={i}
                        className={styles.gallerySkeletonTile}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className={styles.drawerFooter}>
        <button
          type="button"
          className={styles.drawerImportBtn}
          onClick={handleImport}
          disabled={selected.size === 0 || importing || atFreeTierCap}
        >
          {importing ? t('occlusion.importing') : addLabel}
        </button>
        <button
          type="button"
          className={styles.drawerCancelBtn}
          onClick={onClose}
        >
          {t('occlusion.cancel')}
        </button>
      </div>
    </div>
  );
}
