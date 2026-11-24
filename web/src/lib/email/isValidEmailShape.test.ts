import { describe, expect, it } from 'vitest';
import { isValidEmailShape } from './isValidEmailShape';

describe('isValidEmailShape', () => {
  it.each([
    'learner@example.com',
    '  Learner@Example.COM ',
    'first.last+tag@sub.example.co.uk',
    'lærer@münchen.de',
  ])('accepts %s', (value) => {
    expect(isValidEmailShape(value)).toBe(true);
  });

  it.each([
    '',
    '4791234567',
    'studyhard',
    'name@gmail',
    'a@b@example.com',
    'name @example.com',
    'Name <name@example.com>',
    'a@example.com,b@example.com',
    `${'a'.repeat(250)}@example.com`,
    `learner@example.com${String.fromCodePoint(0x0)}`,
    `learner${String.fromCodePoint(0x200b)}@example.com`,
  ])('refuses %j', (value) => {
    expect(isValidEmailShape(value)).toBe(false);
  });
});
