import {
  classifyError,
  getErrorMessage,
  classifyUploadError,
} from './getErrorMessage';
import type { UploadErrorBody } from '../../../types/UploadErrorBody';

describe('classifyError', () => {
  test('TypeError: Failed to fetch is a network error', () => {
    const err = new TypeError('Failed to fetch');
    expect(classifyError(err).title).toMatch(/couldn't reach 2anki/i);
  });

  test('unauthorized message indicates session expired', () => {
    expect(classifyError(new Error('unauthorized')).title).toMatch(
      /session expired/i
    );
  });

  test('"Authentication required" server message maps to session-expiry copy', () => {
    const result = classifyError(new Error('Authentication required'));
    expect(result.title).toMatch(/session expired/i);
    expect(result.detail).toMatch(/sign in/i);
  });

  test('raw JSON blob {"message":"Authentication required"} maps to session-expiry copy', () => {
    const result = classifyError('{"message":"Authentication required"}');
    expect(result.title).toMatch(/session expired/i);
    expect(result.detail).toMatch(/sign in/i);
  });

  test('session-expiry error has a Sign in actionLink pointing to /login', () => {
    const result = classifyError(new Error('Authentication required'));
    expect(result.actionLink).toMatchObject({
      text: 'Sign in',
      to: expect.stringContaining('/login'),
    });
  });

  test('object_not_found gives a Notion-page hint, not a workspace reconnect', () => {
    const result = classifyError(new Error('object_not_found'));
    expect(result.title).toBe("We couldn't open that Notion page.");
    expect(result.detail).toMatch(/Notion/i);
    expect(result.actionLink).toEqual({ text: 'Choose a page', to: '/notion' });
  });

  test('a 404 from the .apkg preview endpoint says the deck is gone, not Notion', () => {
    const err = Object.assign(
      new Error(
        'Resource not found: GET /api/apkg/deck-abc123.apkg/cards status: 404 Not Found'
      ),
      {
        status: 404,
        url: '/api/apkg/deck-abc123.apkg/cards',
      }
    );
    const result = classifyError(err);
    expect(result.title).toBe('This deck is no longer available.');
    expect(result.title).not.toMatch(/Notion/i);
    expect(result.detail).not.toMatch(/Notion/i);
    expect(result.actionLink).toEqual({
      text: 'Back to downloads',
      to: '/downloads',
    });
  });

  test('a 404 from a non-apkg endpoint keeps the Notion-page copy', () => {
    const err = Object.assign(
      new Error(
        'Resource not found: GET /api/notion/preview/xyz status: 404 Not Found'
      ),
      {
        status: 404,
        url: '/api/notion/preview/xyz',
      }
    );
    expect(classifyError(err).title).toBe("We couldn't open that Notion page.");
  });

  test('upload_limit_exceeded suggests upgrading', () => {
    expect(classifyError(new Error('upload_limit_exceeded')).detail).toMatch(
      /upgrade/i
    );
  });

  test('rate_limited tells the user to wait', () => {
    expect(classifyError(new Error('rate_limited')).title).toMatch(/too many/i);
  });

  test('falls back to a short server message when one is provided', () => {
    expect(classifyError(new Error('No active subscription.')).title).toBe(
      'No active subscription.'
    );
  });

  test('unknown/empty error yields generic fallback', () => {
    expect(classifyError(undefined).title).toMatch(/Something went wrong/i);
  });

  test('HTML-looking long blobs fall back rather than leaking markup', () => {
    const ugly = '<html><body>big raw stack trace…</body></html>'.repeat(20);
    expect(classifyError(new Error(ugly)).title).toMatch(
      /Something went wrong/i
    );
  });

  test('short HTML-wrapped error is stripped and shown to the user', () => {
    const htmlError = '<p>Could not create a deck using your file</p>';
    const result = classifyError(new Error(htmlError));
    expect(result.title).toBe('Could not create a deck using your file');
  });

  test('rich HTML error with links is stripped to plain text', () => {
    const htmlError =
      '<div class="info">Verify your <a href="/upload?view=template">settings</a>.</div>';
    const result = classifyError(new Error(htmlError));
    expect(result.title).toBe('Verify your settings.');
  });
});

describe('classifyError — notion_unauthorized', () => {
  it('new structured code returns reconnect copy', () => {
    const result = classifyError({
      code: 'notion_unauthorized',
      message: 'API token is invalid.',
    });
    expect(result.title).toBe('Your Notion connection expired');
    expect(result.detail).toBe(
      'Sign in to Notion again to keep converting your pages.'
    );
  });

  it('legacy text "api token is invalid" (case-insensitive) returns reconnect copy', () => {
    const result = classifyError(new Error('API token is invalid.'));
    expect(result.title).toBe('Your Notion connection expired');
    expect(result.detail).toBe(
      'Sign in to Notion again to keep converting your pages.'
    );
  });

  it('action link points to the Notion connect page', () => {
    const result = classifyError({ code: 'notion_unauthorized', message: '' });
    expect(result.actionLink).toEqual({
      text: 'Reconnect Notion',
      to: '/notion',
    });
  });
});

describe('getErrorMessage', () => {
  test('returns plain text — no HTML', () => {
    const msg = getErrorMessage(new Error('Failed to fetch'));
    expect(msg).not.toMatch(/</);
  });
});

describe('classifyUploadError', () => {
  test('unsupported_format returns specific copy about file type', () => {
    const body: UploadErrorBody = {
      code: 'unsupported_format',
      message: 'original',
    };
    const result = classifyUploadError(body);
    expect(result.title).toBe("This file type isn't supported.");
    expect(result.detail).toBe(
      'Use .zip, .html, .md, .pdf, .docx, .xlsx, .pptx, .csv, or .xml.'
    );
  });

  test('too_large returns copy about splitting into subpages', () => {
    const body: UploadErrorBody = { code: 'too_large', message: 'original' };
    const result = classifyUploadError(body);
    expect(result.title).toBe('This export is too large to convert in one go.');
    expect(result.detail).toMatch(/subpage/i);
  });

  test('password_protected_pdf returns specific copy about removing the password', () => {
    const body: UploadErrorBody = {
      code: 'password_protected_pdf',
      message: 'original',
    };
    const result = classifyUploadError(body);
    expect(result.title).toMatch(/password/i);
  });

  test('invalid_markup returns specific copy about simplifying the block', () => {
    const body: UploadErrorBody = {
      code: 'invalid_markup',
      message: 'original',
    };
    const result = classifyUploadError(body);
    expect(result.title).toBe(
      "Part of this file has formatting we couldn't read."
    );
    expect(result.detail).toBe(
      'Open the source, remove or simplify the block that broke, and try again.'
    );
  });

  test('unknown falls back to the server message', () => {
    const body: UploadErrorBody = {
      code: 'unknown',
      message: 'Something broke.',
    };
    const result = classifyUploadError(body);
    expect(result.title).toBe('Something broke.');
  });

  test('ai_credits_exhausted returns reset copy without an add-credits prompt', () => {
    const body: UploadErrorBody = {
      code: 'ai_credits_exhausted',
      message: "You're out of AI credits.",
    };
    const result = classifyUploadError(body);
    expect(result.title).toBe("You're out of AI credits.");
    expect(result.detail).toMatch(/resets/i);
    expect(result.detail).not.toMatch(/add credits/i);
  });

  test('malformed_notion returns specific copy (not the server message)', () => {
    const body: UploadErrorBody = {
      code: 'malformed_notion',
      message: 'Notion error.',
    };
    const result = classifyUploadError(body);
    expect(result.title).toBe("This Notion export couldn't be parsed.");
  });

  it('malformed_notion returns specific copy about re-exporting from Notion', () => {
    const body: UploadErrorBody = {
      code: 'malformed_notion',
      message: 'raw server text',
    };
    const result = classifyUploadError(body);
    expect(result.title).toBe("This Notion export couldn't be parsed.");
    expect(result.detail).toBe('Re-export the page from Notion and try again.');
  });

  it('corrupted_apkg returns specific copy about re-exporting from Anki', () => {
    const body: UploadErrorBody = {
      code: 'corrupted_apkg',
      message: 'raw server text',
    };
    const result = classifyUploadError(body);
    expect(result.title).toBe('This .apkg file is damaged.');
    expect(result.detail).toBe(
      'Re-export it from Anki, or send it to support@2anki.net.'
    );
  });

  it('empty_export returns specific copy about checking page content', () => {
    const body: UploadErrorBody = {
      code: 'empty_export',
      message: 'raw server text',
    };
    const result = classifyUploadError(body);
    expect(result.title).toBe(
      'This export has no content we can turn into cards.'
    );
    expect(result.detail).toBe(
      'Check the page has text or toggle blocks, then export again.'
    );
  });

  test('empty message under an unknown code returns the parser-error spec copy', () => {
    const body: UploadErrorBody = { code: 'unknown', message: '' };
    const result = classifyUploadError(body);
    expect(result.title).toBe('Something broke while reading this file.');
    expect(result.detail).toBe(
      'Try again, or send the file to support@2anki.net so we can fix the parser.'
    );
  });

  it('claude_parse_failed returns the designer copy instead of falling through to UPLOAD_FALLBACK', () => {
    const body: UploadErrorBody = {
      code: 'claude_parse_failed',
      message: 'claude_parse_failed',
    };
    const result = classifyUploadError(body);
    expect(result.title).toBe('Something went wrong while making your cards.');
    expect(result.detail).toBe(
      'Try again — if it keeps happening, email support@2anki.net.'
    );
  });

  it('markdown_likely_lossy returns the Notion toggle-flatten copy', () => {
    const body: UploadErrorBody = {
      code: 'markdown_likely_lossy',
      message: 'raw server text',
    };
    const result = classifyUploadError(body);
    expect(result.title).toBe(
      'Notion Markdown exports flatten toggles — re-export this page as HTML and the toggles become flashcards.'
    );
    expect(result.detail).toBeUndefined();
  });
});

describe('classifyUploadError — new error codes', () => {
  it('parser_crash returns the malformed-file copy', () => {
    const body: UploadErrorBody = { code: 'parser_crash', message: 'raw' };
    const result = classifyUploadError(body);
    expect(result.title).toBe("Couldn't read this file.");
    expect(result.detail).toContain('malformed or use a structure');
    expect(result.detail).toContain('support@2anki.net');
  });

  it('worker_timeout returns the time-budget copy', () => {
    const body: UploadErrorBody = { code: 'worker_timeout', message: 'raw' };
    const result = classifyUploadError(body);
    expect(result.title).toBe(
      'This conversion took longer than the time budget.'
    );
    expect(result.detail).toContain('smaller pieces');
  });

  it('notion_rate_limit returns the rate-limiting copy', () => {
    const body: UploadErrorBody = { code: 'notion_rate_limit', message: 'raw' };
    const result = classifyUploadError(body);
    expect(result.title).toBe('Notion is rate-limiting us right now.');
    expect(result.detail).toContain('Wait a minute');
  });

  it('notion_object_not_found returns the page-not-found copy', () => {
    const body: UploadErrorBody = {
      code: 'notion_object_not_found',
      message: 'raw',
    };
    const result = classifyUploadError(body);
    expect(result.title).toBe("We couldn't open that Notion page.");
    expect(result.detail).toContain('Share it with the 2anki integration');
  });

  it('apkg_too_large_for_anki returns the upload-limit copy', () => {
    const body: UploadErrorBody = {
      code: 'apkg_too_large_for_anki',
      message: 'raw',
    };
    const result = classifyUploadError(body);
    expect(result.title).toContain("Anki's upload limit");
    expect(result.detail).toContain('Anki desktop');
  });

  it('zip_invalid returns the zip-format copy', () => {
    const body: UploadErrorBody = { code: 'zip_invalid', message: 'raw' };
    const result = classifyUploadError(body);
    expect(result.title).toBe("Couldn't read this zip.");
    expect(result.detail).toContain('Markdown & CSV export');
  });
});
