import {
  Fragment,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatDistanceToNow } from 'date-fns';

import sharedStyles from '../../../styles/shared.module.css';
import styles from '../AnkifyPage.module.css';
import { get2ankiApi } from '../../../lib/backend/get2ankiApi';
import { Backend } from '../../../lib/backend/Backend';
import NotionPagePicker from './NotionPagePicker';
import LeechesPanel from './LeechesPanel';
import ReviewPanel from './ReviewPanel';
import DotsHorizontal from '../../../components/icons/DotsHorizontal';
import { BlockIcon } from '../../SearchPage/components/BlockIcon';
import { mapSubscribeError } from './mapSubscribeError';
import { useAnkifyStats } from '../stats/useAnkifyStats';
import { buildDeckName } from '../lib/deckName';
import {
  formatBacklog,
  formatMaturity,
  sumDeckBacklog,
} from '../lib/deckBacklog';
import { useDeckMaturity } from '../lib/useDeckMaturity';
import { AnkifyStatsDeck } from '../stats/types';
import {
  DeckSortKey,
  isDeckSortKey,
  readStoredDeckSort,
  sortDecks,
  writeStoredDeckSort,
} from '../lib/deckSort';
import { track } from '../../../lib/analytics/track';

const formatRelativeTime = (iso: string | null | undefined): string | null => {
  if (iso == null || iso.length === 0) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDistanceToNow(parsed, { addSuffix: true });
};

type Schedule = Awaited<ReturnType<Backend['getAnkifyExportSchedule']>>;

interface Props {
  readonly backend?: Backend;
  readonly schedule?: Schedule;
  readonly onTabChange?: (tab: 'decks' | 'find' | 'leeches' | 'review') => void;
}

const formatScheduleTime = (
  timeOfDay: string,
  timezone: string
): string | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(timeOfDay);
  if (match == null) return null;
  const targetHours = Number(match[1]);
  const targetMinutes = Number(match[2]);
  const sample = new Date();
  sample.setUTCHours(targetHours, targetMinutes, 0, 0);
  const probe = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    probe
      .formatToParts(sample)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  const seenHours = Number(parts.hour);
  const seenMinutes = Number(parts.minute);
  if (Number.isNaN(seenHours) || Number.isNaN(seenMinutes)) return null;
  const diffMinutes =
    targetHours * 60 + targetMinutes - (seenHours * 60 + seenMinutes);
  const adjusted = new Date(sample.getTime() + diffMinutes * 60_000);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(adjusted);
};

const SUBSCRIPTIONS_KEY = ['ankify-subscriptions'];
const CONFLICTS_KEY = ['ankify-conflicts'];
const SEARCH_THRESHOLD = 8;
const FLASH_DURATION_MS = 4_000;
const EMPTY_DECKS: AnkifyStatsDeck[] = [];

interface RowFlash {
  kind: 'success' | 'error' | 'conflict';
  text: string;
}

interface ZeroDiagnostic {
  blocks_scanned: number;
  blocks_matched: number;
  unmatched_samples?: string[];
}

const buildSuccessFlash = (
  result: {
    created: number;
    updated: number;
    conflicts: number;
    diagnostic: ZeroDiagnostic | null | undefined;
  },
  t: TFunction
): RowFlash => {
  if (result.conflicts > 0) {
    return {
      kind: 'conflict',
      text: t('subscriptions.flash.needsDecision'),
    };
  }
  if (result.created + result.updated === 0) {
    if (result.diagnostic != null && result.diagnostic.blocks_matched === 0) {
      return { kind: 'success', text: t('subscriptions.flash.noPatterns') };
    }
    return { kind: 'success', text: t('subscriptions.flash.upToDate') };
  }
  if (result.updated === 0) {
    return {
      kind: 'success',
      text: t('subscriptions.flash.updatedNew', { count: result.created }),
    };
  }
  if (result.created === 0) {
    return {
      kind: 'success',
      text: t('subscriptions.flash.updatedChanged', { count: result.updated }),
    };
  }
  return {
    kind: 'success',
    text: t('subscriptions.flash.updatedBoth', {
      created: result.created,
      updated: result.updated,
    }),
  };
};

