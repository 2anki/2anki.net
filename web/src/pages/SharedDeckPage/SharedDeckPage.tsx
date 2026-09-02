import { useEffect, useMemo, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { useParams } from 'react-router-dom';
import { SkeletonList } from '../../components/Skeleton/Skeleton';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { CardFrame } from '../PreviewApkgPage/CardFrame';
import { useSharedDeckMeta, useSharedDeckStream } from './useSharedDeckStream';
import { track } from '../../lib/analytics/track';
import { persistSignupOrigin } from '../../lib/signupOrigin';
import styles from './SharedDeckPage.module.css';

function truncateDeckName(name: string): string {
  if (name.length <= 40) return name;
  return `${name.slice(0, 40)}…`;
}

function RevokedPage() {
  return (
    <div className={styles.errorPage}>
      <p className={styles.errorTitle}>This link is no longer active.</p>
      <p className={styles.errorSub}>
        Ask them for a new one, or make your own deck on 2anki.net.
      </p>
    </div>
  );
}

function DeletedPage() {
  return (
    <div className={styles.errorPage}>
      <p className={styles.errorTitle}>This deck is no longer available.</p>
      <p className={styles.errorSub}>Make your own deck on 2anki.net.</p>
    </div>
  );
}

export default function SharedDeckPage() {
  const { token } = useParams<{ token: string }>();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const viewTrackedRef = useRef(false);

  const meta = useSharedDeckMeta(token);
  const stream = useSharedDeckStream(token, null);

  useEffect(() => {
    persistSignupOrigin('/shared-deck', globalThis.sessionStorage ?? null);
  }, []);

  useEffect(() => {
    if (meta.data == null || viewTrackedRef.current) return;
    viewTrackedRef.current = true;
    track('shared_deck_viewed');
  }, [meta.data]);

  const isRevoked =
    (meta.error?.message?.toLowerCase().includes('turned off') ||
      meta.error?.message?.toLowerCase().includes('404')) &&
    !meta.data;

  const isDeleted =
    (meta.error?.message?.toLowerCase().includes('no longer available') ||
      meta.error?.message?.toLowerCase().includes('deleted')) &&
    !meta.data;

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

  const cards = useMemo(
    () => stream.data?.pages.flatMap((page) => page.cards) ?? [],
    [stream.data]
  );

  const decks = Array.isArray(meta.data?.decks) ? meta.data.decks : [];
  const firstDeckName = decks[0]?.fullName ?? 'Shared deck';
  const headerName = truncateDeckName(firstDeckName);

  const downloadUrl = token
    ? `/api/shares/${encodeURIComponent(token)}/download`
    : null;

  if (isRevoked) {
    return (
      <div className={styles.page}>
        <Helmet>
          <meta name="robots" content="noindex" />
        </Helmet>
        <RevokedPage />
      </div>
    );
  }

  if (isDeleted) {
    return (
      <div className={styles.page}>
        <Helmet>
          <meta name="robots" content="noindex" />
        </Helmet>
        <DeletedPage />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Helmet>
        <meta name="robots" content="noindex" />
      </Helmet>
      <header className={styles.header}>
        <a href="https://2anki.net" className={styles.wordmark}>
          2anki
        </a>
        <span
          className={styles.deckName}
          title={firstDeckName}
          data-hj-suppress
        >
          {headerName}
        </span>
        <span className={styles.tagline}>Shared via 2anki</span>
      </header>

      <div className={styles.content}>
        {stream.isLoading && cards.length === 0 ? (
          <SkeletonList count={4} />
        ) : (
          <div className={styles.cards}>
            {cards.length === 0 && !stream.isLoading && (
              <EmptyState
                icon="🃏"
                title="Empty deck"
                description="This deck has no cards to preview."
              />
            )}
            {cards.map((card) => (
              <CardFrame key={card.id} card={card} />
            ))}
          </div>
        )}

        <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />

        {stream.isFetchingNextPage && (
          <div className={styles.loadingRow}>Loading more…</div>
        )}
      </div>

      {downloadUrl != null && (
        <div className={styles.downloadRow}>
          <a
            href={downloadUrl}
            className={styles.downloadButton}
            onClick={() => track('shared_deck_downloaded')}
          >
            Download deck
          </a>
          <a
            href="/upload"
            className={styles.remixButton}
            onClick={() => track('shared_deck_convert_clicked')}
          >
            Make your own deck
          </a>
        </div>
      )}
    </div>
  );
}
