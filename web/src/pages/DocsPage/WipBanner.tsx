import { Trans } from 'react-i18next';
import { useAppLanguage } from '../../lib/i18n/useAppLanguage';
import styles from './DocsPage.module.css';

export function WipBanner() {
  const appLanguage = useAppLanguage();
  return (
    <div className={styles.wipBanner} role="note" lang={appLanguage}>
      <Trans
        i18nKey="docs:wip"
        components={{
          issue: (
            <a
              href="https://github.com/2anki/server/issues/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              open an issue
            </a>
          ),
        }}
      />
    </div>
  );
}
