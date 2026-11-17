import { maskEmail } from './maskEmail';

describe('maskEmail', () => {
  it.each([
    ['learner@example.com', 'l•••@example.com'],
    ['a@example.com', 'a•••@example.com'],
    ['Learner.Name+tag@mail.example.org', 'L•••@mail.example.org'],
    ['  spaced@example.com ', 's•••@example.com'],
  ])('shows only the first character and domain of %s', (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });

  it('never reveals the rest of the local part', () => {
    const masked = maskEmail('secretname@example.com');

    expect(masked).not.toContain('ecret');
    expect(masked.split('@')[0]).toBe('s•••');
  });

  it.each(['', 'no-at-sign', '@example.com', 'learner@'])(
    'hides an address it cannot split: %j',
    (email) => {
      expect(maskEmail(email)).toBe('•••');
    }
  );

  it('splits on the last @ so the domain is the real one', () => {
    expect(maskEmail('"odd@local"@example.com')).toBe('"•••@example.com');
  });
});
