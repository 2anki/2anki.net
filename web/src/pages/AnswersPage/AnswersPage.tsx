import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import NotFoundPage from '../NotFoundPage';
import { canonicalUrl } from '../../lib/seo/canonicalUrl';
import { AnswerFigure } from './AnswerFigures';
import { ANSWERS_PAGES } from './answersConfig';
import styles from './AnswersPage.module.css';
import { buildArticleJsonLd, buildFaqJsonLd } from './answersJsonLd';

export { buildArticleJsonLd, buildFaqJsonLd };

function AnswersPage() {
  const { t } = useTranslation('landing');
  const { slug } = useParams<{ slug: string }>();
  const config = slug == null ? undefined : ANSWERS_PAGES.get(slug);

  if (config == null) {
    return <NotFoundPage />;
  }

  const canonical = canonicalUrl(`/answers/${config.slug}`);

  const articleJsonLd = buildArticleJsonLd(config);
  const faqJsonLd = buildFaqJsonLd(config);

  return (
    <div className={styles.page}>
      <Helmet>
        <title>{config.title}</title>
        <meta name="description" content={config.description} />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={config.title} />
        <meta property="og:description" content={config.description} />
        <meta property="og:url" content={canonical} />
        <meta property="og:type" content="article" />
        <script type="application/ld+json">{articleJsonLd}</script>
        {faqJsonLd && <script type="application/ld+json">{faqJsonLd}</script>}
      </Helmet>

      <h1 className={styles.h1}>
        {t(`answers.${config.slug}.h1`, { defaultValue: config.h1 })}
      </h1>
      <p className={styles.intro}>
        {t(`answers.${config.slug}.intro`, { defaultValue: config.intro })}
      </p>

      {config.sections.map((section) => (
        <div key={section.heading} className={styles.section}>
          <h2 className={styles.sectionHeading}>{section.heading}</h2>
          <p className={styles.sectionBody}>{section.body}</p>
          {section.figure && (
            <AnswerFigure
              kind={section.figure.kind}
              caption={section.figure.caption}
            />
          )}
        </div>
      ))}

      {config.faqs && config.faqs.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionHeading}>
            {t('answers.faqHeading', {
              defaultValue: 'Frequently asked questions',
            })}
          </h2>
          {config.faqs.map((faq) => (
            <div key={faq.q}>
              <h3 className={styles.sectionHeading}>{faq.q}</h3>
              <p className={styles.sectionBody}>{faq.a}</p>
            </div>
          ))}
        </div>
      )}

      <nav
        className={styles.related}
        aria-label={t('sections.related', { defaultValue: 'Related' })}
      >
        <p className={styles.relatedHeading}>
          {t('sections.related', { defaultValue: 'Related' })}
        </p>
        <ul className={styles.relatedList}>
          {config.relatedLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href} className={styles.relatedLink}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export default AnswersPage;
