import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import styles from './DocsPage.module.css';

interface HomeCard {
  title: string;
  description: string;
  to: string;
}

const startHereCards: HomeCard[] = [
  {
    title: 'What is 2anki?',
    description: 'A 60-second tour.',
    to: '/documentation/start-here/what-is-2anki',
  },
  {
    title: 'Connect Notion',
    description: 'The fastest path.',
    to: '/documentation/start-here/connect-notion',
  },
  {
    title: 'Upload a file',
    description: 'PDFs, slides, CSV.',
    to: '/documentation/start-here/upload-a-file',
  },
  {
    title: 'Open in Anki',
    description: 'Desktop and mobile.',
    to: '/documentation/start-here/open-in-anki',
  },
];

const popularPages: HomeCard[] = [
  {
    title: 'Card options reference',
    description: '',
    to: '/documentation/cards/card-options',
  },
  {
    title: 'Common problems',
    description: '',
    to: '/documentation/help/common-problems',
  },
  {
    title: 'How sync works',
    description: '',
    to: '/documentation/sync/how-it-works',
  },
  {
    title: 'Limits and quotas',
    description: '',
    to: '/documentation/help/limits',
  },
];

export function DocsHome() {
  const { t } = useTranslation('docs');
  return (
    <article className={styles.article}>
      <section className={styles.docsHomeHero}>
        <h1 className={styles.docsHomeTitle}>{t('home.title')}</h1>
        <p className={styles.docsHomeTagline}>{t('home.tagline')}</p>
        <div className={styles.docsHomeActions}>
          <Link
            to="/documentation/start-here/connect-notion"
            className={styles.docsHomeButtonPrimary}
          >
            {t('home.connectCta')}
          </Link>
          <Link
            to="/documentation/start-here/upload-a-file"
            className={styles.docsHomeButtonSecondary}
          >
            {t('home.uploadCta')}
          </Link>
        </div>
      </section>

      <section className={styles.docsHomeSection}>
        <h2 className={styles.docsHomeSectionTitle}>{t('home.startHere')}</h2>
        <div className={styles.homeGrid}>
          {startHereCards.map((card) => (
            <Link key={card.to} to={card.to} className={styles.homeCard}>
              <p className={styles.homeCardTitle}>{card.title}</p>
              <p className={styles.homeCardDesc}>{card.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.docsHomeSection}>
        <h2 className={styles.docsHomeSectionTitle}>{t('home.popular')}</h2>
        <ul className={styles.popularList}>
          {popularPages.map((page) => (
            <li key={page.to}>
              <Link to={page.to}>{page.title}</Link>
            </li>
          ))}
        </ul>
      </section>

      <footer className={styles.docsHomeFooter}>
        <Trans
          i18nKey="docs:home.footer"
          components={{
            email: <a href="mailto:support@2anki.net">support@2anki.net</a>,
            issue: (
              <a
                href="https://github.com/2anki/server/issues/new"
                target="_blank"
                rel="noopener noreferrer"
              >
                open an issue on GitHub
              </a>
            ),
          }}
        />
      </footer>
    </article>
  );
}
