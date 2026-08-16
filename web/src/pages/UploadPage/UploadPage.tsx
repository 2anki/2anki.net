import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { isPayingUser } from '../../components/NavigationBar/helpers/getPlanLabel';
import { ErrorHandlerType } from '../../components/errors/helpers/getErrorMessage';
import { track } from '../../lib/analytics/track';
import { storePassToken } from '../../lib/anonymousPass';
import { saveValueInLocalStorage } from '../../lib/data_layer/saveValueInLocalStorage';
import useQuery from '../../lib/hooks/useQuery';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import styles from '../../styles/shared.module.css';
import { ExploreCard } from './components/ExploreCard/ExploreCard';
import { OnboardingTour } from './components/OnboardingTour/OnboardingTour';
import { RecentSources } from './components/RecentSources/RecentSources';
import UploadForm from './components/UploadForm/UploadForm';
import pageStyles from './UploadPage.module.css';

const REATTACH_KEY = 'upload_pending_filename';
const SIGNUP_FLAG_KEY = 'signup_completed_tracked';
const SIGNUP_RECENCY_MS = 10 * 60 * 1000;
const AI_FLAG_KEY = 'claude-ai-flashcards';

type AiBadgeState = 'anon' | 'free' | 'on' | 'off';

interface Props {
  setErrorMessage: ErrorHandlerType;
}

function deriveAiBadgeState(
  isSignedIn: boolean,
  isPaying: boolean,
  isAiOn: boolean
): AiBadgeState {
  if (!isSignedIn) return 'anon';
  if (!isPaying) return 'free';
  if (isAiOn) return 'on';
  return 'off';
}

function isFreshSignup(
  createdAt: string | null | undefined,
  onboardedAt: string | null | undefined
): boolean {
  if (createdAt == null) return false;
  if (onboardedAt != null) return false;
  const createdMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdMs)) return false;
  return Date.now() - createdMs <= SIGNUP_RECENCY_MS;
}

