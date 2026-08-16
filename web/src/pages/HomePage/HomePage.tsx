import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';
import UploadForm from '../UploadPage/components/UploadForm/UploadForm';
import { ErrorHandlerType } from '../../components/errors/helpers/getErrorMessage';
import { useSettingsCardsOptions } from '../../components/modals/SettingsModal/useSettingsCardsOptions';
import ArrowUpTrayIcon from '../../components/icons/ArrowUpTrayIcon';
import SparklesIcon from '../../components/icons/SparklesIcon';
import BookOpenIcon from '../../components/icons/BookOpenIcon';
import ArrowLeftIcon from '../../components/icons/ArrowLeftIcon';
import ArrowRightIcon from '../../components/icons/ArrowRightIcon';
import CameraIcon from '../../components/icons/CameraIcon';
import ChatBubbleIcon from '../../components/icons/ChatBubbleIcon';
import PrinterIcon from '../../components/icons/PrinterIcon';
import RectangleGroupIcon from '../../components/icons/RectangleGroupIcon';
import ShareIcon from '../../components/icons/ShareIcon';
import SwatchIcon from '../../components/icons/SwatchIcon';
import { track } from '../../lib/analytics/track';
import { TrustNote } from '../../components/TrustNote/TrustNote';
import { ShowcaseSection } from './ShowcaseSection';
import sharedStyles from '../../styles/shared.module.css';
import styles from './HomePage.module.css';

const FEATURED_WALKTHROUGH_IDS = new Set([
  'jpR_grXWTTw',
  'roQ3awaVa2E',
  'UnTo_fN1jpc',
]);

const MASCOTS = [
  '/mascot/Notion 1.png',
  '/mascot/Notion 2.png',
  '/mascot/Notion 3.png',
  '/mascot/Notion 4.png',
  '/mascot/Notion 5.png',
];

interface HomePageProps {
  setErrorMessage: ErrorHandlerType;
  isLoggedIn: boolean;
}

const STEPS = [
  {
    title: 'Upload',
    body: 'Drop a Notion export, PDF, Markdown, HTML, CSV, Word, or Excel file.',
    Icon: ArrowUpTrayIcon,
  },
  {
    title: 'Convert',
    body: '2anki builds your deck in seconds — clean cloze, atomic cards, no empty backs. Images, audio, and code blocks come across too.',
    Icon: SparklesIcon,
  },
  {
    title: 'Study',
    body: 'Open the .apkg file in Anki or AnkiDroid. Your cards are ready to review.',
    Icon: BookOpenIcon,
  },
];

const FEATURES = [
  { href: '/notion', tKey: 'notionToAnki', Icon: ArrowRightIcon },
  { href: '/import', tKey: 'ankiToNotion', Icon: ArrowLeftIcon },
  {
    href: '/image-occlusion',
    tKey: 'imageOcclusion',
    Icon: RectangleGroupIcon,
  },
  { href: '/photo-to-deck', tKey: 'photoToDeck', Icon: CameraIcon },
  { href: '/mindmaps', tKey: 'mindMaps', Icon: ShareIcon },
  { href: '/templates', tKey: 'noteTypes', Icon: SwatchIcon },
  { href: '/chat', tKey: 'chat', Icon: ChatBubbleIcon },
  { href: '/print', tKey: 'print', Icon: PrinterIcon },
  { href: '/ankify', tKey: 'autoSync', Icon: SparklesIcon },
];

const WALKTHROUGHS: ReadonlyArray<[string, string]> = [
  ['jpR_grXWTTw', 'PDF to Anki in Seconds — No Plugins, No Manual Work'],
  [
    'roQ3awaVa2E',
    'Image Occlusion Comes to 2anki.net — Anatomy Flashcards in Seconds',
  ],
  ['UnTo_fN1jpc', 'How I use Notion to Anki as a medical student'],
  ['NLUfAWA2LJI', 'Turn any website into Anki flashcards'],
  ['r9pPNl8Mx_Q', 'How to use cloze deletions'],
  ['lpC7C9wJoTA', 'Use Notion to Anki for learning languages'],
  ['vINpYLMW9AE', 'Best Notion hack for medical students'],
  ['E51yLIIS3bk', 'Notion2Anki — Perfekter Workflow fürs Lernen'],
  ['57dW_buqtGM', 'Notion to Anki — Tutorial en Español'],
  ['RHReYOKywZc', 'Créer des flashcards Anki avec Notion'],
];

function VideoCard({
  embedId,
  title,
}: Readonly<{ embedId: string; title: string }>) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className={styles.walkCard}>
        <div className={styles.walkVideo}>
          <iframe
            src={`https://www.youtube.com/embed/${embedId}?autoplay=1`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={styles.walkCard}
      onClick={() => setPlaying(true)}
      aria-label={t('home.walkthroughs.playVideo', { title })}
    >
      <div className={styles.walkThumb}>
        <img
          src={`https://img.youtube.com/vi/${embedId}/hqdefault.jpg`}
          alt={title}
          loading="lazy"
        />
        <span className={styles.walkPlayBtn} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </div>
      <p className={styles.walkCardTitle}>{title}</p>
    </button>
  );
}

