import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { ErrorPresenter } from '../../components/errors/ErrorPresenter';
import { ErrorHandlerType } from '../../components/errors/helpers/getErrorMessage';
import { SkeletonList } from '../../components/Skeleton/Skeleton';
import sharedStyles from '../../styles/shared.module.css';
import styles from './PreviewApkgPage.module.css';
import {
  useApkgPreviewMeta,
  useApkgPreviewStream,
} from './useApkgPreviewStream';
import { CardFrame } from './CardFrame';
import { SharePopover } from './SharePopover';
import {
  CardEditState,
  toEditPayloads,
  withEditMapEntry,
} from './cardEditTypes';
import { downloadEditedApkg } from './downloadEditedApkg';
import { isFinalRefusal } from '../../lib/shouldRetryQuery';

function indent(depth: number): string {
  if (depth <= 0) return '';
  return `${'  '.repeat(depth)}↳ `;
}

interface PreviewApkgPageProps {
  setError: ErrorHandlerType;
}

export default function PreviewApkgPage({
  setError,
}: Readonly<PreviewApkgPageProps>) {
  const { t } = useTranslation('previews');
  const { key } = useParams<{ key: string }>();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [deckId, setDeckId] = useState<number | null>(null);
  const [editMap, setEditMap] = useState<Map<number, CardEditState>>(new Map());
  const [downloading, setDownloading] = useState(false);

  const meta = useApkgPreviewMeta(key);
  const stream = useApkgPreviewStream(key, deckId);

  const fatal = stream.error != null && !stream.data;

  const hasCards = stream.data != null;

  useEffect(() => {
    if (!hasCards) return;
    const firstError = stream.error ?? meta.error;
    if (firstError) setError(firstError);
  }, [hasCards, stream.error, meta.error, setError]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const node = sentinelRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          stream.hasNextPage &&
          !stream.isFetchingNextPage
        ) {
          stream.fetchNextPage();
        }
      },
      { rootMargin: '400px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [stream]);

  useEffect(() => {
    const hasEdits = editMap.size > 0;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    if (hasEdits) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [editMap]);

  const cards = useMemo(
    () => stream.data?.pages.flatMap((page) => page.cards) ?? [],
    [stream.data]
  );

  const { deletedCount, suspendedCount } = useMemo(() => {
    let deleted = 0;
    let suspended = 0;
    Array.from(editMap.values()).forEach((state) => {
      if (state.deleted) deleted++;
      if (state.suspended && !state.deleted) suspended++;
    });
    return { deletedCount: deleted, suspendedCount: suspended };
  }, [editMap]);

  const handleEdit = useCallback((cardId: number, state: CardEditState) => {
    setEditMap((prev) => withEditMapEntry(prev, cardId, state));
  }, []);

  const handleRestoreAll = useCallback(() => {
    setEditMap(new Map());
  }, []);

  async function handleDownload() {
    if (!key) return;
    setDownloading(true);
    try {
      await downloadEditedApkg(key, toEditPayloads(editMap));
    } catch (err) {
      setError(err as Error);
    } finally {
      setDownloading(false);
    }
  }

  if (!key) {
    return (
      <div className={sharedStyles.page}>
        <p className={styles.empty}>{t('apkg.missingId')}</p>
      </div>
    );
  }

  if (fatal) {
    return (
      <div className={sharedStyles.page}>
        <header className={sharedStyles.pageHeader}>
          <Link to="/downloads" className={styles.backLink}>
            {t('apkg.backToDownloads')}
          </Link>
          <h1 className={sharedStyles.title}>{t('apkg.previewTitle')}</h1>
        </header>
        <ErrorPresenter
          error={stream.error}
          onRetry={
            isFinalRefusal(stream.error) ? undefined : () => stream.refetch()
          }
        />
      </div>
    );
  }

  const filteredTotal = stream.data?.pages[0]?.total;
  const totalAll = meta.data?.totalCards ?? 0;
  const loadedCount = cards.length;
  const decks = Array.isArray(meta.data?.decks) ? meta.data.decks : [];
  const selectedDeck = decks.find((d) => d.id === deckId) ?? null;
  const isApkgKey = key.endsWith('.apkg');
  const hasEdits = editMap.size > 0;
  const activeCards = totalAll - deletedCount;

  return (
    <div className={sharedStyles.page}>
      <header className={sharedStyles.pageHeader}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '0.5rem',
          }}
        >
          <Link to="/downloads" className={styles.backLink}>
            {t('apkg.backToDownloads')}
          </Link>
          {isApkgKey && <SharePopover uploadKey={key} />}
        </div>
        <h1 className={sharedStyles.title} data-hj-suppress>
          {t('apkg.deckPreview')}
        </h1>
        <p className={styles.summary}>
          {selectedDeck ? (
            <>
              {selectedDeck.fullName} ·{' '}
              {t('apkg.cardsLoaded', {
                loaded: loadedCount,
                total: filteredTotal ?? selectedDeck.cardCount,
              })}
            </>
          ) : (
            <>
              {decks.length > 1
                ? `${t('apkg.decksCount', { count: decks.length })} · `
                : ''}
              {totalAll === 0
                ? t('apkg.loadingDeck')
                : t('apkg.cardsLoaded', {
                    loaded: loadedCount,
                    total: totalAll,
                  })}
            </>
          )}
        </p>
        {decks.length > 1 && (
          <label className={styles.deckFilter}>
            <span>{t('apkg.deckLabel')}</span>
            <select
              value={deckId ?? ''}
              onChange={(event) => {
                const raw = event.target.value;
                setDeckId(raw === '' ? null : Number.parseInt(raw, 10));
              }}
            >
              <option value="">
                {t('apkg.allDecks', { count: totalAll })}
              </option>
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {indent(Math.max(0, deck.path.length - 1))}
                  {deck.path[deck.path.length - 1] ?? deck.fullName} (
                  {deck.cardCount})
                </option>
              ))}
            </select>
          </label>
        )}
        {isApkgKey && totalAll > 0 && (
          <div className={styles.editStrip}>
            <span>
              <span className={styles.editStripCount}>{totalAll}</span>{' '}
              {t('apkg.cardsWord', { count: totalAll })}
              {deletedCount > 0 && (
                <>
                  {' · '}
                  <span className={styles.editStripCount}>
                    {deletedCount}
                  </span>{' '}
                  {t('apkg.deleted')}
                </>
              )}
              {suspendedCount > 0 && (
                <>
                  {' · '}
                  <span className={styles.editStripCount}>
                    {suspendedCount}
                  </span>{' '}
                  {t('apkg.suspended')}
                </>
              )}
            </span>
            {hasEdits && (
              <button
                type="button"
                className={styles.restoreButton}
                onClick={handleRestoreAll}
              >
                {t('apkg.restoreAll')}
              </button>
            )}
            <button
              type="button"
              className={styles.downloadButton}
              onClick={handleDownload}
              disabled={downloading}
            >
              {hasEdits
                ? t('apkg.downloadDeckCount', { count: activeCards })
                : t('apkg.downloadDeck')}
            </button>
          </div>
        )}
      </header>

      {stream.isLoading && cards.length === 0 ? (
        <SkeletonList count={4} />
      ) : (
        <div className={styles.cards}>
          {cards.length === 0 && (
            <EmptyState
              title={t('apkg.emptyTitle')}
              description={t('apkg.emptyDescription')}
            />
          )}
          {cards.map((card) => (
            <CardFrame
              key={card.id}
              card={card}
              editState={editMap.get(card.id)}
              onEdit={handleEdit}
              isEditable={isApkgKey}
            />
          ))}
        </div>
      )}

      <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />

      {stream.isFetchingNextPage && (
        <div className={styles.loadingRow}>{t('apkg.loadingMoreCards')}</div>
      )}
    </div>
  );
}
