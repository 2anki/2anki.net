import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAiGift, AI_GIFT_QUERY_KEY } from '../../lib/hooks/useAiGift';
import {
  sendAiGiftFeedback,
  type AiGiftFeedbackAnswer,
  type AiGiftStatus,
} from '../../lib/backend/aiGift';
import styles from './AiGiftFeedback.module.css';

export const GIFT_FEEDBACK_MAX_LENGTH = 500;

type Step = 'ask' | 'comment' | 'done';

export function AiGiftFeedback() {
  const { t } = useTranslation('aiGift');
  const gift = useAiGift();
  const queryClient = useQueryClient();
  const titleId = useId();
  const commentId = useId();
  const [step, setStep] = useState<Step>('ask');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: AI_GIFT_QUERY_KEY });
  }, [queryClient]);

  if (step !== 'done' && gift?.feedbackDue !== true) return null;

  const markAnswered = () => {
    queryClient.setQueriesData<AiGiftStatus>(
      { queryKey: AI_GIFT_QUERY_KEY },
      (current) => (current == null ? current : { ...current, feedbackDue: false })
    );
  };

  const send = async (answer: AiGiftFeedbackAnswer) => {
    setSending(true);
    await sendAiGiftFeedback(answer, comment);
    setSending(false);
    markAnswered();
    setStep(answer === 'dismissed' ? 'ask' : 'done');
  };

  if (step === 'done') {
    return (
      <section className={styles.card} aria-live="polite">
        <p className={styles.thanks}>{t('feedback.thanks')}</p>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <div className={styles.header}>
        <h2 id={titleId} className={styles.question}>
          {t('feedback.question')}
        </h2>
        <button
          type="button"
          className={styles.close}
          aria-label={t('feedback.close')}
          onClick={() => send('dismissed')}
          disabled={sending}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {step === 'ask' && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.answer}
            onClick={() => send('yes')}
            disabled={sending}
          >
            {t('feedback.yes')}
          </button>
          <button
            type="button"
            className={styles.answer}
            onClick={() => setStep('comment')}
            disabled={sending}
          >
            {t('feedback.no')}
          </button>
        </div>
      )}
      {step === 'comment' && (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void send('no');
          }}
        >
          <label htmlFor={commentId} className={styles.label}>
            {t('feedback.commentLabel')}
          </label>
          <textarea
            id={commentId}
            className={styles.textarea}
            value={comment}
            maxLength={GIFT_FEEDBACK_MAX_LENGTH}
            rows={3}
            onChange={(event) => setComment(event.target.value)}
          />
          <div className={styles.actions}>
            <button type="submit" className={styles.send} disabled={sending}>
              {t('feedback.send')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