export function HomePage({
  setErrorMessage,
  isLoggedIn,
}: Readonly<HomePageProps>) {
  useSettingsCardsOptions(null);
  const { t } = useTranslation();
  // Picking a mascot is cosmetic, but Sonar flags every Math.random as a
  // security hotspot (typescript:S2245) regardless of intent, and crypto costs
  // nothing here. The retry-jitter callers keep Math.random — see the S2245
  // carve-out in .claude/rules/security.md.
  const mascotSrc = useMemo(() => {
    const sample = crypto.getRandomValues(new Uint32Array(1))[0];
    return MASCOTS[sample % MASCOTS.length];
  }, []);
  const [showAll, setShowAll] = useState(false);
  const landingViewedRef = useRef(false);

  useEffect(() => {
    if (!isLoggedIn) track('home_ai_anon_badge_viewed');
  }, [isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn || landingViewedRef.current) return;
    landingViewedRef.current = true;
    track('landing_page_viewed');
  }, [isLoggedIn]);

  if (isLoggedIn) {
    return <Navigate to="/upload" replace />;
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <img src={mascotSrc} alt="" className={styles.mascot} />
        <h1 className={styles.heroTitle}>{t('home.hero.headline')}</h1>
        <p className={styles.heroSubtitle}>{t('home.hero.subtitle')}</p>
        <div className={styles.heroControls}>
          <p className={`${sharedStyles.aiOffBadgeBody} ${styles.heroAiBadge}`}>
            {t('home.hero.aiBadgeIntro')}{' '}
            <Link
              to="/register?redirect=/card-options"
              onClick={() => track('home_ai_anon_badge_clicked')}
            >
              {t('home.hero.createAccount')}
            </Link>
            .
          </p>
        </div>
        <UploadForm setErrorMessage={setErrorMessage} />
        <div className={styles.heroFooter}>
          <Link
            to="/card-options"
            className={styles.cardOptionsLink}
            onClick={() => track('home_card_options_link_clicked')}
          >
            {t('home.hero.cardOptions')}
          </Link>
          <span className={styles.footerDot} aria-hidden="true" />
          <Link
            to="/app"
            className={styles.cardOptionsLink}
            onClick={() => track('home_native_app_link_clicked')}
          >
            {t('home.hero.nativeApps')}
          </Link>
        </div>
      </section>

      <section className={styles.stepsSection}>
        <div className={styles.stepsInner}>
          <h2 className={styles.stepsHeading}>How it works</h2>
          <div className={styles.stepsGrid}>
            {STEPS.map((step) => (
              <div key={step.title} className={styles.step}>
                <span className={styles.stepIcon}>
                  <step.Icon width={22} height={22} />
                </span>
                <p className={styles.stepTitle}>{step.title}</p>
                <p className={styles.stepBody}>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ShowcaseSection />

      <section className={styles.featuresSection}>
        <h2 className={styles.featuresHeading}>{t('home.features.heading')}</h2>
        <div className={styles.featuresGrid}>
          {FEATURES.map((feature) => (
            <Link
              key={feature.href}
              to={feature.href}
              className={styles.featureCard}
            >
              <span className={styles.featureIcon}>
                <feature.Icon width={22} height={22} />
              </span>
              <span className={styles.featureText}>
                <span className={styles.featureTitle}>
                  {t(`home.features.${feature.tKey}.label`)}
                </span>
                <span className={styles.featureBody}>
                  {t(`home.features.${feature.tKey}.body`)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section id="walkthroughs" className={styles.bottomSection}>
        <h2 className={styles.walkHeading}>{t('home.walkthroughs.heading')}</h2>
        <div className={styles.walkGrid}>
          {(showAll
            ? WALKTHROUGHS
            : WALKTHROUGHS.filter(([id]) => FEATURED_WALKTHROUGH_IDS.has(id))
          ).map(([embedId, title]) => (
            <VideoCard key={embedId} embedId={embedId} title={title} />
          ))}
          {showAll && (
            <a href="/contact" className={styles.walkCard}>
              <div className={styles.walkCtaThumb}>
                <span className={styles.walkCtaIcon}>+</span>
                <p className={styles.walkCtaBody}>
                  {t('home.walkthroughs.ctaBody')}
                </p>
              </div>
              <p className={styles.walkCardTitle}>
                {t('home.walkthroughs.cardTitle')}
              </p>
            </a>
          )}
        </div>
        <div className={styles.walkToggleWrap}>
          <button
            type="button"
            className={styles.walkToggle}
            onClick={() => setShowAll(!showAll)}
            aria-expanded={showAll}
          >
            {showAll
              ? t('home.walkthroughs.showFewer')
              : t('home.walkthroughs.showAll', { count: WALKTHROUGHS.length })}
          </button>
        </div>
      </section>

      <TrustNote />
    </div>
  );
}
