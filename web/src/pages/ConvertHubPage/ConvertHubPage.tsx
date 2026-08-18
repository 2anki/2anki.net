import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import styles from './ConvertHubPage.module.css';
import { CONVERT_HUB_GROUPS } from './convertHubGroups';
import { canonicalUrl } from '../../lib/seo/canonicalUrl';

function groupKey(heading: string): string {
  return heading.toLowerCase().replace(/\s+/g, '-');
}

const TITLE = 'Convert anything to Anki — every converter | 2anki';
const DESCRIPTION =
  'Browse every 2anki converter in one place. Turn Notion, Markdown, PDF, CSV, Quizlet, Brainscape, Pleco, and more into Anki flashcard decks.';
const H1 = 'Convert anything to Anki';
const SUBHEAD =
  'Pick your source. Every converter turns your notes, files, or flashcards into a clean .apkg deck you study in Anki.';

function ConvertHubPage() {
  const { t } = useTranslation('landing');
  const canonical = canonicalUrl('/convert');

  return (
    <div className={styles.page}>
      <Helmet>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content={canonical} />
        <meta property="og:type" content="website" />
        <meta name="twitter:title" content={TITLE} />
        <meta name="twitter:description" content={DESCRIPTION} />
      </Helmet>

      <header className={styles.hero}>
        <h1 className={styles.h1}>{t('hub.h1', { defaultValue: H1 })}</h1>
        <p className={styles.subhead}>
          {t('hub.subhead', { defaultValue: SUBHEAD })}
        </p>
      </header>

      {CONVERT_HUB_GROUPS.map((group) => (
        <section key={group.heading} className={styles.group}>
          <h2 className={styles.groupHeading}>
            {t(`hub.groups.${groupKey(group.heading)}`, {
              defaultValue: group.heading,
            })}
          </h2>
          <ul className={styles.list}>
            {group.entries.map((entry) => (
              <li key={entry.slug} className={styles.item}>
                <a href={entry.href} className={styles.itemLink}>
                  {entry.anchor}
                </a>
                <p className={styles.itemBlurb}>{entry.blurb}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default ConvertHubPage;
