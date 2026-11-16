import { describe, expect, it } from 'vitest';
import { readTooLongSetting } from './readUploadErrorDetails';

describe('readTooLongSetting', () => {
  it.each(['user_instructions', 'deck_name'])('keeps %s', (setting) => {
    expect(readTooLongSetting(setting)).toBe(setting);
  });

  it.each(['theme', 'toString', 7, undefined])('drops %s', (value) => {
    expect(readTooLongSetting(value)).toBeUndefined();
  });
});
