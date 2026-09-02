import { passKindLabel } from './passKindLabel';

describe('passKindLabel', () => {
  it('labels each pass kind with its plan name', () => {
    expect(passKindLabel('24h')).toBe('Day Pass');
    expect(passKindLabel('7d')).toBe('Week Pass');
    expect(passKindLabel('120d')).toBe('Semester Pass');
  });

  it('falls back to a generic label for other kinds', () => {
    expect(passKindLabel('unlimited')).toBe('Pass');
  });
});
