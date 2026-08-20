import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, ReactElement, useEffect, useState } from 'react';
import { CookiesProvider, useCookies } from 'react-cookie';
import { HelmetProvider } from 'react-helmet-async';
import { I18nextProvider } from 'react-i18next';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { AppShell } from './components/AppShell/AppShell';
import { ChunkReloadOverlay } from './components/ChunkReloadOverlay/ChunkReloadOverlay';
import { DomRecoveryBoundary } from './components/DomRecoveryBoundary/DomRecoveryBoundary';
import { getErrorMessage } from './components/errors/helpers/getErrorMessage';
import { SkeletonPage } from './components/Skeleton/Skeleton';
import { VerifyEmailNotice } from './components/VerifyEmailNotice/VerifyEmailNotice';
import {
  clearReloadingFlag,
  isReloadingForFreshChunks,
  lazyWithRetry,
} from './lib/chunkReload';
import { captureFirstTouch } from './lib/firstTouch';
import i18n from './lib/i18n';
import { useUserLocals } from './lib/hooks/useUserLocals';
import isOfflineMode from './lib/isOfflineMode';
import { reportClientError } from './lib/reportClientError';
import AboutPage from './pages/AboutPage/AboutPage';
import { ContactPage } from './pages/ContactPage/ContactPage';
import DebugPage from './pages/DebugPage';
import DeleteAccountPage from './pages/DeleteAccountPage';
import FavoritesPage from './pages/FavoritesPage';
import HomePage from './pages/HomePage';
import NotFoundPage from './pages/NotFoundPage';
import UploadPage from './pages/UploadPage';

const RegisterPage = lazyWithRetry(
  () => import('./pages/RegisterPage'),
  './pages/RegisterPage'
);
const SearchPage = lazyWithRetry(
  () => import('./pages/SearchPage'),
  './pages/SearchPage'
);
const LoginPage = lazyWithRetry(
  () => import('./pages/LoginPage'),
  './pages/LoginPage'
);
const NewPasswordPage = lazyWithRetry(
  () => import('./pages/NewPasswordPage'),
  './pages/NewPasswordPage'
);
const DownloadsPage = lazyWithRetry(
  () => import('./pages/DownloadsPage'),
  './pages/DownloadsPage'
);
const ForgotPasswordPage = lazyWithRetry(
  () => import('./pages/ForgotPasswordPage'),
  './pages/ForgotPasswordPage'
);
const PricingPage = lazyWithRetry(
  () => import('./pages/PricingPage'),
  './pages/PricingPage'
);
const AccountPage = lazyWithRetry(
  () => import('./pages/AccountPage/AccountPage'),
  './pages/AccountPage/AccountPage'
);
const AccountClaimPage = lazyWithRetry(
  () => import('./pages/AccountClaimPage/AccountClaimPage'),
  './pages/AccountClaimPage/AccountClaimPage'
);
const AccountPreviewPage = import.meta.env.DEV
  ? lazy(() => import('./pages/AccountPreviewPage/AccountPreviewPage'))
  : null;
const NotionPreviewPage = import.meta.env.DEV
  ? lazy(() => import('./pages/NotionPreviewPage/NotionPreviewPage'))
  : null;
const AnkifyReviewPreviewPage = import.meta.env.DEV
  ? lazy(
      () => import('./pages/AnkifyReviewPreviewPage/AnkifyReviewPreviewPage')
    )
  : null;
const UploadSuccessPreviewPage = import.meta.env.DEV
  ? lazy(
      () => import('./pages/UploadSuccessPreviewPage/UploadSuccessPreviewPage')
    )
  : null;
const DownloadsPreviewPage = import.meta.env.DEV
  ? lazy(() => import('./pages/DownloadsPreviewPage/DownloadsPreviewPage'))
  : null;
