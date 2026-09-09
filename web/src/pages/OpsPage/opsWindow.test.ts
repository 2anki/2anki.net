import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OPS_WINDOW,
  OPS_WINDOWS,
  isOpsWindow,
  parseOpsWindow,
} from './opsWindow';

describe('opsWindow', () => {
  it('offers exactly the three cohort windows', () => {
    expect(OPS_WINDOWS).toEqual(['7d', '30d', '90d']);
    expect(DEFAULT_OPS_WINDOW).toBe('30d');
  });

  it.each(['7d', '30d', '90d'])('accepts %s', (value) => {
    expect(isOpsWindow(value)).toBe(true);
    expect(parseOpsWindow(value)).toBe(value);
  });

  it.each(['24h', '14d', '', null, undefined, '30D'])(
    'falls back to the default for %s',
    (value) => {
      expect(isOpsWindow(value)).toBe(false);
      expect(parseOpsWindow(value)).toBe('30d');
    }
  );
});
