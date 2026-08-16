import {
  CSSProperties,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import confetti from 'canvas-confetti';

import styles from '../AnkifyPage.module.css';
import reviewStyles from './ReviewPanel.module.css';
import sharedStyles from '../../../styles/shared.module.css';
import { get2ankiApi } from '../../../lib/backend/get2ankiApi';
import { Backend, ReviewCard } from '../../../lib/backend/Backend';
import { AnkifyStatsDeck } from '../stats/types';
import { buildDeckTree } from './buildDeckTree';
import { track } from '../../../lib/analytics/track';
import {
  getStoredCollapsedDecks,
  setStoredCollapsedDecks,
} from '../lib/collapsedDecksStorage';

interface Props {
  readonly backend?: Backend;
}

const EASE_BY_KEY: Record<string, number> = { '1': 1, '2': 2, '3': 3, '4': 4 };

const GRADES = [
  {
    ease: 1,
    labelKey: 'reviewer.grades.again',
    interval: '<1m',
    className: reviewStyles.gradeAgain,
  },
  {
    ease: 2,
    labelKey: 'reviewer.grades.hard',
    interval: '<6m',
    className: reviewStyles.gradeHard,
  },
  {
    ease: 3,
    labelKey: 'reviewer.grades.good',
    interval: '1d',
    className: reviewStyles.gradeGood,
  },
  {
    ease: 4,
    labelKey: 'reviewer.grades.easy',
    interval: '4d',
    className: reviewStyles.gradeEasy,
  },
];

const MAX_INDENT_DEPTH = 4;

function hasCollapsedAncestor(
  fullName: string,
  collapsed: Set<string>
): boolean {
  return Array.from(collapsed).some((collapsedName) =>
    fullName.startsWith(`${collapsedName}::`)
  );
}

export function DeckPicker({
  decks,
  onReview,
}: {
  readonly decks: AnkifyStatsDeck[];
  readonly onReview: (deckName: string) => void;
}) {
  const { t } = useTranslation('ankify');
  const tree = buildDeckTree(decks);
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    getStoredCollapsedDecks()
  );

  const toggle = (fullName: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) {
        next.delete(fullName);
      } else {
        next.add(fullName);
      }
      setStoredCollapsedDecks(next);
      return next;
    });
  };

  return (
    <ul className={styles.decksList}>
      {tree
        .filter((node) => !hasCollapsedAncestor(node.deck.fullName, collapsed))
        .map((node) => {
          const due = node.aggregateDue;
          const reviewable =
            due + node.aggregateLearning + node.aggregateNew > 0;
          const muted = !reviewable;
          const leaf =
            node.deck.name.length > 0 ? node.deck.name : 'Untitled deck';
          const isCollapsed = collapsed.has(node.deck.fullName);
          return (
            <li
              key={node.deck.fullName}
              className={
                muted
                  ? `${styles.decksItem} ${reviewStyles.deckRowMuted}`
                  : styles.decksItem
              }
            >
              <span
                className={styles.decksItemTitle}
                title={node.deck.fullName}
                style={
                  {
                    ['--depth' as string]: Math.min(
                      node.depth,
                      MAX_INDENT_DEPTH
                    ),
                  } as CSSProperties
                }
              >
                {node.hasChildren ? (
                  <button
                    type="button"
                    className={reviewStyles.deckDisclosure}
                    aria-expanded={!isCollapsed}
                    aria-label={
                      isCollapsed
                        ? t('reviewer.expand', { name: leaf })
                        : t('reviewer.collapse', { name: leaf })
                    }
                    onClick={() => toggle(node.deck.fullName)}
                  >
                    <span aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                  </button>
                ) : (
                  <span
                    className={reviewStyles.deckDisclosureSpacer}
                    aria-hidden="true"
                  />
                )}
                {leaf}
              </span>
              <span className={reviewStyles.deckCounts}>
                <span className={reviewStyles.deckDue}>
                  <span aria-hidden="true">▲</span>
                  {t('reviewer.due', { count: due })}
                </span>
                <span>
                  {t('reviewer.learning', { count: node.aggregateLearning })}
                </span>
                <span>{t('reviewer.new', { count: node.aggregateNew })}</span>
              </span>
              <button
                type="button"
                className={reviewStyles.deckReview}
                disabled={muted}
                onClick={() => onReview(node.deck.fullName)}
              >
                {t('reviewer.review')}
              </button>
            </li>
          );
        })}
    </ul>
  );
}