export function UploadPage({ setErrorMessage }: Readonly<Props>) {
  const { t } = useTranslation();
  const query = useQuery();
  const view = query.get('view');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [reattachFilename, setReattachFilename] = useState<string | null>(
    () => {
      const stored = globalThis.sessionStorage?.getItem(REATTACH_KEY) ?? null;
      return stored != null && stored.length > 0 ? stored : null;
    }
  );
  const { data: userLocals } = useUserLocals();
  const pageViewTracked = useRef(false);
  const signupTracked = useRef(false);

  const isSignedIn = userLocals?.user?.id != null;
  const isPaying = isPayingUser(userLocals?.locals);
  const [aiFlag, setAiFlag] = useState(
    () => globalThis.localStorage?.getItem(AI_FLAG_KEY) === 'true'
  );

  useEffect(() => {
    setAiFlag(globalThis.localStorage?.getItem(AI_FLAG_KEY) === 'true');
  }, [isSignedIn]);

  const isAiOn = isPaying && aiFlag;
  const aiBadgeState = deriveAiBadgeState(isSignedIn, isPaying, isAiOn);

  const toggleAi = () => {
    const next = !isAiOn;
    saveValueInLocalStorage(AI_FLAG_KEY, String(next), null);
    setAiFlag(next);
    track(next ? 'upload_ai_turned_on' : 'upload_ai_turned_off');
  };

  useEffect(() => {
    track('upload_ai_badge_viewed', { state: aiBadgeState });
  }, [aiBadgeState]);

  useEffect(() => {
    if (pageViewTracked.current) return;
    pageViewTracked.current = true;
    track('upload_page_viewed');
  }, []);

  useEffect(() => {
    if (signupTracked.current) return;
    const user = userLocals?.user;
    if (user?.id == null) return;
    if (!isFreshSignup(user.created_at, user.onboarded_at)) return;
    if (globalThis.sessionStorage?.getItem(SIGNUP_FLAG_KEY) != null) return;
    signupTracked.current = true;
    globalThis.sessionStorage?.setItem(SIGNUP_FLAG_KEY, '1');
    track('signup_completed', { method: 'oauth' });
  }, [userLocals]);

  useEffect(() => {
    if (searchParams.get('from') === 'pass') {
      const next = new URLSearchParams(searchParams);
      next.delete('from');
      const qs = next.toString();
      navigate(qs ? `/upload?${qs}` : '/upload', { replace: true });
    }
  }, [searchParams, navigate]);

  useEffect(() => {
    const passSession = searchParams.get('pass_session');
    if (passSession != null && passSession.length > 0) {
      // Owner decision: anonymous passes live in the browser (localStorage is sanctioned for this use case)
      storePassToken(passSession);
      const next = new URLSearchParams(searchParams);
      next.delete('pass_session');
      const qs = next.toString();
      navigate(qs ? `/upload?${qs}` : '/upload', { replace: true });
    }
  }, [searchParams, navigate]);

  if (
    view === 'template' ||
    view === 'deck-options' ||
    view === 'card-options'
  ) {
    return <Navigate to="/card-options" replace />;
  }

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Upload — 2anki</title>
      </Helmet>
      <header className={styles.pageHeader}>
        <h1 className={styles.title}>{t('upload.page.title')}</h1>
        <p className={styles.subtitle}>{t('upload.page.subtitle')}</p>
      </header>
      <OnboardingTour
        createdAt={userLocals?.user?.created_at ?? null}
        onboardedAt={userLocals?.user?.onboarded_at ?? null}
      />
      {reattachFilename != null && (
        <div className={pageStyles.reattachBanner} role="status">
          <span>{t('upload.page.reattachPrefix')} </span>
          <strong>{reattachFilename}</strong>
          <span> {t('upload.page.reattachSuffix')}</span>
        </div>
      )}
      <div className={styles.aiOffBadge} role="status">
        {aiBadgeState === 'on' && (
          <>
            <button
              type="button"
              className={styles.aiToggle}
              aria-pressed="true"
              aria-label={t('upload.page.turnAiOff')}
              onClick={toggleAi}
            >
              <span className={styles.badgeSuccess}>
                {t('upload.page.aiOn')}
              </span>
            </button>
            <span className={styles.aiOffBadgeBody}>
              <span> {t('upload.page.aiOnBody')} </span>
              <Link
                to="/card-options?returnTo=/upload#pdf-ai"
                onClick={() => track('upload_ai_settings_link_clicked')}
              >
                {t('upload.page.manageInSettings')}
              </Link>
              <span>.</span>
            </span>
          </>
        )}
        {aiBadgeState === 'off' && (
          <>
            <button
              type="button"
              className={styles.aiToggle}
              aria-pressed="false"
              aria-label={t('upload.page.turnAiOn')}
              onClick={toggleAi}
            >
              <span className={styles.badgeWarning}>
                {t('upload.page.aiOff')}
              </span>
            </button>
            <span className={styles.aiOffBadgeBody}>
              <span> {t('upload.page.aiOffBody')} </span>
              <button
                type="button"
                className={styles.aiInlineLink}
                onClick={toggleAi}
              >
                {t('upload.page.turnOnClaudeCards')}
              </button>
              <span>. </span>
              <Link to="/card-options?returnTo=/upload">
                {t('upload.page.manageInSettings')}
              </Link>
              <span>.</span>
            </span>
          </>
        )}
        {aiBadgeState === 'free' && (
          <>
            <span className={styles.badgeWarning}>
              {t('upload.page.aiOff')}
            </span>
            <span className={styles.aiOffBadgeBody}>
              <span> {t('upload.page.aiOffBody')} </span>
              <Link
                to="/pricing"
                onClick={() => track('upload_ai_free_badge_clicked')}
              >
                {t('upload.page.upgradeClaude')}
              </Link>
              <span>. </span>
              <Link to="/card-options?returnTo=/upload">
                {t('upload.page.manageInSettings')}
              </Link>
              <span>.</span>
            </span>
          </>
        )}
        {aiBadgeState === 'anon' && (
          <span className={styles.aiOffBadgeBody}>
            <span>{t('upload.page.aiAnonIntro')} </span>
            <Link
              to="/login?redirect=/card-options"
              onClick={() => track('upload_ai_anon_badge_clicked')}
            >
              {t('upload.page.signInToTurnOn')}
            </Link>
            <span>.</span>
          </span>
        )}
      </div>
      <UploadForm setErrorMessage={setErrorMessage} aiOn={isAiOn} />
      {isSignedIn && <RecentSources />}
      <ExploreCard />
      <section className={pageStyles.howItWorks}>
        <h2 className={pageStyles.howItWorksHeading}>
          {t('upload.page.howItWorks')}
        </h2>
        <p className={pageStyles.footnote}>{t('upload.page.filesDeleted')}</p>
        <div className={pageStyles.steps}>
          <div className={pageStyles.step}>
            <span className={pageStyles.stepNumber}>1</span>
            <div>
              <p className={pageStyles.stepTitle}>
                {t('upload.page.step1Title')}
              </p>
              <p className={pageStyles.stepBody}>
                {t('upload.page.step1Body')}
              </p>
              <p className={pageStyles.stepBody}>
                {t('upload.page.comingFromNotion')}{' '}
                <a href="/documentation/start-here/upload-a-file">
                  {t('upload.page.howToExport')}
                </a>
              </p>
            </div>
          </div>
          <div className={pageStyles.step}>
            <span className={pageStyles.stepNumber}>2</span>
            <div>
              <p className={pageStyles.stepTitle}>
                {t('upload.page.step2Title')}
              </p>
              <p className={pageStyles.stepBody}>
                {t('upload.page.step2Body')}
              </p>
            </div>
          </div>
          <div className={pageStyles.step}>
            <span className={pageStyles.stepNumber}>3</span>
            <div>
              <p className={pageStyles.stepTitle}>
                {t('upload.page.step3Title')}
              </p>
              <p className={pageStyles.stepBody}>
                {t('upload.page.step3Body')}
              </p>
            </div>
          </div>
        </div>
      </section>
      <section
        className={pageStyles.contactNudge}
        aria-label={t('upload.page.contactAria')}
      >
        <p>
          {t('upload.page.contactPrefix')}{' '}
          <Link to="/contact">{t('upload.page.tellUs')}</Link>{' '}
          {t('upload.page.orEmail')}{' '}
          <a href="mailto:support@2anki.net">support@2anki.net</a>.
        </p>
      </section>
    </div>
  );
}
