import { describe, expect, it } from 'vitest';
import { UserNotice } from './errors/UserNotice';
import { shouldRetryQuery } from './shouldRetryQuery';

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP error! status: ${status}`), { status });
}

describe('shouldRetryQuery', () => {
  it('does not retry a deliberate server answer such as a dead Notion connection', () => {
    expect(
      shouldRetryQuery(
        0,
        new UserNotice('API token is invalid.', 'notion_unauthorized')
      )
    ).toBe(false);
  });

  it('retries other failures up to three times', () => {
    const failure = new Error('Failed to fetch');
    expect(shouldRetryQuery(0, failure)).toBe(true);
    expect(shouldRetryQuery(2, failure)).toBe(true);
    expect(shouldRetryQuery(3, failure)).toBe(false);
  });

  it.each([400, 402, 403, 404, 409, 413, 422])(
    'does not retry a final %i answer',
    (status) => {
      expect(shouldRetryQuery(0, httpError(status))).toBe(false);
    }
  );

  it.each([0, 408, 429, 500, 502, 503])('retries a %i failure', (status) => {
    expect(shouldRetryQuery(0, httpError(status))).toBe(true);
  });
});
