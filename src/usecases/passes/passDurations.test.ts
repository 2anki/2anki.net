import { PASS_DURATION_MS, isAnonymousPassKind } from './passDurations';

describe('passDurations', () => {
  it('maps the Semester Pass to a 120-day window', () => {
    expect(PASS_DURATION_MS['120d']).toBe(120 * 24 * 60 * 60 * 1000);
  });

  it('keeps the Day and Week Pass windows unchanged', () => {
    expect(PASS_DURATION_MS['24h']).toBe(24 * 60 * 60 * 1000);
    expect(PASS_DURATION_MS['7d']).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('recognises 120d as a sellable pass kind', () => {
    expect(isAnonymousPassKind('120d')).toBe(true);
    expect(isAnonymousPassKind('24h')).toBe(true);
    expect(isAnonymousPassKind('7d')).toBe(true);
  });

  it('rejects an unknown pass kind', () => {
    expect(isAnonymousPassKind('unlimited')).toBe(false);
    expect(isAnonymousPassKind('30d')).toBe(false);
  });
});
