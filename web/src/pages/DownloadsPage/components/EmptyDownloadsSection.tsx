import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import sharedStyles from '../../../styles/shared.module.css';
import styles from './EmptyDownloadsSection.module.css';

interface Props {
  isEmpty: boolean;
}

export function EmptyDownloadsSection({ isEmpty }: Readonly<Props>) {
  const { t } = useTranslation();
  if (!isEmpty) {
    return null;
  }
  return (
    <>
      <div className={sharedStyles.card}>
        <div className={sharedStyles.emptyState}>
          <p className={sharedStyles.sectionTitle}>
            {t('downloads.empty.title')}
          </p>
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              margin: '0.5rem 0 1.5rem',
            }}
          >
            {t('downloads.empty.body')}
          </p>
          <Link
            to="/notion"
            className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
          >
            {t('downloads.empty.makeDeck')}
          </Link>
        </div>
      </div>
      <p className={styles.emptyHint}>
        {t('downloads.empty.needHelp')}{' '}
        <Link
          to="/"
          style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
        >
          {t('downloads.empty.uploadFile')}
        </Link>
      </p>
    </>
  );
}