const SuccessfulCheckoutPage = lazyWithRetry(
  () => import('./pages/SuccessfulCheckout/SuccessfulCheckout'),
  './pages/SuccessfulCheckout/SuccessfulCheckout'
);
const DocsPage = lazyWithRetry(
  () => import('./pages/DocsPage/DocsPage'),
  './pages/DocsPage/DocsPage'
);
const CardOptionsPage = lazyWithRetry(
  () => import('./pages/CardOptionsPage'),
  './pages/CardOptionsPage'
);
const TemplatesPage = lazyWithRetry(
  () => import('./pages/TemplatesPage'),
  './pages/TemplatesPage'
);
const TemplatesEditorPage = lazyWithRetry(
  () => import('./pages/TemplatesPage/EditorPage'),
  './pages/TemplatesPage/EditorPage'
);
const RulesPage = lazyWithRetry(
  () => import('./pages/RulesPage'),
  './pages/RulesPage'
);
const PreviewPage = lazyWithRetry(
  () => import('./pages/PreviewPage'),
  './pages/PreviewPage'
);
const DatabasePreviewPage = lazyWithRetry(
  () => import('./pages/DatabasePreviewPage'),
  './pages/DatabasePreviewPage'
);
const PreviewApkgPage = lazyWithRetry(
  () => import('./pages/PreviewApkgPage'),
  './pages/PreviewApkgPage'
);
const AnkifyPage = lazyWithRetry(
  () => import('./pages/AnkifyPage'),
  './pages/AnkifyPage'
);
const AnkifySetupPage = lazyWithRetry(
  () => import('./pages/AnkifyPage/AnkifySetupPage'),
  './pages/AnkifyPage/AnkifySetupPage'
);
const AnkifyHistoryPage = lazyWithRetry(
  () => import('./pages/AnkifyPage/AnkifyHistoryPage'),
  './pages/AnkifyPage/AnkifyHistoryPage'
);
const OpsLayout = lazyWithRetry(
  () => import('./pages/OpsPage/OpsLayout'),
  './pages/OpsPage/OpsLayout'
);
const TodayTab = lazyWithRetry(
  () => import('./pages/OpsPage/TodayTab'),
  './pages/OpsPage/TodayTab'
);
const GrowthTab = lazyWithRetry(
  () => import('./pages/OpsPage/GrowthTab'),
  './pages/OpsPage/GrowthTab'
);
const SystemTab = lazyWithRetry(
  () => import('./pages/OpsPage/SystemTab'),
  './pages/OpsPage/SystemTab'
);
const ControlsTab = lazyWithRetry(
  () => import('./pages/OpsPage/ControlsTab'),
  './pages/OpsPage/ControlsTab'
);
const ErrorsTab = lazyWithRetry(
  () => import('./pages/OpsPage/ErrorsTab'),
  './pages/OpsPage/ErrorsTab'
);
const BusinessTab = lazyWithRetry(
  () => import('./pages/OpsPage/BusinessTab'),
  './pages/OpsPage/BusinessTab'
);
const ContactMessagesTab = lazyWithRetry(
  () => import('./pages/OpsPage/ContactMessagesTab'),
  './pages/OpsPage/ContactMessagesTab'
);
const NotionToAnki = lazyWithRetry(
  () => import('./pages/LandingPage/NotionToAnki'),
  './pages/LandingPage/NotionToAnki'
);
const AnkiToNotion = lazyWithRetry(
  () => import('./pages/LandingPage/AnkiToNotion'),
  './pages/LandingPage/AnkiToNotion'
);
const QuizletToAnki = lazyWithRetry(
  () => import('./pages/LandingPage/QuizletToAnki'),
  './pages/LandingPage/QuizletToAnki'
);
const MarkdownToAnki = lazyWithRetry(
  () => import('./pages/LandingPage/MarkdownToAnki'),
  './pages/LandingPage/MarkdownToAnki'
);
const PdfToAnki = lazyWithRetry(
  () => import('./pages/LandingPage/PdfToAnki'),
  './pages/LandingPage/PdfToAnki'
);
const UsmleAnki = lazyWithRetry(
  () => import('./pages/LandingPage/UsmleAnki'),
  './pages/LandingPage/UsmleAnki'
);
const NursingFlashcards = lazyWithRetry(
  () => import('./pages/LandingPage/NursingFlashcards'),
  './pages/LandingPage/NursingFlashcards'
);
const Step1Anki = lazyWithRetry(
  () => import('./pages/LandingPage/Step1Anki'),
  './pages/LandingPage/Step1Anki'
);
const NclexAnki = lazyWithRetry(
  () => import('./pages/LandingPage/NclexAnki'),
  './pages/LandingPage/NclexAnki'
);
const McatAnki = lazyWithRetry(
  () => import('./pages/LandingPage/McatAnki'),
  './pages/LandingPage/McatAnki'
);
const Japanese = lazyWithRetry(
  () => import('./pages/LandingPage/Japanese'),
  './pages/LandingPage/Japanese'
);
const AnkiFromMedicalLectureSlides = lazyWithRetry(
  () => import('./pages/LandingPage/AnkiFromMedicalLectureSlides'),
  './pages/LandingPage/AnkiFromMedicalLectureSlides'
);
const PowerpointToAnki = lazyWithRetry(
  () => import('./pages/LandingPage/PowerpointToAnki'),
  './pages/LandingPage/PowerpointToAnki'
);
const GoodnotesToAnki = lazyWithRetry(
  () => import('./pages/LandingPage/GoodnotesToAnki'),
  './pages/LandingPage/GoodnotesToAnki'
);
const AiFlashcardGenerator = lazyWithRetry(
  () => import('./pages/LandingPage/AiFlashcardGenerator'),
  './pages/LandingPage/AiFlashcardGenerator'
);
const ConvertHubPage = lazyWithRetry(
  () => import('./pages/ConvertHubPage/ConvertHubPage'),
  './pages/ConvertHubPage/ConvertHubPage'
);
const ConvertLandingPage = lazyWithRetry(
  () => import('./pages/ConvertLandingPage/ConvertLandingPage'),
  './pages/ConvertLandingPage/ConvertLandingPage'
);
const MagicLinkPage = lazyWithRetry(
  () => import('./pages/MagicLinkPage'),
  './pages/MagicLinkPage'
);
const PrintPage = lazyWithRetry(
  () => import('./pages/PrintPage'),
  './pages/PrintPage'
);
const WhatsNewPage = lazyWithRetry(
  () => import('./pages/WhatsNewPage/WhatsNewPage'),
  './pages/WhatsNewPage/WhatsNewPage'
);
const ImportPage = lazyWithRetry(
  () => import('./pages/ImportPage'),
  './pages/ImportPage'
);
const ImageOcclusionPage = lazyWithRetry(
  () =>
    import('./pages/ImageOcclusionPage').then((m) => ({
      default: m.ImageOcclusionPage,
    })),
  './pages/ImageOcclusionPage'
);
const PhotoToFlashcardsPage = lazyWithRetry(
  () =>
    import('./pages/PhotoToFlashcardsPage').then((m) => ({
      default: m.PhotoToFlashcardsPage,
    })),
  './pages/PhotoToFlashcardsPage'
);
const ChatPage = lazyWithRetry(
  () => import('./pages/Chat/ChatPage'),
  './pages/Chat/ChatPage'
);
const NotionLandingPage = lazyWithRetry(
  () => import('./pages/NotionLandingPage/NotionLandingPage'),
  './pages/NotionLandingPage/NotionLandingPage'
);
const AnswersPage = lazyWithRetry(
  () => import('./pages/AnswersPage/AnswersPage'),
  './pages/AnswersPage/AnswersPage'
);
const LimitPage = lazyWithRetry(
  () => import('./pages/LimitPage/LimitPage'),
  './pages/LimitPage/LimitPage'
);
const SharedDeckPage = lazyWithRetry(
  () => import('./pages/SharedDeckPage'),
  './pages/SharedDeckPage'
);
const MindmapsPage = lazyWithRetry(
  () => import('./pages/MindmapsPage'),
  './pages/MindmapsPage'
);
const SecurityPage = lazyWithRetry(
  () => import('./pages/SecurityPage/SecurityPage'),
  './pages/SecurityPage/SecurityPage'
);
const StatusPage = lazyWithRetry(
  () => import('./pages/StatusPage/StatusPage'),
  './pages/StatusPage/StatusPage'
);
const NativeAppPage = lazyWithRetry(
  () => import('./pages/NativeAppPage/NativeAppPage'),
  './pages/NativeAppPage/NativeAppPage'
);

