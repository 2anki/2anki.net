import { vi } from 'vitest';
import { resetEventsSinkForTesting } from './eventsSinkInstance';
import * as eventsSinkInstance from './eventsSinkInstance';

vi.mock('./eventsSinkInstance', () => {
  const recorded: unknown[] = [];
  return {
    getEventsSink: () => ({
      record: vi.fn((row: unknown) => recorded.push(row)),
    }),
    resetEventsSinkForTesting: vi.fn(),
    __recorded: recorded,
  };
});

import { track } from './track';

function getRecorded() {
  return (eventsSinkInstance as unknown as { __recorded: unknown[] })
    .__recorded;
}

describe('track (server helper)', () => {
  beforeEach(() => {
    getRecorded().length = 0;
  });

  afterEach(() => {
    resetEventsSinkForTesting();
  });

  it('records an event with userId and anonymousId', () => {
    track('conversion_succeeded', {
      userId: 42,
      anonymousId: 'anon-123',
      props: { source: 'upload' },
    });
    expect(getRecorded()).toHaveLength(1);
    const row = getRecorded()[0] as Record<string, unknown>;
    expect(row.name).toBe('conversion_succeeded');
    expect(row.user_id).toBe(42);
    expect(row.anonymous_id).toBe('anon-123');
    expect(row.props).toEqual({ source: 'upload' });
  });

  it('strips PII keys from props before recording', () => {
    track('upload_error_chat_shown', {
      props: {
        email: 'user@example.com',
        token: 'secret',
        password: 'abc',
        filename: 'notes.zip',
        content: 'raw content',
        title: 'My page',
        source: 'upload',
        safe_key: 'ok',
      },
    });
    const row = getRecorded()[0] as Record<string, unknown>;
    expect(row.props).toEqual({ source: 'upload', safe_key: 'ok' });
  });

  it('drops the event and does not record when props exceed 1KB', () => {
    const bigValue = 'x'.repeat(1025);
    track('conversion_succeeded', { props: { data: bigValue } });
    expect(getRecorded()).toHaveLength(0);
  });

  it('falls back to null when userId and anonymousId are omitted', () => {
    track('deck_downloaded');
    const row = getRecorded()[0] as Record<string, unknown>;
    expect(row.user_id).toBeNull();
    expect(row.anonymous_id).toBeNull();
  });

  it('records an empty props object by default', () => {
    track('deck_downloaded', { userId: 1 });
    const row = getRecorded()[0] as Record<string, unknown>;
    expect(row.props).toEqual({});
  });
});