const MIN_CARD_FRAME_HEIGHT = 128;
// A sandboxed srcDoc frame (no allow-same-origin) always posts with the
// literal origin "null"; anything else is another window impersonating the
// card. The cap bounds what hostile card content can do to the page layout.
const MAX_CARD_FRAME_HEIGHT = 4096;

function buildSrcDoc(css: string, body: string): string {
  const sizingScript = `<script>(function(){function post(){parent.postMessage({type:'n2a-review-height',height:document.documentElement.scrollHeight},'*');}window.addEventListener('load',post);document.querySelectorAll('img').forEach(function(img){img.addEventListener('load',post);img.addEventListener('error',post);});if(window.ResizeObserver){new ResizeObserver(post).observe(document.documentElement);}post();var __a=document.querySelector('audio');if(__a){__a.play().catch(function(){});}})();</script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body class="card">${body}${sizingScript}</body></html>`;
}

export function CardFrame({ srcDoc }: { readonly srcDoc: string }) {
  const { t } = useTranslation('ankify');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN_CARD_FRAME_HEIGHT);

  useEffect(() => {
    setHeight(MIN_CARD_FRAME_HEIGHT);
  }, [srcDoc]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
      if (event.origin !== 'null') {
        return;
      }
      const data = event.data as { type?: string; height?: number };
      if (
        data?.type !== 'n2a-review-height' ||
        typeof data.height !== 'number' ||
        !Number.isFinite(data.height)
      ) {
        return;
      }
      setHeight(
        Math.min(
          MAX_CARD_FRAME_HEIGHT,
          Math.max(MIN_CARD_FRAME_HEIGHT, data.height)
        )
      );
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      title={t('reviewer.cardPreview')}
      className={reviewStyles.cardFrame}
      sandbox="allow-scripts"
      allow="autoplay"
      srcDoc={srcDoc}
      style={{ height: `${height}px` }}
    />
  );
}

