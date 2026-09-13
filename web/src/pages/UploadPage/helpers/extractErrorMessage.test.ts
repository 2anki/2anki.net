import { extractErrorMessage } from './extractErrorMessage';

function jsonResponse(body: object, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string, status = 400): Response {
  return new Response(body, { status });
}

describe('extractErrorMessage', () => {
  test('extracts message from JSON response body', async () => {
    const response = jsonResponse({ message: 'No active subscription.' });
    const result = await extractErrorMessage(response);
    expect(result.message).toBe('No active subscription.');
  });

  test('extracts code from JSON response body when present', async () => {
    const response = jsonResponse({
      code: 'too_large',
      message: 'File too big.',
    });
    const result = await extractErrorMessage(response);
    expect(result.code).toBe('too_large');
    expect(result.message).toBe('File too big.');
  });

  test('defaults code to unknown when JSON has no code field', async () => {
    const response = jsonResponse({ message: 'No active subscription.' });
    const result = await extractErrorMessage(response);
    expect(result.code).toBe('unknown');
  });

  test('extracts code=unsupported_format when server sends that code', async () => {
    const response = jsonResponse({
      code: 'unsupported_format',
      message: "This file type isn't supported. Use .zip, .html, .md, or .csv.",
    });
    const result = await extractErrorMessage(response);
    expect(result.code).toBe('unsupported_format');
    expect(result.message).toContain('.zip');
  });

  test('passes the ai_credits_exhausted code through so its copy is reachable', async () => {
    const response = jsonResponse({
      code: 'ai_credits_exhausted',
      message: "You're out of AI credits.",
    });
    const result = await extractErrorMessage(response);
    expect(result.code).toBe('ai_credits_exhausted');
  });

  test('strips HTML tags from plain-text error response', async () => {
    const response = textResponse(
      '<p>Could not create a deck using your file</p>'
    );
    const result = await extractErrorMessage(response);
    expect(result.message).toBe('Could not create a deck using your file');
  });

  test('code is unknown for plain text response', async () => {
    const response = textResponse('Something broke on our end');
    const result = await extractErrorMessage(response);
    expect(result.code).toBe('unknown');
  });

  test('strips rich HTML with links from error response', async () => {
    const html =
      '<div class="info">Could not create a deck using your file(s) and rules. Make sure to at least create on valid toggle or verify your <a href="/upload?view=template">settings</a>.</div>';
    const response = textResponse(html);
    const result = await extractErrorMessage(response);
    expect(result.message).toBe(
      'Could not create a deck using your file(s) and rules. Make sure to at least create on valid toggle or verify your settings.'
    );
  });

  test('returns fallback for empty response body', async () => {
    const response = textResponse('');
    const result = await extractErrorMessage(response);
    expect(result.message).toMatch(/server rejected the upload/i);
  });

  test('returns fallback for very long response body', async () => {
    const response = textResponse('x'.repeat(600));
    const result = await extractErrorMessage(response);
    expect(result.message).toMatch(/server rejected the upload/i);
  });

  test('returns plain text when response is not JSON', async () => {
    const response = textResponse('Something broke on our end');
    const result = await extractErrorMessage(response);
    expect(result.message).toBe('Something broke on our end');
  });
});
