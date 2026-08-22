import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { post } from '../../lib/backend/api';
import { useDialog } from '../../lib/hooks/useDialog';
import sharedStyles from '../../styles/shared.module.css';
import styles from './ConsentModal.module.css';

interface ConsentModalProps {
  onAccept: () => void;
  onDismiss: () => void;
}

export default function ConsentModal({
  onAccept,
  onDismiss,
}: Readonly<ConsentModalProps>) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const dialogRef = useDialog(true, onDismiss);

  const handleAccept = async () => {
    setPending(true);
    try {
      const res = await post('/api/chat/consent', {});
      if (res.ok) {
        onAccept();
      } else {
        setNeedsSignIn(true);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={sharedStyles.dialog}
      aria-labelledby="consent-heading"
    >
      <div className={sharedStyles.modalCardNarrow}>
        <div className={sharedStyles.modalHeader}>
          <h2 id="consent-heading" className={sharedStyles.modalHeaderTitle}>
            {t('modals.consent.title')}
          </h2>
        </div>
        <div className={sharedStyles.modalBody}>
          <p className={styles.body}>{t('modals.consent.body')}</p>
          {needsSignIn && (
            <p className={styles.body}>
              <Link to="/login">{t('modals.consent.signIn')}</Link>
              {t('modals.consent.toChat')}
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
              onClick={handleAccept}
              disabled={pending}
            >
              {t('modals.consent.start')}
            </button>
            <button
              type="button"
              className={`${sharedStyles.btnSecondary} ${sharedStyles.btnInline}`}
              onClick={onDismiss}
              disabled={pending}
            >
              {t('modals.consent.notNow')}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
