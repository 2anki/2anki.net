import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';
import './styles/fonts.css';

import App from './App';

import { SkeletonPage } from './components/Skeleton/Skeleton';
import { RootErrorBoundary } from './components/RootErrorBoundary/RootErrorBoundary';
import { initTheme } from './lib/theme';
import { initI18n } from './lib/i18n';
import { isChunkLoadError, recoverFromChunkError } from './lib/chunkReload';
import {
  reportClientError,
  reportDeclinedChunkRecovery,
} from './lib/reportClientError';

window.addEventListener('error', (event) => {
  recoverFromChunkError(event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  recoverFromChunkError(event.reason);
});

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const preloadError = (event as Event & { payload?: unknown }).payload;
  recoverFromChunkError(preloadError);
});

function main() {
  initTheme();
  initI18n();

  const container = document.getElementById('root');
  const root = createRoot(container!);

  root.render(
    <React.StrictMode>
      <Suspense fallback={<SkeletonPage />}>
        <RootErrorBoundary
          onError={(error, errorInfo) => {
            const context = { componentStack: errorInfo.componentStack };
            if (isChunkLoadError(error)) {
              reportDeclinedChunkRecovery(error, context);
              return;
            }
            reportClientError(error, context);
          }}
        >
          <App />
        </RootErrorBoundary>
      </Suspense>
    </React.StrictMode>
  );
}

main();
