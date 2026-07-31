import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import styles from './FeedbackWidget.module.css';

type WidgetStatus = 'idle' | 'sending' | 'sent' | 'error';

const EMOJIS = [
  { labelKey: 'feedback.ratingEnraged', emoji: '\u{1F621}', value: 1 },
  { labelKey: 'feedback.ratingSkeptical', emoji: '\u{1F928}', value: 2 },
  { labelKey: 'feedback.ratingLove', emoji: '\u{1F60D}', value: 5 },
] as const;

interface FeedbackWidgetProps {
  page: string;
  onSubmitted?: () => void;
  compact?: boolean;
}

export function FeedbackWidget({
  page,
  onSubmitted,
  compact = false,
}: Readonly<FeedbackWidgetProps>) {
  const { t } = useTranslation('marketing');
  const { data: userLocals } = useUserLocals();
  const userEmail = userLocals?.user?.email;
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<WidgetStatus>('idle');

  useEffect(() => {
    if (userEmail) {
      setEmail((prev) => (prev === '' ? userEmail : prev));
    }
  }, [userEmail]);

  async function handleSubmit() {
    if (selectedRating == null) return;
    setStatus('sending');
    try {
      await get2ankiApi().submitEmojiFeedback(
        selectedRating,
        page,
        comment || undefined,
        email || undefined
      );
      setStatus('sent');
      onSubmitted?.();
    } catch {
      setStatus('error');
    }
  }

  if (status === 'sent') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={compact ? styles.inlineThank : styles.thankYou}
      >
        {t('feedback.thanks')}
      </div>
    );
  }

  return (
    <div className={compact ? styles.widgetCompact : styles.widget}>
      {!compact && <p className={styles.prompt}>{t('feedback.prompt')}</p>}
      <div className={styles.emojiRow}>
        {EMOJIS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-label={t(item.labelKey)}
            className={`${styles.emojiButton} ${selectedRating === item.value ? styles.emojiSelected : ''}`}
            onClick={() => setSelectedRating(item.value)}
          >
            {item.emoji}
          </button>
        ))}
      </div>
      {selectedRating != null && (
        <>
          <textarea
            className={styles.commentInput}
            placeholder={t('feedback.commentPlaceholder')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            maxLength={2000}
          />
          <input
            type="email"
            className={styles.emailInput}
            placeholder={t('feedback.emailPlaceholder')}
            aria-label={t('feedback.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            autoComplete="email"
            data-hj-suppress
          />
          <p className={styles.emailHint}>{t('feedback.emailHint')}</p>
          <button
            type="button"
            className={styles.submitButton}
            onClick={handleSubmit}
            disabled={status === 'sending'}
          >
            {status === 'sending' ? t('feedback.sending') : t('feedback.send')}
          </button>
        </>
      )}
      <div role="status" aria-live="polite">
        {status === 'error' && (
          <p className={styles.errorText}>{t('feedback.error')}</p>
        )}
      </div>
    </div>
  );
}
