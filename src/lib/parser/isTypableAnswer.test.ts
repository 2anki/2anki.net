import { isTypableAnswer, typableAnswerText } from './isTypableAnswer';

describe('isTypableAnswer', () => {
  it('accepts a short plain-text answer', () => {
    expect(isTypableAnswer('予定')).toBe(true);
  });

  it('accepts an answer right at the length limit', () => {
    expect(isTypableAnswer('a'.repeat(40))).toBe(true);
  });

  it('rejects an answer over the length limit', () => {
    expect(isTypableAnswer('a'.repeat(41))).toBe(false);
  });

  it('rejects an empty or whitespace-only answer', () => {
    expect(isTypableAnswer('')).toBe(false);
    expect(isTypableAnswer('   ')).toBe(false);
  });

  it('rejects a multi-line answer', () => {
    expect(isTypableAnswer('line one\nline two')).toBe(false);
  });

  it('accepts a plain answer wrapped in a single paragraph tag', () => {
    expect(isTypableAnswer('<p>予定</p>')).toBe(true);
  });

  it('rejects an answer with more than one structural element', () => {
    expect(isTypableAnswer('<p>予定</p><p>extra</p>')).toBe(false);
  });

  it('rejects an answer containing a link or image', () => {
    expect(isTypableAnswer('<p>予定 <a href="x">note</a></p>')).toBe(false);
  });

  it('accepts an answer wrapped in inline bold markup', () => {
    expect(isTypableAnswer('<strong>予定</strong>')).toBe(true);
  });

  it('trims surrounding whitespace before checking', () => {
    expect(isTypableAnswer('  予定  ')).toBe(true);
  });

  it('rejects non-string input', () => {
    expect(isTypableAnswer(undefined as unknown as string)).toBe(false);
  });
});

describe('typableAnswerText', () => {
  it('returns the plain text with wrapper tags stripped', () => {
    expect(typableAnswerText('<p>予定</p>')).toBe('予定');
  });

  it('trims surrounding whitespace', () => {
    expect(typableAnswerText('  予定  ')).toBe('予定');
  });
});
