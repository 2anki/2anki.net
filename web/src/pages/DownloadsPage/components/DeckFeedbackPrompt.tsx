import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { track } from '../../../lib/analytics/track';
import { get2ankiApi } from '../../../lib/backend/get2ankiApi';
import { useUserLocals } from '../../../lib/hooks/useUserLocals';
import styles from './DeckFeedbackPrompt.module.css';

const SUPPRESSED_UNTIL_KEY = '2anki_deck_feedback_suppressed_until';
const DAY_MS = 24 * 60 * 60 * 1000;
export const DISMISSED_SUPPRESSION_MS = 90 * DAY_MS;
export const ANSWERED_SUPPRESSION_MS = 180 * DAY_MS;
export const HAPPY_SCORE_ASK_EVENT = 'happy_score_ask_shown';
const FEEDBACK_PAGE = 'downloads/deck_done';
const POSITIVE_RATING = 5;
const NEGATIVE_RATING = 1;
const COMMENT_MAX = 2000;

export const NEGATIVE_REASONS = [
  { tag: 'images_missing', labelKey: 'feedback.reasonImagesMissing' },
  { tag: 'wrong_cards', labelKey: 'feedback.reasonWrongCards' },
  { tag: 'too_few_cards', labelKey: 'feedback.reasonTooFewCards' },
  { tag: 'other', labelKey: 'feedback.reasonOther' },
] as const;

type ReasonTag = (typeof NEGATIVE_REASONS)[number]['tag'];

export function tagComment(reason: ReasonTag | null, comment: string): string {
  const text = comment.slice(0, COMMENT_MAX).trim();
  if (reason == null) return text;
  return text.length > 0 ? `[${reason}] ${text}` : `[${reason}]`;
}

export interface DeckFeedbackContext {
  jobId?: number | null;
  uploadId?: number | null;
  inputFormat?: string | null;
}

interface DeckFeedbackPromptProps {
  context?: DeckFeedbackContext;
}

type Stage =
  | { kind: 'prompt' }
  | { kind: 'follow-up'; rating: number }
  | { kind: 'sending' }
  | { kind: 'sent'; rating: number; email: string | null }
  | { kind: 'error'; retry: () => void };

function suppressFor(durationMs: number): void {
  try {
    const until = Date.now() + durationMs;
    localStorage.setItem(SUPPRESSED_UNTIL_KEY, String(until));
  } catch {
    // localStorage may be disabled. Best-effort suppression only.
  }
}

export function isDeckFeedbackSuppressed(): boolean {
  try {
    const raw = localStorage.getItem(SUPPRESSED_UNTIL_KEY);
    if (raw == null) return false;
    const until = Number.parseInt(raw, 10);
    if (!Number.isFinite(until)) return false;
    return until > Date.now();
  } catch {
    return false;
  }
}

export function DeckFeedbackPrompt({
  context,
}: Readonly<DeckFeedbackPromptProps>) {
  const { t } = useTranslation('downloadsx');
  const { data: userLocals } = useUserLocals();
  const userEmail = userLocals?.user?.email;
  const [stage, setStage] = useState<Stage>({ kind: 'prompt' });
  const [comment, setComment] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState<ReasonTag | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    track(HAPPY_SCORE_ASK_EVENT);
  }, []);

  useEffect(() => {
    if (userEmail) {
      setEmail((prev) => (prev === '' ? userEmail : prev));
    }
  }, [userEmail]);

  if (dismissed) return null;

  const handleDismiss = () => {
    suppressFor(DISMISSED_SUPPRESSION_MS);
    setDismissed(true);
  };

  const sendRating = async (rating: number, withComment?: string) => {
    const trimmedEmail = email.trim();
    const replyEmail = trimmedEmail.length > 0 ? trimmedEmail : null;
    setStage({ kind: 'sending' });
    try {
      await get2ankiApi().submitEmojiFeedback(
        rating,
        FEEDBACK_PAGE,
        withComment != null && withComment.length > 0 ? withComment : undefined,
        replyEmail ?? undefined,
        context
      );
      suppressFor(ANSWERED_SUPPRESSION_MS);
      setStage({ kind: 'sent', rating, email: replyEmail });
    } catch {
      setStage({
        kind: 'error',
        retry: () => sendRating(rating, withComment),
      });
    }
  };

  const handlePositive = () => {
    setStage({ kind: 'follow-up', rating: POSITIVE_RATING });
  };

  const handleNegative = () => {
    setStage({ kind: 'follow-up', rating: NEGATIVE_RATING });
  };

  const reasonFor = (rating: number): ReasonTag | null =>
    rating === NEGATIVE_RATING ? reason : null;

  const handleSend = (rating: number) => {
    void sendRating(rating, tagComment(reasonFor(rating), comment));
  };

  const handleSkip = (rating: number) => {
    void sendRating(rating, tagComment(reasonFor(rating), ''));
  };

  return (
    <aside className={styles.card} aria-label={t('feedback.ariaLabel')}>
      <button
        type="button"
        className={styles.close}
        onClick={handleDismiss}
        aria-label={t('feedback.dismiss')}
      >
        ×
      </button>

      {stage.kind === 'prompt' && (
        <>
          <p className={styles.prompt}>{t('feedback.prompt')}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={handlePositive}
            >
              {t('feedback.yes')}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={handleNegative}
            >
              {t('feedback.somethingOff')}
            </button>
          </div>
        </>
      )}

      {stage.kind === 'follow-up' && (
        <>
          <label className={styles.prompt} htmlFor="deck-feedback-comment">
            {stage.rating === POSITIVE_RATING
              ? t('feedback.followUpPositive')
              : t('feedback.followUpNegative')}
          </label>
          {stage.rating === NEGATIVE_RATING && (
            <div className={styles.reasons}>
              {NEGATIVE_REASONS.map((item) => (
                <button
                  key={item.tag}
                  type="button"
                  className={`${styles.reason} ${reason === item.tag ? styles.reasonSelected : ''}`}
                  aria-pressed={reason === item.tag}
                  onClick={() =>
                    setReason((current) =>
                      current === item.tag ? null : item.tag
                    )
                  }
                >
                  {t(item.labelKey)}
                </button>
              ))}
            </div>
          )}
          <textarea
            id="deck-feedback-comment"
            className={styles.textarea}
            placeholder={
              stage.rating === POSITIVE_RATING
                ? t('feedback.placeholderPositive')
                : t('feedback.placeholderNegative')
            }
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            maxLength={COMMENT_MAX}
          />
          <input
            type="email"
            className={styles.email}
            placeholder={t('feedback.emailPlaceholder')}
            aria-label={t('feedback.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            autoComplete="email"
            data-hj-suppress
          />
          <p className={styles.emailHint}>{t('feedback.emailHint')}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => handleSend(stage.rating)}
            >
              {t('feedback.send')}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => handleSkip(stage.rating)}
            >
              {t('feedback.skip')}
            </button>
          </div>
        </>
      )}

      {stage.kind === 'sending' && (
        <p className={styles.status}>{t('feedback.sending')}</p>
      )}

      {stage.kind === 'sent' && (
        <>
          <p className={styles.status}>
            {stage.rating === NEGATIVE_RATING
              ? t('feedback.negativeNextStep')
              : t('feedback.received')}
          </p>
          {stage.rating === NEGATIVE_RATING && stage.email != null && (
            <p className={styles.status}>
              {t('feedback.negativeReply', { email: stage.email })}
            </p>
          )}
        </>
      )}

      {stage.kind === 'error' && (
        <>
          <p className={styles.status}>{t('feedback.error')}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={stage.retry}
            >
              {t('feedback.tryAgain')}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
