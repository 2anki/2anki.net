import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import RegisterForm from '../../../../components/forms/RegisterForm';
import { HeldFileRows } from './HeldFileRows';
import styles from './AiGiftUploadCard.module.css';

export const GIFT_SIGNUP_ORIGIN = 'upload_card_ai';

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
  onRemove: () => void;
}

// A signed-out visitor keeps the file they dropped in view while they make
// the account, in the same card. Every way out of the form comes back to
// /upload in this tab, where the card hands the file back.
export function GiftSignupStep({ files, onRemove }: Readonly<Props>) {
  const { t } = useTranslation('aiGift');
  const [error, setError] = useState('');
  return (
    <div className={styles.step}>
      <HeldFileRows files={files} onRemove={onRemove} />
      <p className={styles.signupLead}>{t('card.signupLead')}</p>
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
