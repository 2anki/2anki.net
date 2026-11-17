import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import useQuery from '../../lib/hooks/useQuery';
import styles from '../../styles/shared.module.css';

const ERROR_MESSAGE_KEYS = new Map([
  ['google_signin_failed', 'auth.topMessage.googleFailed'],
  ['microsoft_signin_failed', 'auth.topMessage.microsoftFailed'],
  ['notion_cancelled', 'auth.topMessage.notionCancelled'],
  ['google_signin_expired', 'auth.topMessage.googleExpired'],
  ['microsoft_signin_expired', 'auth.topMessage.microsoftExpired'],
  ['notion_signin_expired', 'auth.topMessage.notionExpired'],
]);

function TopMessage() {
  const { t } = useTranslation();
  const query = useQuery();
  const errorCode = query.get('error');
  const verified = query.get('verified');

  if (verified === '1') {
    return (
      <output className={styles.alertSuccess}>
        <p>{t('auth.topMessage.emailVerified')}</p>
      </output>
    );
  }

  if (errorCode === 'upload_limit_exceeded') {
    return (
      <div className={styles.alertDanger}>
        <p>
          {t('auth.topMessage.limitPrefix')}
          <Link to="/pricing">{t('auth.topMessage.upgrade')}</Link>
          {t('auth.topMessage.limitSuffix')}
        </p>
      </div>
    );
  }
  if (errorCode) {
    return (
      <div className={styles.alertDanger}>
        <p>
          {t(
            ERROR_MESSAGE_KEYS.get(errorCode) ??
              'auth.topMessage.signInFallback'
          )}
        </p>
      </div>
    );
  }

  return null;
}

export default TopMessage;
