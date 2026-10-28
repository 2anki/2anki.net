import ReactDOMServer from 'react-dom/server';
import React from 'react';
import { styles } from '../components/download/styles';
import { DownloadFooter } from '../components/download/DownloadFooter';

const globalCss = `
* { box-sizing: border-box; }
body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif; }
a { color: inherit; }
a:hover { text-decoration: underline; }
@media (max-width: 599px) {
  .cta-button { display: block; width: 100%; text-align: center; }
}
`;

export const DownloadExpiredPage = (): string =>
  ReactDOMServer.renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Download link expired · 2anki</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="robots" content="noindex" />
        <style>{globalCss}</style>
      </head>
      <body style={styles.pageBackground}>
        <div style={styles.container}>
          <h1 style={styles.h1}>This download link has expired</h1>
          <p style={styles.subhead}>
            Decks are available for a short time after conversion, then removed.
            Convert your file again to get a fresh link.
          </p>
          <div style={styles.ctaRow}>
            <a href="/upload" className="cta-button" style={styles.ctaButton}>
              Convert a file
            </a>
            <a href="/downloads" style={styles.footerLink}>
              My decks
            </a>
          </div>
          <DownloadFooter />
        </div>
      </body>
    </html>
  );
