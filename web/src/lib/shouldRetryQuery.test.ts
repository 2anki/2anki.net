import { describe, expect, it } from 'vitest';
import { UserNotice } from './errors/UserNotice';
import { shouldRetryQuery } from './shouldRetryQuery';

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
});
