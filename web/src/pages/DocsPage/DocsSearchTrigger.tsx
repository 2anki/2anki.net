import { useTranslation } from 'react-i18next';
import { useAppLanguage } from '../../lib/i18n/useAppLanguage';
import styles from './DocsPage.module.css';

interface DocsSearchTriggerProps {
  onOpen: () => void;
}

export function DocsSearchTrigger({
  onOpen,
}: Readonly<DocsSearchTriggerProps>) {
  const { t } = useTranslation('docs');
  const appLanguage = useAppLanguage();
  return (
    <button
      type="button"
      className={styles.searchTrigger}
      onClick={onOpen}
      lang={appLanguage}
    >
      <span className={styles.searchTriggerIcon} aria-hidden="true">
        ⌕
      </span>
      <span className={styles.searchTriggerLabel}>{t('search.trigger')}</span>
      <kbd className={styles.searchTriggerKbd}>⌘K</kbd>
    </button>
  );
}