const queryClient = new QueryClient();

function surfaceFromPathname(pathname: string): string {
  const segment = pathname.split('/').filter(Boolean)[0];
  return segment ?? 'home';
}

function RouteRecoveryBoundary({
  children,
}: Readonly<{ children: ReactElement }>) {
  const location = useLocation();
  const surface = surfaceFromPathname(location.pathname);
  return (
    <DomRecoveryBoundary
      onError={(error, errorInfo) =>
        reportClientError(error, {
          surface,
          componentStack: errorInfo.componentStack,
        })
      }
      onRecover={(error) =>
        reportClientError(error, {
          surface,
          recovered: true,
        })
      }
    >
      {children}
    </DomRecoveryBoundary>
  );
}

function RequireAuth({
  isLoggedIn,
  isLoading,
  children,
}: Readonly<{
  isLoggedIn: boolean;
  isLoading: boolean;
  children: ReactElement;
}>) {
  const location = useLocation();
  if (isLoading) {
    return <SkeletonPage />;
  }
  if (isLoggedIn) {
    return children;
  }
  const target = `${location.pathname}${location.search}`;
  const loginUrl =
    target === '/' ? '/login' : `/login?redirect=${encodeURIComponent(target)}`;
  return <Navigate to={loginUrl} replace />;
}

