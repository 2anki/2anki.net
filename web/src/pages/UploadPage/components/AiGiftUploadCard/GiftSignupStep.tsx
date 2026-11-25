import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import RegisterForm from '../../../../components/forms/RegisterForm';
import {
  GIFT_SIGNUP_ORIGIN,
  rememberGiftSignupOrigin,
} from '../../../../lib/aiGift/giftSignupOrigin';
import { HeldFileRows } from './HeldFileRows';
import styles from './AiGiftUploadCard.module.css';

function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error != null && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

interface Props {
  files: readonly File[];
  // null while the browser is still storing it.
  kept: boolean | null;
  onRemove: () => void;
}

// A signed-out visitor sees the file they dropped while they make the
// account, in the same card. Every way out of the form comes back to /upload
// in this tab, where the card hands the file back if the browser kept it; when
// it could not, the card says so before they leave.
export function GiftSignupStep({ files, kept, onRemove }: Readonly<Props>) {
  const { t } = useTranslation('aiGift');
  const [error, setError] = useState('');

  useEffect(() => {
    rememberGiftSignupOrigin();
  }, []);

  return (
    <div className={styles.step}>
      <HeldFileRows files={files} onRemove={onRemove} />
      {kept != null && (
        <p className={styles.signupLead} role={kept ? undefined : 'status'}>
          {kept ? t('card.signupLead') : t('card.notKept')}
        </p>
      )}
      {error && (
        <p className={styles.signupError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.signupForm}>
        <RegisterForm
          variant="inline"
          redirect="/upload"
          eventOrigin={GIFT_SIGNUP_ORIGIN}
          setErrorMessage={(e) => setError(errorText(e))}
        />
      </div>
    </div>
  );
}
