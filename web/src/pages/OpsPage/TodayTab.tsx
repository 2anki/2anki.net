import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { ContactMessage } from '../../lib/backend/Backend';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import {
  EmojiFeedbackCommentPoint,
  CancellationCommentPoint,
} from './businessTypes';
import styles from './OpsPage.module.css';
import Scoreboard from './Scoreboard';
import { useBusinessMetrics } from './useBusinessMetrics';
import { useTodaySnapshot } from './useTodaySnapshot';

const MESSAGE_PREVIEW_MAX = 3;

function useContactMessages() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  useEffect(() => {
    let cancelled = false;
    get2ankiApi()
      .listContactMessages()
      .then((list) => {
        if (!cancelled) setMessages(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return messages;
}

const EMOJI_BY_RATING: Record<number, string> = {
  1: '\u{1F620}',
  2: '\u{1F615}',
  3: '\u{1F610}',
  4: '\u{1F642}',
  5: '\u{1F929}',
};

function VoiceOfUserBlock({
  messages,
  cancellations,
  emojiComments,
}: Readonly<{
  messages: ContactMessage[];
  cancellations: CancellationCommentPoint[];
  emojiComments: EmojiFeedbackCommentPoint[];
}>) {
  const unread = messages.filter((m) => !m.is_acknowledged);
  const recentMessages = unread.slice(0, MESSAGE_PREVIEW_MAX);
  const recentCancellations = cancellations.slice(0, MESSAGE_PREVIEW_MAX);
  const recentEmoji = emojiComments.slice(0, MESSAGE_PREVIEW_MAX);

  return (
    <section className={styles.todaySection}>
      <h2 className={styles.sectionTitle}>Voice of user</h2>
      <ul className={styles.voiceList}>
        <li className={styles.voiceRow}>
          <Link to="/ops/messages" className={styles.voiceLink}>
            Unread messages
          </Link>
          <span className={styles.scoreValue}>{unread.length}</span>
        </li>
        {recentMessages.map((m) => (
          <li key={m.id} className={styles.voiceRow}>
            <Link to="/ops/messages" className={styles.voicePreview}>
              {m.message}
            </Link>
          </li>
        ))}
        {recentCancellations.map((c) => (
          <li key={`${c.created_at}-${c.reason}`} className={styles.voiceRow}>
            <Link
              to="/ops/business#cancellations"
              className={styles.voicePreview}
            >
              Cancelled — {c.reason}: {c.comment}
            </Link>
          </li>
        ))}
        {recentEmoji.map((e) => (
          <li key={`${e.created_at}-${e.page}`} className={styles.voiceRow}>
            <Link
              to="/ops/business#emoji-feedback"
              className={styles.voicePreview}
            >
              {EMOJI_BY_RATING[e.rating] ?? e.rating} {e.comment} — {e.page}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function TodayTab() {
  const snapshot = useTodaySnapshot();
  const business = useBusinessMetrics();
  const messages = useContactMessages();
  const businessData = business.data ?? null;

  return (
    <div className={styles.todayLayout}>
      <Scoreboard
        snapshot={snapshot.data}
        error={snapshot.error}
        isLoading={snapshot.isLoading}
      />
      <VoiceOfUserBlock
        messages={messages}
        cancellations={businessData?.cancellation_comments_recent ?? []}
        emojiComments={businessData?.emoji_feedback_comments ?? []}
      />
    </div>
  );
}
