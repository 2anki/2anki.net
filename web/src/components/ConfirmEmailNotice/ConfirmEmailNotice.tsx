import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { track } from '../../lib/analytics/track';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import styles from './ConfirmEmailNotice.module.css';

const SURFACE = 'upload_success_confirm_email';

type SendState = 'idle' | 'sending' | 'sent' | 'error';

interface ConfirmEmailNoticeProps {
  readonly email: string;
  readonly deckName?: string;
}

export function ConfirmEmailNotice({
  email,
  deckName,
}: ConfirmEmailNoticeProps) {
  const { t } = useTranslation('account');
  const shownFiredRef = useRef(false);
  const [sendState, setSendState] = useState<SendState>('idle');

  useEffect(() => {
    if (shownFiredRef.current) return;
    shownFiredRef.current = true;
    track('account_offer_shown', { surface: SURFACE });
  }, []);

  const hasDeckName = deckName != null && deckName.length > 0;

  const sendLink = async () => {
    setSendState('sending');
    track('account_offer_clicked', { surface: SURFACE });
    try {
      const response = await get2ankiApi().requestMagicLink(email, 'login');
      setSendState(response.ok ? 'sent' : 'error');
    } catch {
      setSendState('error');
    }
  };

  return (
    <section className={styles.card} aria-label={t('confirmEmail.aria')}>
      <p className={styles.headline}>{t('confirmEmail.headline')}</p>
      <p className={styles.body} data-hj-suppress>
        {hasDeckName
          ? t('confirmEmail.body', { deckName })
          : t('confirmEmail.bodyNoName')}
      </p>
      {sendState === 'sent' ? (
        <p className={styles.status} role="status">
          {t('confirmEmail.sent')}
        </p>
      ) : (
        <>
          <button
            type="button"
            className={styles.cta}
            disabled={sendState === 'sending'}
            onClick={sendLink}
          >
            {t('confirmEmail.cta')}
          </button>
          {sendState === 'error' && (
            <p
              className={`${styles.status} ${styles.statusError}`}
              role="alert"
            >
              {t('confirmEmail.error')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
