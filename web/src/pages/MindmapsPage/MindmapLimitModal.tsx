import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import styles from '../LimitPage/LimitPage.module.css';
import sharedStyles from '../../styles/shared.module.css';

interface MindmapLimitModalProps {
  onClose: () => void;
  limit: number;
}

export function MindmapLimitModal({
  onClose,
  limit,
}: Readonly<MindmapLimitModalProps>) {
  const { t } = useTranslation('tools');
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>
          {t('mindmaps.limitHeading', { count: limit })}
        </h1>
        <p className={styles.subheading}>
          {t('mindmaps.limitSubheading', { count: limit })}
        </p>
      </div>
      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
        <Link
          to="/pricing"
          style={{
            display: 'inline-block',
            padding: '0.75rem 1.5rem',
            background: 'var(--color-primary)',
            color: '#fff',
            borderRadius: 'var(--radius-md)',
            fontWeight: 'var(--font-semibold)',
            textDecoration: 'none',
          }}
        >
          {t('mindmaps.upgrade')}
        </Link>
        <button
          type="button"
          onClick={onClose}
          className={sharedStyles.btnSecondary}
        >
          {t('mindmaps.notNow')}
        </button>
      </div>
    </div>
  );
}
