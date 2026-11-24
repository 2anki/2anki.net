import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidEmailShape } from './isValidEmailShape';

const WEB_VALIDATOR_PATH = join(
  __dirname,
  '../../../web/src/lib/email/isValidEmailShape.ts'
);

type WebValidator = (value: string) => boolean;

async function webIsValidEmailShape(): Promise<WebValidator> {
  const webModule: { isValidEmailShape: WebValidator } = await import(
    WEB_VALIDATOR_PATH
  );
  return webModule.isValidEmailShape;
}

const char = (codePoint: number) => String.fromCodePoint(codePoint);

const SHARED_CASES: ReadonlyArray<
  [label: string, value: string, valid: boolean]
> = [
  ['a plain address', 'learner@example.com', true],
  ['padding and mixed case', '  Learner@Example.COM ', true],
  ['a tag and a subdomain', 'first.last+tag@sub.example.co.uk', true],
  ['non-ASCII letters', 'lærer@exämple.com', true],
  ['an internationalised domain', 'user@münchen.de', true],
  ['a Japanese domain', 'user@例え.jp', true],
  ['a punycode domain', 'user@xn--mnchen-3ya.de', true],
  [
    'a leading byte order mark that trims away',
    `${char(0xfeff)}learner@example.com`,
    true,
  ],
  ['an empty string', '', false],
  ['digits only', '4791234567', false],
  ['no at sign', 'studyhard', false],
  ['a domain without a dot', 'name@gmail', false],
  ['two at signs', 'a@b@example.com', false],
  ['an inner space', 'name @example.com', false],
  ['a display name', 'Name <name@example.com>', false],
  ['a comma list', 'a@example.com,b@example.com', false],
  ['a semicolon list', 'a@example.com;b@example.com', false],
  ['a line break', 'user@example.com\r\nother@example.com', false],
  ['an over-long address', `${'a'.repeat(250)}@example.com`, false],
  ['a NUL character', `learner@example.com${char(0x0)}`, false],
  ['a DEL character', `learner${char(0x7f)}@example.com`, false],
  ['a next-line character', `learner${char(0x85)}@example.com`, false],
  ['a zero-width space', `learner${char(0x200b)}@example.com`, false],
  ['a zero-width joiner', `learner${char(0x200d)}@example.com`, false],
  ['a soft hyphen', `learner${char(0xad)}@example.com`, false],
  ['a right-to-left override', `learner${char(0x202e)}@example.com`, false],
  ['an inner byte order mark', `learner${char(0xfeff)}@example.com`, false],
];

describe('email address check, server and web', () => {
  it.each(SHARED_CASES)('agrees on %s', async (_label, value, valid) => {
    const webCheck = await webIsValidEmailShape();

    expect(isValidEmailShape(value)).toBe(valid);
    expect(webCheck(value)).toBe(valid);
  });
});
