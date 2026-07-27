import { shouldSendContactAck } from './shouldSendContactAck';

const MESSAGE = 'My deck came back empty after converting a Notion page.';

describe('shouldSendContactAck', () => {
  it('allows a valid email with a real message and no recent submissions', () => {
    expect(shouldSendContactAck('user@example.com', MESSAGE, 1)).toBe(true);
    expect(shouldSendContactAck('user@example.com', MESSAGE, 0)).toBe(true);
  });

  it.each([
    ['missing @', 'not-an-email'],
    ['missing domain dot', 'user@localhost'],
    ['whitespace inside', 'us er@example.com'],
    ['empty string', ''],
    ['non-string', 42],
    ['over the length cap', `${'a'.repeat(250)}@example.com`],
  ])('rejects an email with %s', (_label, email) => {
    expect(shouldSendContactAck(email, MESSAGE, 0)).toBe(false);
  });

  it('rejects a trivial message so probes get no outbound mail', () => {
    expect(shouldSendContactAck('user@example.com', 'hi', 0)).toBe(false);
    expect(shouldSendContactAck('user@example.com', '     spaces    ', 0)).toBe(
      false
    );
    expect(shouldSendContactAck('user@example.com', undefined, 0)).toBe(false);
  });

  it('rejects a repeat submission inside the cooldown window', () => {
    expect(shouldSendContactAck('user@example.com', MESSAGE, 2)).toBe(false);
  });
});