export function Reviewer({
  cardIds,
  deckName,
  loadCard,
  onGrade,
  onDone,
  onExit,
}: {
  readonly cardIds: number[];
  readonly deckName: string;
  readonly loadCard: (cardId: number) => Promise<ReviewCard>;
  readonly onGrade: (cardId: number, ease: number) => Promise<void>;
  readonly onDone: (graded: number) => void;
  readonly onExit: () => void;
}) {
  const { t } = useTranslation('ankify');
  const queryClient = useQueryClient();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<number[]>([]);
  const gradedCountRef = useRef(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!startedRef.current && cardIds.length > 0) {
      startedRef.current = true;
      track('ankify_review_session_started', { deck: deckName });
    }
  }, [cardIds.length, deckName]);

  const total = cardIds.length;
  const currentId = cardIds[index];

  const cardQuery = useQuery({
    queryKey: ['ankify-review-card', currentId],
    queryFn: () => loadCard(currentId),
    enabled: currentId != null,
  });

  const nextId = cardIds[index + 1];
  useEffect(() => {
    if (nextId == null) {
      return;
    }
    queryClient.prefetchQuery({
      queryKey: ['ankify-review-card', nextId],
      queryFn: () => loadCard(nextId),
    });
  }, [loadCard, nextId, queryClient]);

  const advance = useCallback(() => {
    const next = index + 1;
    if (next >= total) {
      track('ankify_review_completed', {
        deck: deckName,
        graded: gradedCountRef.current,
      });
      onDone(gradedCountRef.current);
      return;
    }
    setIndex(next);
    setRevealed(false);
  }, [deckName, index, onDone, total]);

  const card =
    cardQuery.data?.connected === true ? cardQuery.data.card : undefined;

  useEffect(() => {
    if (cardQuery.data?.connected === true && cardQuery.data.card === null) {
      advance();
    }
  }, [advance, cardQuery.data]);

  const reveal = useCallback(() => setRevealed(true), []);

  const grade = useCallback(
    async (ease: number) => {
      if (card == null || busy) {
        return;
      }
      setBusy(true);
      try {
        await onGrade(card.cardId, ease);
        gradedCountRef.current += 1;
        setHistory((prev) => [...prev, index]);
        advance();
      } finally {
        setBusy(false);
      }
    },
    [advance, busy, card, index, onGrade]
  );

  const undo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      setIndex(prev[prev.length - 1]);
      setRevealed(true);
      gradedCountRef.current = Math.max(0, gradedCountRef.current - 1);
      return prev.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        event.preventDefault();
        if (revealed) {
          return;
        }
        reveal();
        return;
      }
      if (revealed && EASE_BY_KEY[event.key] != null) {
        event.preventDefault();
        grade(EASE_BY_KEY[event.key]);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [grade, reveal, revealed]);

  const reviewChrome = (children: ReactNode) => (
    <div>
      <div className={reviewStyles.progressTrack}>
        <span
          className={reviewStyles.progressFill}
          style={{ width: `${(index / total) * 100}%` }}
        />
      </div>
      <div className={reviewStyles.reviewHeader}>
        <button
          type="button"
          className={reviewStyles.exitButton}
          aria-label={t('reviewer.backToDecks')}
          onClick={() => {
            track('ankify_review_session_exited', {
              deck: deckName,
              graded: gradedCountRef.current,
            });
            onExit();
          }}
        >
          {t('reviewer.decksNav')}
        </button>
        <p className={reviewStyles.progressLabel}>
          {index + 1} / {total}
        </p>
      </div>
      {children}
    </div>
  );

  if (card == null) {
    return reviewChrome(
      <p className={styles.emptyLine}>{t('reviewer.loadingCards')}</p>
    );
  }

  const srcDoc = buildSrcDoc(
    card.css,
    revealed ? card.answerHtml : card.questionHtml
  );

  return reviewChrome(
    <div className={reviewStyles.cardArea}>
      <CardFrame srcDoc={srcDoc} />
      {revealed ? (
        <>
          <hr className={reviewStyles.cardDivider} />
          <div className={reviewStyles.grades}>
            {GRADES.map((g) => (
              <button
                key={g.ease}
                type="button"
                className={`${reviewStyles.gradeButton} ${g.className}`}
                disabled={busy}
                onClick={() => grade(g.ease)}
              >
                {t(g.labelKey)}
                <span className={reviewStyles.gradeInterval} aria-hidden="true">
                  <span className={reviewStyles.gradeShortcut}>{g.ease}</span>{' '}
                  {g.interval}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <button
          type="button"
          className={reviewStyles.showAnswer}
          onClick={reveal}
        >
          {t('reviewer.showAnswer')}
          <span className={reviewStyles.shortcutHint} aria-hidden="true">
            {t('reviewer.spaceHint')}
          </span>
        </button>
      )}
      {history.length > 0 && (
        <div className={reviewStyles.undoBar}>
          <button
            type="button"
            className={reviewStyles.undoButton}
            onClick={undo}
            disabled={busy}
          >
            {t('reviewer.undo')}
          </button>
        </div>
      )}
    </div>
  );
}

function fireConfetti() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
    return;
  }
  confetti({
    particleCount: 80,
    spread: 70,
    startVelocity: 32,
    origin: { y: 0.6 },
    disableForReducedMotion: true,
  });
}

export function ReviewSummary({
  graded,
  onBack,
}: {
  readonly graded: number;
  readonly onBack: () => void;
}) {
  const { t } = useTranslation('ankify');
  useEffect(() => {
    if (graded > 0) {
      fireConfetti();
    }
  }, [graded]);

  return (
    <div className={reviewStyles.summary}>
      <p className={reviewStyles.summaryHeadline}>
        {t('reviewer.summary', { count: graded })}
      </p>
      <div className={reviewStyles.summaryActions}>
        <button
          type="button"
          className={sharedStyles.btnGhost}
          onClick={onBack}
        >
          {t('reviewer.backToDecks')}
        </button>
      </div>
    </div>
  );
}

