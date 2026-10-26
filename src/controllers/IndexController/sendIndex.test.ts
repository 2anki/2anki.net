import { vi, type MockedFunction } from 'vitest';
import { Response } from 'express';

import { sendIndex, withConsentRegion, withSessionHint } from './sendIndex';
import { getIndexFileContents } from './getIndexFileContents';
import { getPrerenderedPage } from './getPrerenderedPage';
import { INDEX_HTML_CACHE_CONTROL } from '../../lib/mountWebBuild';

vi.mock('./getIndexFileContents');
vi.mock('./getPrerenderedPage', () => ({
  getPrerenderedPage: vi.fn().mockReturnValue(null),
}));

const mockedGet = getIndexFileContents as MockedFunction<
  typeof getIndexFileContents
>;

function buildResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('sendIndex', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('sends the html with default 200 status when the build exists', () => {
    mockedGet.mockReturnValue('<html>ready</html>');
    const res = buildResponse();

    sendIndex(res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith(
      '<html data-consent-region="eea">ready</html>'
    );
  });

  it('sends the prerendered landing page, stamped, instead of the shell', () => {
    mockedGet.mockReturnValue('<html>shell</html>');
    vi.mocked(getPrerenderedPage).mockReturnValueOnce(
      '<html lang="en">pdf page</html>'
    );
    const res = buildResponse();

    sendIndex(res, '/pdf-to-anki/', 'other');

    expect(getPrerenderedPage).toHaveBeenCalledWith('/pdf-to-anki/');
    expect(res.send).toHaveBeenCalledWith(
      '<html lang="en" data-consent-region="other">pdf page</html>'
    );
  });

  it('gives the homepage its canonical, which the shell no longer carries', () => {
    mockedGet.mockReturnValue('<html><head></head></html>');
    const res = buildResponse();

    sendIndex(res, '/', 'other');

    expect(res.send).toHaveBeenCalledWith(
      '<html data-consent-region="other"><head><link rel="canonical" href="https://2anki.net/"></head></html>'
    );
  });

  it.each(['/login', '/account', '/not-a-page'])(
    'leaves the shell without a canonical for %s',
    (requestPath) => {
      mockedGet.mockReturnValue('<html><head></head></html>');
      const res = buildResponse();

      sendIndex(res, requestPath, 'other');

      expect(res.send).toHaveBeenCalledWith(
        '<html data-consent-region="other"><head></head></html>'
      );
    }
  );

  it('stamps the consent region the caller resolved', () => {
    mockedGet.mockReturnValue('<html lang="en">ready</html>');
    const res = buildResponse();

    sendIndex(res, '/', 'other');

    expect(res.send).toHaveBeenCalledWith(
      '<html lang="en" data-consent-region="other">ready</html>'
    );
  });

  it('marks the shell signed in when the caller saw a session cookie', () => {
    mockedGet.mockReturnValue('<html lang="en">ready</html>');
    const res = buildResponse();

    sendIndex(res, '/', 'other', true);

    expect(res.send).toHaveBeenCalledWith(
      '<html lang="en" data-consent-region="other" data-auth="1">ready</html>'
    );
  });

  it('leaves the signed-in mark off without a session cookie', () => {
    mockedGet.mockReturnValue('<html lang="en">ready</html>');
    const res = buildResponse();

    sendIndex(res, '/', 'other', false);

    expect(res.send).toHaveBeenCalledWith(
      '<html lang="en" data-consent-region="other">ready</html>'
    );
  });

  it('marks the shell no-cache so stale clients pick up new builds', () => {
    mockedGet.mockReturnValue('<html>ready</html>');
    const res = buildResponse();

    sendIndex(res);

    expect(res.set).toHaveBeenCalledWith(
      'Cache-Control',
      INDEX_HTML_CACHE_CONTROL
    );
  });

  it('responds 503 with Retry-After when the build is mid-deploy', () => {
    mockedGet.mockReturnValue(null);
    const res = buildResponse();

    sendIndex(res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '5');
    expect(res.send).toHaveBeenCalledTimes(1);
  });
});

describe('withConsentRegion', () => {
  it('adds the attribute to a bare html tag', () => {
    expect(withConsentRegion('<!doctype html><html><head></head>', 'eea')).toBe(
      '<!doctype html><html data-consent-region="eea"><head></head>'
    );
  });

  it('keeps existing attributes', () => {
    expect(withConsentRegion('<html lang="en" dir="ltr">', 'other')).toBe(
      '<html lang="en" dir="ltr" data-consent-region="other">'
    );
  });

  it('leaves html without a root tag untouched', () => {
    expect(withConsentRegion('<div>no shell</div>', 'eea')).toBe(
      '<div>no shell</div>'
    );
  });
});

describe('withSessionHint', () => {
  it('adds data-auth to the html tag when there is a session', () => {
    expect(withSessionHint('<html lang="en"><head></head>', true)).toBe(
      '<html lang="en" data-auth="1"><head></head>'
    );
  });

  it('returns the html unchanged without a session', () => {
    expect(withSessionHint('<html lang="en"><head></head>', false)).toBe(
      '<html lang="en"><head></head>'
    );
  });
});
