import { normalizeEmail, isValidEmailShape } from './isValidEmailShape';

describe('normalizeEmail', () => {
  it('trims and lowercases a valid address', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
  });

  // SendGrid's EmailAddress parser splits on '<' and delivers to the inner
  // address, so a bracketed string would reach a different mailbox than the
  // one we validated and rate-limited.
  it.each([
    'evil<victim@example.com',
    'X<victim@example.com>',
    '<victim@example.com>',
  ])('rejects the angle-bracket display-name form %s', (value) => {
    expect(normalizeEmail(value)).toBeNull();
  });

  it.each([
    'a@b.com,c@d.com',
    'victim@example.com,',
    'a@b.com;c@d.com',
    'user@example.com\r\nBcc:other@example.com',
    'not-an-email',
    'user@localhost',
    '',
  ])('rejects %s', (value) => {
    expect(normalizeEmail(value)).toBeNull();
  });

  it('rejects a non-string and an over-long address', () => {
    expect(normalizeEmail(42)).toBeNull();
    expect(normalizeEmail(`${'a'.repeat(250)}@example.com`)).toBeNull();
  });

  it('keeps isValidEmailShape in agreement with normalizeEmail', () => {
    expect(isValidEmailShape(' User@Example.com ')).toBe(true);
    expect(isValidEmailShape('evil<victim@example.com')).toBe(false);
  });
});
