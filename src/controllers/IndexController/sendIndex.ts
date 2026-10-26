import express from 'express';
import { getIndexFileContents } from './getIndexFileContents';
import { getPrerenderedPage } from './getPrerenderedPage';
import { INDEX_HTML_CACHE_CONTROL } from '../../lib/mountWebBuild';
import { legalPrerenderFor } from '../../lib/legalPrerender';
import { setCanonicalLink } from '../../lib/setCanonicalLink';
import type { ConsentRegion } from '../../lib/http/consentRegion';

const BUILD_PENDING_BODY =
  'The site is being updated. Refresh in a few seconds.';

const HTML_OPEN_TAG = /<html(\s[^>]*)?>/;

// The shell carries no canonical, so app routes that share it do not claim to
// be the homepage. The homepage itself gets its own here.
const HOME_PATH = '/';
const HOME_CANONICAL = 'https://2anki.net/';

/**
 * The cookie banner decides client-side whether to show, but only the server
 * knows the visitor's country. The region rides on the <html> element so the
 * inline consent script can read it before any tag loads.
 */
export function withConsentRegion(html: string, region: ConsentRegion): string {
  return html.replace(HTML_OPEN_TAG, (_match, attrs: string | undefined) => {
    return `<html${attrs ?? ''} data-consent-region="${region}">`;
  });
}

/**
 * The client learns who is signed in from an API call that lands after first
 * paint. Marking the shell when a session cookie exists lets it lay out the
 * signed-in page from the start instead of shifting once that call returns.
 * A hint for layout only: it says a cookie exists, not that it is valid.
 */
export function withSessionHint(html: string, hasSession: boolean): string {
  if (!hasSession) {
    return html;
  }
  return html.replace(HTML_OPEN_TAG, (_match, attrs: string | undefined) => {
    return `<html${attrs ?? ''} data-auth="1">`;
  });
}

export const sendIndex = (
  response: express.Response,
  requestPath = '',
  consentRegion: ConsentRegion = 'eea',
  hasSession = false
) => {
  response.set('Cache-Control', INDEX_HTML_CACHE_CONTROL);
  const html = getPrerenderedPage(requestPath) ?? getIndexFileContents();
  if (html == null) {
    response.set('Retry-After', '5');
    return response.status(503).send(BUILD_PENDING_BODY);
  }
  const page =
    requestPath === HOME_PATH ? setCanonicalLink(html, HOME_CANONICAL) : html;
  const shell = withSessionHint(
    withConsentRegion(page, consentRegion),
    hasSession
  );
  return response.send(legalPrerenderFor(requestPath, shell) ?? shell);
};
