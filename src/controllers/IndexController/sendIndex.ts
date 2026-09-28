import express from 'express';
import { getIndexFileContents } from './getIndexFileContents';
import { INDEX_HTML_CACHE_CONTROL } from '../../lib/mountWebBuild';
import { legalPrerenderFor } from '../../lib/legalPrerender';

const BUILD_PENDING_BODY =
  'The site is being updated. Refresh in a few seconds.';

export const sendIndex = (response: express.Response, requestPath = '') => {
  response.set('Cache-Control', INDEX_HTML_CACHE_CONTROL);
  const html = getIndexFileContents();
  if (html == null) {
    response.set('Retry-After', '5');
    return response.status(503).send(BUILD_PENDING_BODY);
  }
  return response.send(legalPrerenderFor(requestPath, html) ?? html);
};
