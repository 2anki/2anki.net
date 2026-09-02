import { useEffect, type ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import UploadForm from '../UploadPage/components/UploadForm/UploadForm';
import { ErrorHandlerType } from '../../components/errors/helpers/getErrorMessage';
import { persistSignupOrigin } from '../../lib/signupOrigin';
import { canonicalUrl } from '../../lib/seo/canonicalUrl';
import styles from './LandingPage.module.css';
import sharedStyles from '../../styles/shared.module.css';
import type { LandingCopy } from './types';
import { buildFaqJsonLd } from './landingJsonLd';
import {
  DEFAULT_LANDING_FORMATS,
  DEFAULT_LANDING_STEPS,
} from './landingDefaults';

interface LandingPageProps {
  copy: LandingCopy;
  setErrorMessage: ErrorHandlerType;
  heroSlot?: ReactNode;
}

const STEP_KEYS = ['dropFile', 'buildsDeck', 'openInAnki'] as const;

const STEP_FALLBACK: Record<
  (typeof STEP_KEYS)[number],
  { title: string; body: string }
> = {
  dropFile: DEFAULT_LANDING_STEPS[0],
  buildsDeck: DEFAULT_LANDING_STEPS[1],
  openInAnki: DEFAULT_LANDING_STEPS[2],
};

const FORMATS = DEFAULT_LANDING_FORMATS;

function pageKeyFromPathname(pathname: string): string {
  return pathname.replace(/^\//, '').replace(/\//g, '-');
}

interface HeroActionProps {
  heroSlot?: ReactNode;
  ctaHref?: string;
  ctaLabel?: string;
  setErrorMessage: ErrorHandlerType;
  registerHref: string;
  t: TFunction<'landing'>;
}

function renderHeroAction({
  heroSlot,
  ctaHref,
  ctaLabel,
  setErrorMessage,
  registerHref,
  t,
}: Readonly<HeroActionProps>) {
  if (heroSlot != null) {
    return <div className={styles.uploadWrapper}>{heroSlot}</div>;
  }
  if (ctaHref != null) {
    return (
      <div className={styles.uploadWrapper}>
        <a href={ctaHref} className={sharedStyles.btnPrimary}>
          {ctaLabel}
        </a>
        <p className={styles.secondaryLink}>
          {t('hero.freeQuota', {
            defaultValue: 'Free · up to 1 000 cards per import',
          })}
        </p>
      </div>
    );
  }
  return (
    <>
      <div className={styles.uploadWrapper}>
        <UploadForm setErrorMessage={setErrorMessage} />
      </div>
      <p className={styles.secondaryLink}>
        {t('hero.orPrefix', { defaultValue: 'or ' })}
        <a href={registerHref}>
          {t('hero.signUpFree', { defaultValue: 'sign up free' })}
        </a>
        {' — '}
        <a href="/pricing">
          {t('hero.getDayPass', {
            defaultValue: 'get a Day Pass for $6',
          })}
        </a>
      </p>
    </>
  );
}

function LandingPage({
  copy,
  setErrorMessage,
  heroSlot,
}: Readonly<LandingPageProps>) {
  const { t } = useTranslation('landing');
  useEffect(() => {
    persistSignupOrigin(copy.pathname, globalThis.sessionStorage ?? null);
  }, [copy.pathname]);

  const pageUrl = canonicalUrl(copy.pathname);
  const canonical = canonicalUrl(copy.canonicalPathname ?? copy.pathname);
  const registerHref = `/register?source=${encodeURIComponent(copy.pathname)}`;
  const pageKey = pageKeyFromPathname(copy.pathname);

  const faqJsonLd = buildFaqJsonLd(copy.faqs);

  return (
    <div className={styles.landing}>
      <Helmet>
        <title>{copy.title}</title>
        <meta name="description" content={copy.description} />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={copy.title} />
        <meta property="og:description" content={copy.description} />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:type" content="website" />
        <meta name="twitter:title" content={copy.title} />
        <meta name="twitter:description" content={copy.description} />
        {faqJsonLd != null && (
          <script type="application/ld+json">{faqJsonLd}</script>
        )}
      </Helmet>

      <section
        id="upload"
        className={
          heroSlot == null
            ? styles.hero
            : `${styles.hero} ${styles.heroWithTool}`
        }
      >
        <div className={styles.heroInner}>
          <h1 className={styles.heroTitle}>
            {t(`pages.${pageKey}.h1`, { defaultValue: copy.h1 })}
          </h1>
          <p className={styles.heroSubhead}>
            {t(`pages.${pageKey}.subhead`, { defaultValue: copy.subhead })}
          </p>
          {copy.galleryBadge === true && (
            <p className={styles.secondaryLink}>
              <Trans
                t={t}
                i18nKey="badges.notionGallery"
                defaults="Listed in the <galleryLink>Notion Integration Gallery</galleryLink>."
                components={{
                  galleryLink: (
                    <a
                      href="https://www.notion.com/connections/2anki"
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  ),
                }}
              />
            </p>
          )}
          {renderHeroAction({
            heroSlot,
            ctaHref: copy.ctaHref,
            ctaLabel: copy.ctaLabel,
            setErrorMessage,
            registerHref,
            t,
          })}
        </div>
      </section>

      <section className={styles.stepsSection}>
        <div className={styles.stepsInner}>
          <h2 className={styles.sectionLabel}>
            {t('sections.howItWorks', { defaultValue: 'How it works' })}
          </h2>
          <div className={styles.stepsGrid}>
            {copy.steps != null
              ? copy.steps.map((step, idx) => (
                  <div key={step.title} className={styles.step}>
                    <span className={styles.stepNumber}>{idx + 1}</span>
                    <p className={styles.stepTitle}>{step.title}</p>
                    <p className={styles.stepBody}>{step.body}</p>
                  </div>
                ))
              : STEP_KEYS.map((key, idx) => (
                  <div key={key} className={styles.step}>
                    <span className={styles.stepNumber}>{idx + 1}</span>
                    <p className={styles.stepTitle}>
                      {t(`steps.${key}.title`, {
                        defaultValue: STEP_FALLBACK[key].title,
                      })}
                    </p>
                    <p className={styles.stepBody}>
                      {t(`steps.${key}.body`, {
                        defaultValue: STEP_FALLBACK[key].body,
                      })}
                    </p>
                  </div>
                ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionLabel}>
          {t('sections.supportedFormats', {
            defaultValue: 'Supported formats',
          })}
        </h2>
        <ul className={styles.formatsList}>
          {(copy.formats ?? FORMATS).map((format) => (
            <li key={format} className={styles.formatTag}>
              {format}
            </li>
          ))}
        </ul>
      </section>

      {copy.whatComesAcross != null && (
        <section className={styles.section}>
          <h2 className={styles.sectionLabel}>
            {t('sections.whatYouGet', {
              defaultValue: 'What you actually get in Anki',
            })}
          </h2>
          <dl className={styles.stepsGrid}>
            {copy.whatComesAcross.map((item) => (
              <div key={item.title} className={styles.step}>
                <p className={styles.stepTitle}>{item.title}</p>
                <p className={styles.stepBody}>{item.body}</p>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionLabel}>
          {t('sections.commonQuestions', { defaultValue: 'Common questions' })}
        </h2>
        <div className={styles.faqList}>
          {copy.faqs.map((faq) => (
            <details key={faq.q} className={styles.faqItem}>
              <summary className={styles.faqSummary}>{faq.q}</summary>
              <p className={styles.faqAnswer}>{faq.a}</p>
            </details>
          ))}
        </div>
      </section>

      {copy.relatedLinks != null && copy.relatedLinks.length > 0 && (
        <nav
          className={styles.related}
          aria-label={t('sections.related', { defaultValue: 'Related' })}
        >
          <h2 className={styles.relatedHeading}>
            {t('sections.related', { defaultValue: 'Related' })}
          </h2>
          <ul className={styles.relatedList}>
            {copy.relatedLinks.map((link) => (
              <li key={link.href}>
                <a href={link.href} className={styles.relatedLink}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <section className={styles.footerCta}>
        <p className={styles.footerCtaText}>
          {t('footer.readyPrefix', { defaultValue: 'Ready to try it? ' })}
          <a href="#upload" className={styles.footerCtaLink}>
            {t('footer.dropLink', {
              defaultValue: 'Drop a file at the top of this page.',
            })}
          </a>
        </p>
      </section>
    </div>
  );
}

export default LandingPage;
