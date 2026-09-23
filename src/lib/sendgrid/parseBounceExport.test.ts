import { parseBounceExport, parseCsv } from './parseBounceExport';

describe('parseCsv', () => {
  it('splits simple rows on commas and newlines', () => {
    expect(parseCsv('a,b\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps commas, escaped quotes, and newlines inside quoted fields', () => {
    const text = 'reason,email\n"550 5.1.1 ""user"" not,\nfound",a@b.com\n';
    expect(parseCsv(text)).toEqual([
      ['reason', 'email'],
      ['550 5.1.1 "user" not,\nfound', 'a@b.com'],
    ]);
  });

  it('handles CRLF line endings and a missing trailing newline', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('parseBounceExport', () => {
  const header = 'status,reason,email,created\n';

  it('parses SendGrid bounce rows and lowercases addresses', () => {
    const text =
      header +
      '5.1.1,"550 5.1.1 The email account does not exist, sorry",User@Gmail.com,1790083507\n';
    const { rows, skipped } = parseBounceExport(text);
    expect(skipped).toBe(0);
    expect(rows).toEqual([
      {
        status: '5.1.1',
        reason: '550 5.1.1 The email account does not exist, sorry',
        email: 'user@gmail.com',
        created: 1790083507,
      },
    ]);
  });

  it('skips rows without a usable address or timestamp', () => {
    const text =
      header +
      '5.1.1,reason,not-an-email,1790083507\n' +
      '5.1.1,reason,a@b.com,\n' +
      '5.1.1,reason,a@b.com,1790083507\n';
    const { rows, skipped } = parseBounceExport(text);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it('rejects files that are not a suppression export', () => {
    expect(() => parseBounceExport('foo,bar\n1,2\n')).toThrow(
      /missing email\/created/
    );
  });

  it('returns nothing for an empty file', () => {
    expect(parseBounceExport('')).toEqual({ rows: [], skipped: 0 });
  });
});
