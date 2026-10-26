import { toSampleText } from './toSampleText';

describe('toSampleText', () => {
  it('drops tags and decodes entities once', () => {
    expect(toSampleText('<b>Alpha</b> &amp; omega')).toBe('Alpha & omega');
  });

  it('leaves script and style content out', () => {
    expect(toSampleText('a<script>alert(1)</script>b<style>x{}</style>')).toBe(
      'ab'
    );
  });

  it('keeps words from neighbouring blocks apart', () => {
    expect(
      toSampleText('<p>one</p><p>two</p>a<br>b').replace(/\s+/g, ' ').trim()
    ).toBe('one two a b');
  });

  it('returns an empty string for empty input', () => {
    expect(toSampleText('')).toBe('');
  });
});
