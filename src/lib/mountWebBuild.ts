import express from 'express';
import path from 'path';

export const INDEX_HTML_CACHE_CONTROL = 'no-cache, must-revalidate';

const SHELL_PATHS = new Set(['/', '/index.html']);

/**
 * Serves the built web assets. The shell itself (`/` and `/index.html`) is
 * deliberately NOT served from disk here: DefaultRouter sends it through
 * sendIndex, which stamps the visitor's consent region and the legal
 * prerender onto it. `index: false` covers the directory request; the
 * explicit skip covers a direct `/index.html` request, which express.static
 * would otherwise still answer.
 */
export const mountWebBuild = (app: express.Express, buildDir: string) => {
  app.use(
    '/assets',
    express.static(path.join(buildDir, 'assets'), {
      immutable: true,
      maxAge: '1y',
    })
  );
  const files = express.static(buildDir, { index: false });
  app.use((req, res, next) => {
    if (SHELL_PATHS.has(req.path)) {
      next();
      return;
    }
    files(req, res, next);
  });
};