type Stage =
  | { kind: 'picker' }
  | { kind: 'reviewing'; deck: string }
  | { kind: 'summary'; deck: string; graded: number };

export default function ReviewPanel({ backend }: Props) {
  const { t } = useTranslation('ankify');
  const api = backend ?? get2ankiApi();
  const [stage, setStage] = useState<Stage>({ kind: 'picker' });

  const stats = useQuery({
    queryKey: ['ankify-review-stats'],
    queryFn: () => api.getAnkifyStats(),
  });

  const queue = useQuery({
    queryKey: [
      'ankify-review-queue',
      stage.kind === 'reviewing' ? stage.deck : null,
    ],
    queryFn: () =>
      stage.kind === 'reviewing'
        ? api.getAnkifyReviewQueue(stage.deck)
        : Promise.resolve({
            connected: false as const,
            reason: 'offline' as const,
          }),
    enabled: stage.kind === 'reviewing',
  });

  const loadCard = useCallback(
    (cardId: number) => api.getAnkifyReviewCard(cardId),
    [api]
  );

  const grade = useCallback(
    (cardId: number, ease: number) => api.gradeAnkifyReviewCard(cardId, ease),
    [api]
  );

  const panel = (children: ReactNode) => (
    <div
      role="tabpanel"
      id="ankify-tabpanel-review"
      aria-labelledby="ankify-tab-review"
      className={styles.tabPanel}
    >
      {children}
    </div>
  );

  if (stage.kind === 'summary') {
    return panel(
      <ReviewSummary
        graded={stage.graded}
        onBack={() => setStage({ kind: 'picker' })}
      />
    );
  }

  const backToDecks = (
    <div className={reviewStyles.reviewHeader}>
      <button
        type="button"
        className={reviewStyles.exitButton}
        aria-label={t('reviewer.backToDecks')}
        onClick={() => setStage({ kind: 'picker' })}
      >
        {t('reviewer.decksNav')}
      </button>
    </div>
  );

  const retry = (
    <div className={reviewStyles.summaryActions}>
      <button
        type="button"
        className={sharedStyles.btnGhost}
        onClick={() => queue.refetch()}
      >
        {t('reviewer.tryAgain')}
      </button>
    </div>
  );

  if (stage.kind === 'reviewing') {
    if (queue.isLoading) {
      return panel(
        <p className={styles.emptyLine}>{t('reviewer.loadingCards')}</p>
      );
    }
    if (queue.data?.connected === true) {
      if (queue.data.cardIds.length === 0) {
        return panel(
          <>
            <p className={styles.emptyLine}>{t('reviewer.nothingToStudy')}</p>
            {backToDecks}
          </>
        );
      }
      return panel(
        <Reviewer
          cardIds={queue.data.cardIds}
          deckName={stage.deck}
          loadCard={loadCard}
          onGrade={grade}
          onDone={(graded) =>
            setStage({ kind: 'summary', deck: stage.deck, graded })
          }
          onExit={() => setStage({ kind: 'picker' })}
        />
      );
    }
    if (queue.data?.reason === 'error') {
      return panel(
        <>
          <p className={styles.emptyLine}>{t('reviewer.deckLoadError')}</p>
          {retry}
          {backToDecks}
        </>
      );
    }
    return panel(
      <>
        <p className={styles.emptyLine}>{t('reviewer.notConnectedOpenAnki')}</p>
        {retry}
        {backToDecks}
      </>
    );
  }

  if (stats.isLoading) {
    return panel(
      <p className={styles.emptyLine}>{t('reviewer.loadingCards')}</p>
    );
  }
  if (stats.data?.connected !== true) {
    return panel(
      <p className={styles.emptyLine}>{t('reviewer.notConnected')}</p>
    );
  }
  if (stats.data.decks.length === 0) {
    return panel(<p className={styles.emptyLine}>{t('reviewer.noDecks')}</p>);
  }

  return panel(
    <>
      <p className={styles.decksHelper}>{t('reviewer.pickDeck')}</p>
      <DeckPicker
        decks={stats.data.decks}
        onReview={(deck) => setStage({ kind: 'reviewing', deck })}
      />
    </>
  );
}