function AppContent({
  error,
  setErrorMessage,
}: Readonly<{
  error: Error | null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setErrorMessage: (error: unknown) => void;
}>) {
  const { data, isLoading } = useUserLocals();
  const isLoggedIn = isLoading ? undefined : !!data?.user?.id;
  const isLoggedInResolved = isLoggedIn === true;

  const requireAuth = (element: ReactElement) => (
    <RequireAuth isLoggedIn={isLoggedInResolved} isLoading={isLoading}>
      {element}
    </RequireAuth>
  );

  return (
    <BrowserRouter>
      <AppShell
        error={error}
        isLoggedIn={isLoggedIn}
        email={data?.user?.email}
        locals={
          data?.locals == null
            ? data?.locals
            : {
                ...data.locals,
                autoSyncActive: data?.autoSyncActive === true,
              }
        }
        features={data?.features}
      >
        <VerifyEmailNotice emailVerified={data?.user?.email_verified} />
        <RouteRecoveryBoundary>
          <Routes>
            <Route
              path="/favorites"
              element={requireAuth(
                <FavoritesPage setError={setErrorMessage} />
              )}
            />
            <Route
              path="/downloads"
              element={requireAuth(
                <DownloadsPage setError={setErrorMessage} />
              )}
            />
            <Route
              path="/uploads"
              element={<Navigate to="/downloads" replace />}
            />
            <Route
              path="/upload"
              element={<UploadPage setErrorMessage={setErrorMessage} />}
            />
            <Route path="/print" element={<PrintPage />} />
            <Route path="/image-occlusion" element={<ImageOcclusionPage />} />
            <Route
              path="/photo-to-deck"
              element={requireAuth(<PhotoToFlashcardsPage />)}
            />
            <Route path="/mindmaps" element={requireAuth(<MindmapsPage />)} />
            <Route
              path="/mindmaps/:id"
              element={requireAuth(<MindmapsPage />)}
            />
            <Route path="/chat" element={requireAuth(<ChatPage />)} />
            <Route
              path="/register"
              element={<RegisterPage setErrorMessage={setErrorMessage} />}
            />
            <Route
              path="/notion"
              element={requireAuth(<SearchPage setError={setErrorMessage} />)}
            />
            <Route path="/search" element={<Navigate to="/notion" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/magic" element={<MagicLinkPage />} />
            <Route
              path="/forgot"
              element={<ForgotPasswordPage setErrorMessage={setErrorMessage} />}
            />
            <Route
              path="/users/r/:id"
              element={<NewPasswordPage setErrorMessage={setErrorMessage} />}
            />
            <Route path="/debug" element={<DebugPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route
              path="/delete-account"
              element={requireAuth(
                <DeleteAccountPage setError={setErrorMessage} />
              )}
            />
            <Route
              path="/pricing"
              element={
                <PricingPage
                  isLoggedIn={isLoggedInResolved}
                  email={data?.user?.email}
                  signupCountry={data?.user?.signup_country ?? null}
                />
              }
            />
            <Route
              path="/"
              element={
                <HomePage
                  setErrorMessage={setErrorMessage}
                  isLoggedIn={isLoggedInResolved}
                />
              }
            />
            <Route
              path="/successful-checkout"
              element={<SuccessfulCheckoutPage />}
            />
            <Route path="/limit" element={<LimitPage />} />
            <Route path="/account" element={requireAuth(<AccountPage />)} />
            <Route
              path="/account/claim"
              element={requireAuth(<AccountClaimPage />)}
            />
            {AccountPreviewPage && (
              <Route
                path="/dev/account-preview"
                element={<AccountPreviewPage />}
              />
            )}
            {NotionPreviewPage && (
              <Route
                path="/dev/notion-preview"
                element={<NotionPreviewPage />}
              />
            )}
            {AnkifyReviewPreviewPage && (
              <Route
                path="/dev/ankify-review-preview"
                element={<AnkifyReviewPreviewPage />}
              />
            )}
            {UploadSuccessPreviewPage && (
              <Route
                path="/dev/upload-success-preview"
                element={<UploadSuccessPreviewPage />}
              />
            )}
            {DownloadsPreviewPage && (
              <Route
                path="/dev/downloads-preview"
                element={<DownloadsPreviewPage />}
              />
            )}
            <Route
              path="/import"
              element={requireAuth(<ImportPage setError={setErrorMessage} />)}
            />
            <Route path="/ankify" element={requireAuth(<AnkifyPage />)} />
            <Route
              path="/ankify/setup"
              element={requireAuth(<AnkifySetupPage />)}
            />
            <Route
              path="/ankify/history"
              element={requireAuth(<AnkifyHistoryPage />)}
            />
            <Route path="/ops" element={requireAuth(<OpsLayout />)}>
              <Route index element={<SystemTab />} />
              <Route path="today" element={<TodayTab />} />
              <Route path="growth" element={<GrowthTab />} />
              <Route path="business" element={<BusinessTab />} />
              <Route path="system" element={<SystemTab />} />
              <Route path="errors" element={<ErrorsTab />} />
              <Route path="messages" element={<ContactMessagesTab />} />
              <Route path="commands" element={<ControlsTab />} />
              <Route
                path="conversions"
                element={<Navigate to="/ops/growth" replace />}
              />
              <Route
                path="upload-funnel"
                element={<Navigate to="/ops/growth" replace />}
              />
              <Route
                path="return-rate"
                element={<Navigate to="/ops/growth" replace />}
              />
              <Route
                path="performance"
                element={<Navigate to="/ops/system" replace />}
              />
              <Route
                path="flags"
                element={<Navigate to="/ops/commands" replace />}
              />
              <Route
                path="showcase"
                element={<Navigate to="/ops/commands" replace />}
              />
            </Route>
            <Route path="/settings" element={requireAuth(<AccountPage />)} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/app" element={<NativeAppPage />} />
            <Route path="/security" element={<SecurityPage />} />
            <Route path="/status" element={<StatusPage />} />
            <Route path="/whats-new" element={<WhatsNewPage />} />
            <Route path="/documentation" element={<DocsPage />} />
            <Route path="/documentation/*" element={<DocsPage />} />
            <Route
              path="/settings/card-options"
              element={<Navigate to="/card-options" replace />}
            />
            <Route
              path="/card-options"
              element={<CardOptionsPage setErrorMessage={setErrorMessage} />}
            />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route
              path="/templates/new"
              element={requireAuth(<TemplatesEditorPage mode="new" />)}
            />
            <Route
              path="/templates/edit/:id"
              element={requireAuth(<TemplatesEditorPage mode="edit" />)}
            />
            <Route
              path="/rules/:id"
              element={requireAuth(
                <RulesPage setErrorMessage={setErrorMessage} />
              )}
            />
            <Route
              path="/preview/:id"
              element={requireAuth(<PreviewPage setError={setErrorMessage} />)}
            />
            <Route
              path="/preview/database/:id"
              element={requireAuth(
                <DatabasePreviewPage setError={setErrorMessage} />
              )}
            />
            <Route
              path="/preview/apkg/:key"
              element={requireAuth(
                <PreviewApkgPage setError={setErrorMessage} />
              )}
            />
            <Route
              path="/notion-to-anki"
              element={<NotionToAnki setErrorMessage={setErrorMessage} />}
            />
            <Route
              path="/anki-to-notion"
              element={<AnkiToNotion setErrorMessage={setErrorMessage} />}
            />
            <Route
              path="/quizlet-to-anki"
              element={<QuizletToAnki setErrorMessage={setErrorMessage} />}
            />
            <Route
              path="/markdown-to-anki"
              element={<MarkdownToAnki setErrorMessage={setErrorMessage} />}
            />
            <Route
              path="/pdf-to-anki"
              element={<PdfToAnki setErrorMessage={setErrorMessage} />}
            />
            <Route
              path="/usmle-anki"
              element={<UsmleAnki setErrorMessage={setErrorMessage} />}
            />
            <Route
              path="/nursing-flashcards"
              element={<NursingFlashcards setErrorMessage={setErrorMessage} />}
            />
            <Route
              path="/step1-anki"
              element={<Step1Anki setErrorMessage={setErrorMessage} />}
            />
            <Route
              path="/nclex-anki"
              element={<NclexAnki setErrorMessage={setErrorMessage} />}
            />
            <Route
              path="/mcat-anki"
              element={<McatAnki setErrorMessage={setErrorMessage} />}
            />
            <Route
              path="/anki-for-japanese"
              element={<Japanese setErrorMessage={setErrorMessage} />}
            />
            <Route
              path="/anki-from-medical-lecture-slides"
              element={
                <AnkiFromMedicalLectureSlides
                  setErrorMessage={setErrorMessage}
                />
              }
            />
            <Route
              path="/powerpoint-to-anki"
              element={<PowerpointToAnki setErrorMessage={setErrorMessage} />}
            />
            <Route
              path="/goodnotes-to-anki"
              element={<GoodnotesToAnki setErrorMessage={setErrorMessage} />}
            />
            <Route
              path="/ai-flashcard-generator"
              element={
                <AiFlashcardGenerator setErrorMessage={setErrorMessage} />
              }
            />
            <Route path="/notion-marketplace" element={<NotionLandingPage />} />
            <Route path="/answers/:slug" element={<AnswersPage />} />
            <Route path="/convert" element={<ConvertHubPage />} />
            <Route
              path="/convert/:slug"
              element={<ConvertLandingPage setErrorMessage={setErrorMessage} />}
            />
            <Route path="/s/:token" element={<SharedDeckPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </RouteRecoveryBoundary>
      </AppShell>
    </BrowserRouter>
  );
}

function AppWithCookies() {
  const [cookies, setCookie] = useCookies(['token']);
  const [showReloadOverlay, setShowReloadOverlay] = useState<boolean>(() =>
    isReloadingForFreshChunks()
  );

  useEffect(() => {
    captureFirstTouch();
  }, []);

  useEffect(() => {
    if (!showReloadOverlay) {
      return;
    }
    clearReloadingFlag();
    const id = window.setTimeout(() => setShowReloadOverlay(false), 600);
    return () => window.clearTimeout(id);
  }, [showReloadOverlay]);

  if (isOfflineMode() && !cookies.token) {
    setCookie('token', '?');
  }

  const [apiError, setApiError] = useState<unknown>(null);
  /**
   * This error handling is for network errors and errors happening in the background.
   * This code should be deleted and error handling should be unified for network requests.
   * */
  const handledError = (error: unknown) => {
    const errorMessage = getErrorMessage(error);
    reportClientError(error);
    setApiError(errorMessage);
  };

  return (
    <QueryClientProvider client={queryClient}>
      {showReloadOverlay && <ChunkReloadOverlay />}
      <AppContent
        error={apiError as Error | null}
        setErrorMessage={handledError}
      />
    </QueryClientProvider>
  );
}

function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <HelmetProvider>
        <CookiesProvider defaultSetOptions={{ path: '/' }}>
          <AppWithCookies />
        </CookiesProvider>
      </HelmetProvider>
    </I18nextProvider>
  );
}

export default App;
