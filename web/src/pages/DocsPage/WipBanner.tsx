import { Trans } from 'react-i18next';
import styles from './DocsPage.module.css';

export function WipBanner() {
  return (
    <div className={styles.wipBanner} role="note">
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