const extractZeroDiagnostic = (result: {
  created: number;
  updated: number;
  conflicts: number;
  diagnostic: ZeroDiagnostic | null | undefined;
}): ZeroDiagnostic | null => {
  if (result.created + result.updated + result.conflicts > 0) {
    return null;
  }
  if (result.diagnostic == null) {
    return null;
  }
  if (result.diagnostic.blocks_matched > 0) {
    return null;
  }
  return result.diagnostic;
};

const errorFlashFor = (
  error: Error & {
    status?: number;
    retryAfterSeconds?: number;
  },
  t: TFunction
): RowFlash => {
  if (error.status === 429 && error.retryAfterSeconds != null) {
    return {
      kind: 'error',
      text: t('subscriptions.flash.retryIn', {
        seconds: error.retryAfterSeconds,
      }),
    };
  }
  return { kind: 'error', text: t('subscriptions.flash.updateFailed') };
};

const MIDDLE_TRUNCATE_LIMIT = 32;

const truncateMiddle = (value: string): string => {
  if (value.length <= MIDDLE_TRUNCATE_LIMIT) return value;
  const head = value.slice(0, 16);
  const tail = value.slice(-13);
  return `${head}…${tail}`;
};

const extractNotionId = (input: string): string => {
  const trimmed = input.trim();
  const urlMatch =
    /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
      trimmed
    );
  return urlMatch == null ? trimmed : urlMatch[1];
};

const normalizeId = (id: string): string =>
  id.replaceAll('-', '').toLowerCase();

const isCalmOfflineError = (lastError: string | null | undefined): boolean =>
  lastError != null && lastError.startsWith('Anki client offline');

type DeckStatus = 'success' | 'syncing' | 'error' | 'offline';

const deckStatusFor = (
  lastError: string | null | undefined,
  isUpdating: boolean
): DeckStatus => {
  if (isUpdating) return 'syncing';
  if (isCalmOfflineError(lastError)) return 'offline';
  if (lastError != null) return 'error';
  return 'success';
};

const dotClassFor = (status: DeckStatus): string => {
  if (status === 'syncing') return styles.decksItemDotSyncing;
  if (status === 'error') return styles.decksItemDotError;
  if (status === 'offline') return styles.decksItemDotOffline;
  return styles.decksItemDotSuccess;
};

const renderSecondLine = (
  lastError: string | null | undefined,
  nextExportLabel: string | null,
  t: TFunction
): ReactNode => {
  if (isCalmOfflineError(lastError)) {
    return (
      <p className={styles.decksItemError}>{t('subscriptions.offlineError')}</p>
    );
  }
  if (lastError != null) {
    return (
      <p className={styles.decksItemErrorDanger}>
        {t('subscriptions.lastCheckFailed')}
      </p>
    );
  }
  if (nextExportLabel != null) {
    return (
      <p className={styles.decksItemError}>
        {t('subscriptions.nextExport', { time: nextExportLabel })}
      </p>
    );
  }
  return null;
};

