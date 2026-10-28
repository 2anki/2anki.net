import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import RegisterForm from '../forms/RegisterForm';
import { track } from '../../lib/analytics/track';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { usePassPrices } from '../../lib/hooks/usePassPrices';
import { ANONYMOUS_CARD_CAP } from '../../pages/LimitPage/LimitWall';
import type { AiPreviewCard } from '../../pages/UploadPage/components/UploadForm/hooks/useUploadFormState';
import styles from './AiPreviewGate.module.css';

interface Props {
  readonly cards: AiPreviewCard[];
  readonly onContinueWithoutAi: () => void;
  readonly busy?: boolean;
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error != null && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

export function AiPreviewGate({
  cards,
  onContinueWithoutAi,
  busy = false,
}: Props) {
  const { t } = useTranslation('aiPreview');
  const prices = usePassPrices();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [signupError, setSignupError] = useState('');

  const hasCards = cards.length > 0;

  const buy = async () => {
    track('ai_preview_pass_clicked', { surface: 'ai-preview' });
    setError('');
    setPending(true);
    try {
      const result = await get2ankiApi().startPassCheckout(
        '24h',
        undefined,
        'ai-preview'
      );
      if ('url' in result) {
        globalThis.location.href = result.url;
        return;
      }
      setError(t('checkoutError'));
    } catch {
      setError(t('checkoutError'));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className={styles.gate} aria-label={t('gateAria')}>
      {hasCards ? (
        <>
          <p className={styles.heading}>{t('heading')}</p>
          <p className={styles.sampleNote}>{t('sampleNote')}</p>
          <div className={styles.columnLabels} aria-hidden="true">
            <span>{t('front')}</span>
            <span>{t('back')}</span>
          </div>
          <ul className={styles.list}>
            {cards.map((card, i) => (
              <li key={i} className={styles.row}>
                <div className={styles.front}>
                  <span className={styles.mobileLabel}>{t('front')}</span>
                  {card.front}
                </div>
                <div className={styles.back}>
                  <span className={styles.mobileLabel}>{t('back')}</span>
                  {card.back}
                </div>
              </li>
            ))}
          </ul>
          <div className={styles.leadCard}>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              className={styles.buttonPrimary}
              disabled={pending}
              onClick={() => void buy()}
            >
              {pending
                ? t('starting')
                : t('primaryCta', { price: prices['24h'] })}
            </button>
            <p className={styles.primaryNote}>{t('primaryNote')}</p>
          </div>
        </>
      ) : (
        <p className={styles.heading}>{t('previewError')}</p>
      )}

      <button
        type="button"
        className={styles.buttonSecondary}
        disabled={busy}
        aria-busy={busy}
        onClick={onContinueWithoutAi}
      >
        {busy ? t('common:upload.form.checkingSignIn') : t('secondaryCta')}
      </button>
      <p className={styles.secondaryNote}>
        {t('secondaryNote', { cap: ANONYMOUS_CARD_CAP })}
      </p>

      <p className={styles.leadIn}>{t('signupLeadIn')}</p>
      <div className={styles.form}>
        <RegisterForm
          variant="inline"
          redirect="/upload"
          setErrorMessage={(e) => setSignupError(errorText(e))}
        />
      </div>
      {signupError && (
        <p className={styles.error} role="alert">
          {signupError}
        </p>
      )}
    </section>
  );
}

export default AiPreviewGate;
