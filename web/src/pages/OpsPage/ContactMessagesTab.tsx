import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ContactMessage } from '../../lib/backend/Backend';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import { UNREAD_MESSAGES_QUERY_KEY } from './useUnreadMessageCount';

export default function ContactMessagesTab() {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [failedId, setFailedId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    get2ankiApi()
      .listContactMessages()
      .then(setMessages)
      .catch(() => setError('Failed to load messages'))
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(id: number, nextValue: boolean) {
    setPendingId(id);
    setFailedId(null);
    setActionError(null);
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, is_acknowledged: nextValue } : m))
    );
    try {
      await get2ankiApi().acknowledgeContactMessage(id, nextValue);
      await queryClient.invalidateQueries({
        queryKey: UNREAD_MESSAGES_QUERY_KEY,
      });
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, is_acknowledged: !nextValue } : m
        )
      );
      setFailedId(id);
      setActionError(
        nextValue
          ? "Couldn't mark this message as read. Try again."
          : "Couldn't reopen this message. Try again."
      );
    } finally {
      setPendingId(null);
    }
  }

  if (loading) {
    return <p className={sharedStyles.emptyState}>Loading…</p>;
  }

  if (error) {
    return <p className={sharedStyles.alertDanger}>{error}</p>;
  }

  if (messages.length === 0) {
    return <p className={sharedStyles.emptyState}>No contact messages yet.</p>;
  }

  const unreadCount = messages.filter((m) => !m.is_acknowledged).length;

  return (
    <div className={styles.contactMessages}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>
          Messages — {unreadCount} unread of {messages.length}
        </h2>
        <p className={styles.sectionHint}>
          Acknowledged messages stay in the list, faded.
        </p>
      </header>
      <ul className={styles.messageList}>
        {messages.map((m) => (
          <MessageCard
            key={m.id}
            message={m}
            onToggle={handleToggle}
            isPending={pendingId === m.id}
            error={failedId === m.id ? actionError : null}
          />
        ))}
      </ul>
    </div>
  );
}

interface MessageCardProps {
  message: ContactMessage;
  onToggle: (id: number, nextValue: boolean) => void;
  isPending: boolean;
  error: string | null;
}

function MessageCard({
  message,
  onToggle,
  isPending,
  error,
}: Readonly<MessageCardProps>) {
  const attachments: string[] = (() => {
    try {
      return message.attachments ? JSON.parse(message.attachments) : [];
    } catch {
      return [];
    }
  })();

  const date = new Date(message.created_at).toLocaleString();
  const acked = message.is_acknowledged;

  return (
    <li
      className={`${styles.messageCard} ${acked ? styles.messageCardRead : ''}`}
    >
      <div className={styles.messageHeader}>
        <div>
          <span className={styles.messageName}>{message.name}</span>
          <a href={`mailto:${message.email}`} className={styles.messageEmail}>
            {message.email}
          </a>
        </div>
        <span className={styles.messageDate}>{date}</span>
      </div>
      <p className={styles.messageBody}>{message.message}</p>
      {attachments.length > 0 && (
        <p className={styles.messageAttachments}>
          {attachments.length} attachment{attachments.length === 1 ? '' : 's'}:{' '}
          {attachments.join(', ')}
        </p>
      )}
      <div className={styles.messageActions}>
        <button
          type="button"
          className={sharedStyles.btnSmall}
          aria-pressed={acked}
          disabled={isPending}
          onClick={() => onToggle(message.id, !acked)}
        >
          {pendingLabel(acked, isPending)}
        </button>
        {!acked && (
          <a
            href={`mailto:${message.email}?subject=Re: your message to 2anki`}
            className={sharedStyles.btnPrimary}
          >
            Reply
          </a>
        )}
        {error != null && (
          <span role="alert" className={styles.messageActionError}>
            {error}
          </span>
        )}
      </div>
    </li>
  );
}

function pendingLabel(acked: boolean, isPending: boolean): string {
  if (isPending) {
    return 'Saving…';
  }
  return acked ? 'Acknowledged' : 'Mark as read';
}