export default function NotionSubscriptions({
  backend,
  schedule,
  onTabChange,
}: Props) {
  const { t } = useTranslation('ankify');
  const api = backend ?? get2ankiApi();
  const queryClient = useQueryClient();
  const [advancedInput, setAdvancedInput] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    'decks' | 'find' | 'leeches' | 'review' | null
  >(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<DeckSortKey>(readStoredDeckSort);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [deckLocationEditorId, setDeckLocationEditorId] = useState<
    number | null
  >(null);
  const [deckLocationInput, setDeckLocationInput] = useState('');
  const menuContainerRef = useRef<HTMLUListElement | null>(null);
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(
    () => new Set()
  );
  const [flashByRow, setFlashByRow] = useState<Record<number, RowFlash>>({});
  const [zeroBannerByRow, setZeroBannerByRow] = useState<
    Record<number, ZeroDiagnostic | null>
  >({});
  const flashTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  useEffect(
    () => () => {
      flashTimers.current.forEach((handle) => clearTimeout(handle));
      flashTimers.current.clear();
    },
    []
  );

  const showFlash = useCallback((id: number, flash: RowFlash) => {
    setFlashByRow((prev) => ({ ...prev, [id]: flash }));
    const previousTimer = flashTimers.current.get(id);
    if (previousTimer != null) clearTimeout(previousTimer);
    const handle = setTimeout(() => {
      flashTimers.current.delete(id);
      setFlashByRow((prev) => {
        const { [id]: _omit, ...rest } = prev;
        return rest;
      });
    }, FLASH_DURATION_MS);
    flashTimers.current.set(id, handle);
  }, []);

  const handleRefresh = useCallback(
    async (id: number) => {
      setOpenMenuId(null);
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setFlashByRow((prev) => {
        const { [id]: _omit, ...rest } = prev;
        return rest;
      });
      setZeroBannerByRow((prev) => {
        const { [id]: _omit, ...rest } = prev;
        return rest;
      });
      const previousTimer = flashTimers.current.get(id);
      if (previousTimer != null) {
        clearTimeout(previousTimer);
        flashTimers.current.delete(id);
      }
      try {
        const result = await api.refreshAnkifySubscription(id);
        showFlash(
          id,
          buildSuccessFlash(
            {
              ...result,
              diagnostic: result.diagnostic ?? null,
            },
            t
          )
        );
        setZeroBannerByRow((prev) => ({
          ...prev,
          [id]: extractZeroDiagnostic(result),
        }));
        queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
        if (result.conflicts > 0) {
          queryClient.invalidateQueries({ queryKey: CONFLICTS_KEY });
        }
      } catch (error) {
        showFlash(id, errorFlashFor(error as Error, t));
      } finally {
        setRefreshingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [api, queryClient, showFlash, t]
  );

  const subs = useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: () => api.listAnkifySubscriptions(),
  });

  const leeches = useQuery({
    queryKey: ['ankify-leeches'],
    queryFn: () => api.listAnkifyLeeches(),
  });
  const leechCount =
    leeches.data?.connected === true ? leeches.data.leeches.length : 0;

  const stats = useAnkifyStats(api);
  const statsDecks =
    stats.data?.connected === true ? stats.data.decks : EMPTY_DECKS;

  const ownedDeckNames = (subs.data ?? []).map((sub) =>
    buildDeckName(sub.target_deck, sub.notion_page_title)
  );
  const maturityByDeck = useDeckMaturity(api, ownedDeckNames);

  type SubscriptionRow = Awaited<
    ReturnType<typeof api.listAnkifySubscriptions>
  >[number];

  interface SubscribeArgs {
    notionPageId: string;
    notionPageTitle?: string | null;
    notionPageUrl?: string | null;
    notionPageIcon?: string | null;
  }

  const subscribe = useMutation({
    mutationFn: (args: SubscribeArgs) =>
      api.subscribeAnkifyNotionPage({
        notionPageId: args.notionPageId,
        notionPageTitle: args.notionPageTitle,
        notionPageUrl: args.notionPageUrl,
        notionPageIcon: args.notionPageIcon,
      }),
    onMutate: async (args: SubscribeArgs) => {
      await queryClient.cancelQueries({ queryKey: SUBSCRIPTIONS_KEY });
      const previous =
        queryClient.getQueryData<SubscriptionRow[]>(SUBSCRIPTIONS_KEY);
      const optimisticRow: SubscriptionRow = {
        id: -Date.now(),
        notion_page_id: args.notionPageId,
        notion_page_title: args.notionPageTitle ?? null,
        notion_page_url: args.notionPageUrl ?? null,
        notion_page_icon: args.notionPageIcon ?? null,
        target_deck: null,
        enabled: true,
        last_polled_at: null,
        last_synced_at: null,
        last_error: null,
      };
      const alreadyPresent = (previous ?? []).some(
        (sub) =>
          normalizeId(sub.notion_page_id) === normalizeId(args.notionPageId)
      );
      if (!alreadyPresent) {
        queryClient.setQueryData<SubscriptionRow[]>(SUBSCRIPTIONS_KEY, [
          ...(previous ?? []),
          optimisticRow,
        ]);
      }
      return { previous };
    },
    onError: (_err, _args, context) => {
      if (context?.previous != null) {
        queryClient.setQueryData(SUBSCRIPTIONS_KEY, context.previous);
      }
    },
    onSettled: () => {
      setPendingId(null);
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
    },
    onSuccess: () => {
      setAdvancedInput('');
    },
  });

  const unsubscribe = useMutation({
    mutationFn: (id: number) => api.deleteAnkifySubscription(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY }),
  });

  const saveDeckLocation = useMutation({
    mutationFn: (args: { notionPageId: string; targetDeck: string }) =>
      api.subscribeAnkifyNotionPage({
        notionPageId: args.notionPageId,
        targetDeck: args.targetDeck,
      }),
    onSuccess: () => {
      setDeckLocationEditorId(null);
      setDeckLocationInput('');
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
    },
  });

  const openDeckLocationEditor = (id: number, current: string | null) => {
    setOpenMenuId(null);
    setDeckLocationEditorId(id);
    setDeckLocationInput(current ?? '');
  };

  const handlePick = (
    id: string,
    page?: { title?: string; url?: string; icon?: string }
  ) => {
    setPendingId(id);
    const trimmedIcon =
      page?.icon != null && page.icon.length > 0 ? page.icon : undefined;
    subscribe.mutate({
      notionPageId: id,
      notionPageTitle: page?.title ?? undefined,
      notionPageUrl: page?.url ?? undefined,
      notionPageIcon: trimmedIcon,
    });
  };

  const handleAdvancedSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (advancedInput.trim().length === 0) return;
    const id = extractNotionId(advancedInput);
    setPendingId(id);
    subscribe.mutate({ notionPageId: id });
  };

  const subscriptions = subs.data ?? [];
  const subscribedIds = new Set(
    subscriptions.map((sub) => normalizeId(sub.notion_page_id))
  );

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        menuContainerRef.current &&
        !menuContainerRef.current.contains(target)
      ) {
        setOpenMenuId(null);
      }
    };
    if (openMenuId != null) {
      document.addEventListener('mousedown', onClick);
      return () => document.removeEventListener('mousedown', onClick);
    }
    return undefined;
  }, [openMenuId]);

  const effectiveTab: 'decks' | 'find' | 'leeches' | 'review' =
    activeTab ?? (subscriptions.length === 0 ? 'find' : 'decks');

  useEffect(() => {
    onTabChange?.(effectiveTab);
  }, [effectiveTab, onTabChange]);
  const showControls = subscriptions.length >= SEARCH_THRESHOLD;
  const trimmedSearch = search.trim();
  const filteredSubscriptions =
    trimmedSearch.length === 0
      ? subscriptions
      : subscriptions.filter((sub) =>
          (sub.notion_page_title ?? '')
            .toLowerCase()
            .includes(trimmedSearch.toLowerCase())
        );
  const sortedSubscriptions = sortDecks(filteredSubscriptions, sortKey);
  const hasNoSearchMatch =
    trimmedSearch.length > 0 && sortedSubscriptions.length === 0;

  const handleSortChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    if (!isDeckSortKey(next)) return;
    setSortKey(next);
    writeStoredDeckSort(next);
    track('ankify_decklist_sorted', { key: next });
  };

  return (
    <section>
      <div
        role="tablist"
        aria-label={t('subscriptions.tabsLabel')}
        className={styles.tabBar}
      >
        <button
          type="button"
          role="tab"
          id="ankify-tab-decks"
          aria-selected={effectiveTab === 'decks'}
          aria-controls="ankify-tabpanel-decks"
          className={
            effectiveTab === 'decks'
              ? `${styles.tab} ${styles.tabActive}`
              : styles.tab
          }
          onClick={() => setActiveTab('decks')}
        >
          {t('subscriptions.tabs.decks')}{' '}
          {subscriptions.length > 0 && (
            <span className={styles.tabCount}>{subscriptions.length}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          id="ankify-tab-find"
          aria-selected={effectiveTab === 'find'}
          aria-controls="ankify-tabpanel-find"
          className={
            effectiveTab === 'find'
              ? `${styles.tab} ${styles.tabActive}`
              : styles.tab
          }
          onClick={() => setActiveTab('find')}
        >
          {t('subscriptions.tabs.find')}
        </button>
        <button
          type="button"
          role="tab"
          id="ankify-tab-leeches"
          aria-selected={effectiveTab === 'leeches'}
          aria-controls="ankify-tabpanel-leeches"
          className={
            effectiveTab === 'leeches'
              ? `${styles.tab} ${styles.tabActive}`
              : styles.tab
          }
          onClick={() => setActiveTab('leeches')}
        >
          {t('subscriptions.tabs.leeches')}{' '}
          {leechCount > 0 && (
            <span className={styles.tabCount}>{leechCount}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          id="ankify-tab-review"
          aria-selected={effectiveTab === 'review'}
          aria-controls="ankify-tabpanel-review"
          className={
            effectiveTab === 'review'
              ? `${styles.tab} ${styles.tabActive}`
              : styles.tab
          }
          onClick={() => setActiveTab('review')}
        >
          {t('subscriptions.tabs.review')}
        </button>
      </div>

      {effectiveTab === 'leeches' && <LeechesPanel backend={backend} />}

      {effectiveTab === 'review' && <ReviewPanel backend={backend} />}

      {effectiveTab === 'find' && (
        <div
          role="tabpanel"
          id="ankify-tabpanel-find"
          aria-labelledby="ankify-tab-find"
          className={styles.tabPanel}
        >
          <NotionPagePicker
            backend={api}
            onSelect={handlePick}
            busyId={subscribe.isPending ? pendingId : null}
            disabledIds={subscribedIds}
            selectLabel={t('subscriptions.picker.select')}
            busyLabel={t('subscriptions.picker.busy')}
            subscribedLabel={t('subscriptions.picker.subscribed')}
          />

          {subscribe.isError &&
            (() => {
              const mapped = mapSubscribeError(
                subscribe.error as Error & { status?: number }
              );
              return (
                <p role="alert" className={sharedStyles.helpDanger}>
                  {mapped.text}
                  {mapped.link != null && (
                    <>
                      {' '}
                      <Link to={mapped.link.href}>{mapped.link.label}</Link>
                    </>
                  )}
                </p>
              );
            })()}
          {subscribe.isSuccess && (
            <>
              <p className={sharedStyles.helpSuccess}>
                {t('subscriptions.successDone', {
                  count: subscribe.data.created,
                  updated: subscribe.data.updated,
                })}
                {subscribe.data.conflicts > 0
                  ? t('subscriptions.successConflicts', {
                      count: subscribe.data.conflicts,
                    })
                  : ''}
                .
              </p>
              {subscribe.data.anki_web_sync === 'failed' && (
                <p className={sharedStyles.helpDanger}>
                  {t('subscriptions.ankiWebFailed')}
                </p>
              )}
            </>
          )}

          <details>
            <summary className={styles.advancedSummary}>
              {t('subscriptions.advancedSummary')}
            </summary>
            <form
              onSubmit={handleAdvancedSubmit}
              className={styles.advancedBody}
            >
              <label htmlFor="ankify-advanced-input">
                {t('subscriptions.advancedLabel')}
              </label>
              <div className={styles.advancedRow}>
                <input
                  id="ankify-advanced-input"
                  type="text"
                  value={advancedInput}
                  onChange={(event) => setAdvancedInput(event.target.value)}
                  placeholder="https://www.notion.so/..."
                />
                <button
                  type="submit"
                  className={`${sharedStyles.btnSecondary} ${styles.inlineButton}`}
                  disabled={
                    subscribe.isPending || advancedInput.trim().length === 0
                  }
                >
                  {t('subscriptions.advancedSubmit')}
                </button>
              </div>
            </form>
          </details>
        </div>
      )}

      {effectiveTab === 'decks' &&
        (subscriptions.length === 0 ? (
          <div
            role="tabpanel"
            id="ankify-tabpanel-decks"
            aria-labelledby="ankify-tab-decks"
            className={styles.tabPanel}
          >
            <p className={styles.emptyLine}>
              {t('subscriptions.emptyPrefix')}
              <button
                type="button"
                className={styles.inlineLinkButton}
                onClick={() => setActiveTab('find')}
              >
                {t('subscriptions.emptyLink')}
              </button>
              {t('subscriptions.emptySuffix')}
            </p>
          </div>
        ) : (
          <div
            role="tabpanel"
            id="ankify-tabpanel-decks"
            aria-labelledby="ankify-tab-decks"
            className={styles.tabPanel}
          >
            {showControls && (
              <div className={styles.decksControls}>
                <div className={styles.searchAbove}>
                  <label
                    htmlFor="ankify-deck-search"
                    className={sharedStyles.srOnly}
                  >
                    {t('subscriptions.searchLabel')}
                  </label>
                  <input
                    id="ankify-deck-search"
                    type="search"
                    placeholder={t('subscriptions.searchLabel')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <div className={styles.decksSort}>
                  <label
                    htmlFor="ankify-deck-sort"
                    className={sharedStyles.srOnly}
                  >
                    {t('subscriptions.sortLabel')}
                  </label>
                  <select
                    id="ankify-deck-sort"
                    className={styles.decksSortSelect}
                    value={sortKey}
                    onChange={handleSortChange}
                  >
                    <option value="status">
                      {t('subscriptions.sort.status')}
                    </option>
                    <option value="last-synced">
                      {t('subscriptions.sort.lastSynced')}
                    </option>
                    <option value="name">{t('subscriptions.sort.name')}</option>
                  </select>
                </div>
              </div>
            )}
            <p className={styles.decksHelper}>
              {t('subscriptions.checkInterval')}
            </p>
            {hasNoSearchMatch && (
              <p className={styles.decksHelper}>
                {t('subscriptions.noMatchPrefix')}
                <span className={styles.decksSearchQuery}>
                  &ldquo;{trimmedSearch}&rdquo;
                </span>
                .{' '}
                <button
                  type="button"
                  className={styles.inlineLinkButton}
                  onClick={() => setSearch('')}
                >
                  {t('subscriptions.clearSearch')}
                </button>
                {t('subscriptions.noMatchSuffix', {
                  count: subscriptions.length,
                })}
              </p>
            )}
            <ul className={styles.decksList} ref={menuContainerRef}>
              {sortedSubscriptions.map((sub) => {
                const displayTitle = sub.notion_page_title?.trim().length
                  ? sub.notion_page_title
                  : t('subscriptions.untitledPage');
                const isSubscribingThisRow =
                  subscribe.isPending &&
                  pendingId != null &&
                  normalizeId(pendingId) === normalizeId(sub.notion_page_id);
                const isRefreshingThisRow = refreshingIds.has(sub.id);
                const isUpdatingThisRow =
                  isSubscribingThisRow || isRefreshingThisRow;
                const flash = flashByRow[sub.id] ?? null;
                const zeroBanner = zeroBannerByRow[sub.id] ?? null;
                const nextExportLabel =
                  schedule?.enabled === true &&
                  normalizeId(schedule.database_id) ===
                    normalizeId(sub.notion_page_id)
                    ? formatScheduleTime(
                        schedule.time_of_day,
                        schedule.timezone
                      )
                    : null;
                const secondLine = renderSecondLine(
                  sub.last_error,
                  nextExportLabel,
                  t
                );
                const relative = formatRelativeTime(sub.last_synced_at);
                const isPreparingFirstSync =
                  sub.last_synced_at == null &&
                  sub.last_polled_at == null &&
                  sub.last_error == null;
                let lastSyncedDisplay: ReactNode;
                if (isPreparingFirstSync) {
                  lastSyncedDisplay = (
                    <span className={styles.muted}>
                      {t('subscriptions.preparingFirstSync')}
                    </span>
                  );
                } else if (relative == null) {
                  lastSyncedDisplay = (
                    <span className={styles.muted}>
                      {t('subscriptions.notYet')}
                    </span>
                  );
                } else {
                  lastSyncedDisplay = (
                    <span title={sub.last_synced_at ?? undefined}>
                      {t('subscriptions.lastSync', { time: relative })}
                    </span>
                  );
                }
                const iconValue = sub.notion_page_icon ?? '';
                const rowStatus = deckStatusFor(
                  sub.last_error,
                  isUpdatingThisRow
                );
                const deckName = buildDeckName(
                  sub.target_deck,
                  sub.notion_page_title
                );
                const backlogLabel = formatBacklog(
                  sumDeckBacklog(deckName, statsDecks)
                );
                const maturity = maturityByDeck.get(deckName);
                const maturityLabel =
                  maturity?.connected === true
                    ? formatMaturity(maturity.matureCount, maturity.total)
                    : null;
                return (
                  <Fragment key={sub.id}>
                    <li className={styles.decksItem}>
                      <span
                        className={`${styles.decksItemDot} ${dotClassFor(rowStatus)}`}
                        aria-hidden="true"
                      />
                      {iconValue.length > 0 && (
                        <span
                          className={styles.decksItemIcon}
                          aria-hidden="true"
                        >
                          <BlockIcon icon={iconValue} />
                        </span>
                      )}
                      <span
                        className={styles.decksItemTitle}
                        title={displayTitle}
                      >
                        {sub.notion_page_url != null &&
                        sub.notion_page_url.length > 0 ? (
                          <a
                            href={sub.notion_page_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {displayTitle}
                          </a>
                        ) : (
                          displayTitle
                        )}
                        {secondLine}
                      </span>
                      <span className={styles.decksItemData} aria-live="polite">
                        {sub.target_deck != null &&
                          sub.target_deck.length > 0 && (
                            <span
                              className={styles.decksItemDeckPath}
                              title={sub.target_deck}
                            >
                              {t('subscriptions.inAnki', {
                                deck: truncateMiddle(sub.target_deck),
                              })}
                            </span>
                          )}
                        {backlogLabel != null && (
                          <span className={styles.decksItemBacklog}>
                            {backlogLabel}
                          </span>
                        )}
                        {maturityLabel != null && (
                          <span className={styles.decksItemMaturity}>
                            {maturityLabel}
                          </span>
                        )}
                        {(() => {
                          if (isUpdatingThisRow)
                            return (
                              <span>{t('subscriptions.updatingNow')}</span>
                            );
                          if (flash != null) {
                            return (
                              <span
                                className={
                                  flash.kind === 'success'
                                    ? styles.muted
                                    : styles.decksItemErrorDanger
                                }
                              >
                                {flash.text}
                              </span>
                            );
                          }
                          return lastSyncedDisplay;
                        })()}
                      </span>
                      <div className={styles.decksItemRowMenu}>
                        <button
                          type="button"
                          className={sharedStyles.btnIcon}
                          aria-label={t('subscriptions.options', {
                            title: displayTitle,
                          })}
                          aria-haspopup="menu"
                          aria-expanded={openMenuId === sub.id}
                          onClick={() =>
                            setOpenMenuId((current) =>
                              current === sub.id ? null : sub.id
                            )
                          }
                        >
                          <DotsHorizontal width={16} height={16} />
                        </button>
                        {openMenuId === sub.id && (
                          <div role="menu" className={styles.decksItemMenu}>
                            <button
                              type="button"
                              role="menuitem"
                              className={styles.decksItemMenuItem}
                              aria-label={t('subscriptions.updateNowAria', {
                                title: displayTitle,
                              })}
                              onClick={() => handleRefresh(sub.id)}
                              disabled={isUpdatingThisRow}
                            >
                              {t('subscriptions.updateNow')}
                            </button>
                            {sub.notion_page_url != null &&
                              sub.notion_page_url.length > 0 && (
                                <a
                                  role="menuitem"
                                  className={styles.decksItemMenuItem}
                                  href={sub.notion_page_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={t(
                                    'subscriptions.openInNotionAria',
                                    {
                                      title: displayTitle,
                                    }
                                  )}
                                  onClick={() => setOpenMenuId(null)}
                                >
                                  {t('subscriptions.openInNotion')}
                                </a>
                              )}
                            <Link
                              role="menuitem"
                              className={styles.decksItemMenuItem}
                              to={`/rules/${sub.notion_page_id}`}
                              aria-label={t('subscriptions.editSettingsAria', {
                                title: displayTitle,
                              })}
                              onClick={() => setOpenMenuId(null)}
                            >
                              {t('subscriptions.editSettings')}
                            </Link>
                            <button
                              type="button"
                              role="menuitem"
                              className={styles.decksItemMenuItem}
                              aria-label={t(
                                'subscriptions.setDeckLocationAria',
                                {
                                  title: displayTitle,
                                }
                              )}
                              onClick={() =>
                                openDeckLocationEditor(sub.id, sub.target_deck)
                              }
                            >
                              {t('subscriptions.setDeckLocation')}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className={styles.decksItemMenuItem}
                              onClick={() => {
                                setOpenMenuId(null);
                                unsubscribe.mutate(sub.id);
                              }}
                              disabled={unsubscribe.isPending}
                            >
                              {t('subscriptions.stop')}
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                    {deckLocationEditorId === sub.id && (
                      <li className={styles.zeroBanner}>
                        <form
                          className={styles.deckLocationForm}
                          onSubmit={(event) => {
                            event.preventDefault();
                            saveDeckLocation.mutate({
                              notionPageId: sub.notion_page_id,
                              targetDeck: deckLocationInput.trim(),
                            });
                          }}
                        >
                          <label htmlFor={`deck-location-${sub.id}`}>
                            {t('subscriptions.deckLocationLabel')}
                          </label>
                          <input
                            id={`deck-location-${sub.id}`}
                            type="text"
                            value={deckLocationInput}
                            onChange={(event) =>
                              setDeckLocationInput(event.target.value)
                            }
                            placeholder="Notion Sync::Small Bowel Cancer"
                          />
                          <p className={styles.deckLocationHelp}>
                            {t('subscriptions.deckLocationHelp')}
                          </p>
                          <div className={styles.deckLocationActions}>
                            <button
                              type="submit"
                              className={sharedStyles.btnPrimary}
                              disabled={saveDeckLocation.isPending}
                            >
                              {t('subscriptions.saveLocation')}
                            </button>
                            <button
                              type="button"
                              className={sharedStyles.btnGhost}
                              onClick={() => {
                                setDeckLocationEditorId(null);
                                setDeckLocationInput('');
                              }}
                            >
                              {t('subscriptions.cancel')}
                            </button>
                          </div>
                          {saveDeckLocation.isError && (
                            <p role="alert" className={sharedStyles.helpDanger}>
                              {t('subscriptions.saveLocationError')}
                            </p>
                          )}
                        </form>
                      </li>
                    )}
                    {zeroBanner != null && (
                      <li className={styles.zeroBanner} aria-live="polite">
                        <p className={styles.zeroBannerText}>
                          {zeroBanner.blocks_scanned > 0 ? (
                            <>
                              {t('subscriptions.zeroScannedPrefix')}
                              <strong>{zeroBanner.blocks_scanned}</strong>
                              {t('subscriptions.zeroScannedSuffix')}
                            </>
                          ) : (
                            <>{t('subscriptions.zeroNoContent')}</>
                          )}
                          <a href="/answers" className={styles.zeroBannerLink}>
                            {t('subscriptions.zeroLink')}
                          </a>
                        </p>
                        {zeroBanner.unmatched_samples != null &&
                          zeroBanner.unmatched_samples.length > 0 && (
                            <details className={styles.zeroBannerDetails}>
                              <summary className={styles.zeroBannerSummary}>
                                {t('subscriptions.zeroSamplesSummary', {
                                  count: zeroBanner.unmatched_samples.length,
                                })}
                              </summary>
                              <ul className={styles.zeroBannerSamples}>
                                {zeroBanner.unmatched_samples.map((s) => (
                                  <li key={s}>{s}</li>
                                ))}
                              </ul>
                            </details>
                          )}
                      </li>
                    )}
                  </Fragment>
                );
              })}
            </ul>
          </div>
        ))}
    </section>
  );
}
