import handleClozeDeletions from './handleClozeDeletions';

describe('handleClozeDeletions', () => {
  it('should handle already formatted cloze deletions', () => {
    const input = '<p>The capital is <code>{{c1::Paris}}</code></p>';
    const expected = '<p>The capital is {{c1::Paris}}</p>';
    expect(handleClozeDeletions(input)).toBe(expected);
  });

  it('should handle missing braces', () => {
    const input = '<p>The capital is <code>c1::Paris</code></p>';
    const expected = '<p>The capital is {{c1::Paris}}</p>';
    expect(handleClozeDeletions(input)).toBe(expected);
  });

  it('should auto-number regular clozes after explicit ones', () => {
    const input = `
      <ul>
        <li>First point with <code>c1::explicit cloze</code></li>
        <li>Second point with <code>auto cloze</code></li>
        <li>Third point with <code>another auto cloze</code></li>
      </ul>
    `;
    const expected = `
      <ul>
        <li>First point with {{c1::explicit cloze}}</li>
        <li>Second point with {{c2::auto cloze}}</li>
        <li>Third point with {{c3::another auto cloze}}</li>
      </ul>
    `;
    expect(handleClozeDeletions(input)).toBe(expected);
  });

  it('should handle multiple explicit cloze numbers', () => {
    const input = `
      <p>
        <code>c2::Second</code> comes after <code>c1::First</code> and before <code>next</code>
      </p>
    `;
    const expected = `
      <p>
        {{c2::Second}} comes after {{c1::First}} and before {{c3::next}}
      </p>
    `;
    expect(handleClozeDeletions(input)).toBe(expected);
  });

  it('should handle KaTeX content', () => {
    const input = '<p>The formula is <code>KaTex:\\frac{1}{2}</code></p>';
    const expected = '<p>The formula is {{c1::\\frac{1}{2} }}</p>';
    expect(handleClozeDeletions(input)).toBe(expected);
  });

  it('should handle mixed KaTeX and regular clozes', () => {
    const input = `
      <p>
        <code>c1::First</code> then 
        <code>KaTex:\\frac{1}{2}</code> and 
        <code>regular text</code>
      </p>
    `;
    const expected = `
      <p>
        {{c1::First}} then 
        {{c2::\\frac{1}{2}}} and 
        {{c3::regular text}}
      </p>
    `;
    expect(handleClozeDeletions(input)).toBe(expected);
  });

  it('should handle nested cloze deletions with same number in summary', () => {
    const input =
      '<details><summary><code>c1::Good habits</code> are <code>c1::good</code> in general</summary></details>';
    const expected =
      '<details><summary>{{c1::Good habits}} are {{c1::good}} in general</summary></details>';
    expect(handleClozeDeletions(input)).toBe(expected);
  });

  it('should preserve existing nested cloze deletions in summary', () => {
    const input =
      '<details><summary><code>{{c1::Good}} things happen for {{c1::good}}</code> people</summary></details>';
    const expected =
      '<details><summary>{{c1::Good}} things happen for {{c1::good}} people</summary></details>';
    expect(handleClozeDeletions(input)).toBe(expected);
  });

  it('should handle empty details with summary', () => {
    const input = '<details><summary>Some text</summary></details>';
    const expected = '<details><summary>Some text</summary></details>';
    expect(handleClozeDeletions(input)).toBe(expected);
  });

  it('adjacent code siblings within the same parent merge into one cloze', () => {
    const input = '<p><code>bold</code><code>italic</code> is one concept</p>';
    const result = handleClozeDeletions(input);
    const matches = result.match(/\{\{c\d+::/g) ?? [];
    expect(matches.length).toBe(1);
    expect(result).toContain('bolditalic');
  });

  it('non-adjacent code elements in the same parent remain separate clozes', () => {
    const input = '<p><code>first</code> and then <code>second</code></p>';
    const result = handleClozeDeletions(input);
    const matches = result.match(/\{\{c\d+::/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('adjacent code siblings across different parents each become their own cloze', () => {
    const input =
      '<p><code>alpha</code><code>beta</code></p><p><code>gamma</code><code>delta</code></p>';
    const result = handleClozeDeletions(input);
    const matches = result.match(/\{\{c\d+::/g) ?? [];
    expect(matches.length).toBe(2);
    expect(result).toContain('alphabeta');
    expect(result).toContain('gammadelta');
  });

  it('single code element in a paragraph still becomes one cloze', () => {
    const input = '<p>The capital is <code>Paris</code></p>';
    const result = handleClozeDeletions(input);
    const matches = result.match(/\{\{c\d+::/g) ?? [];
    expect(matches.length).toBe(1);
    expect(result).toContain('{{c1::Paris}}');
  });
});

describe('#1411 — LaTeX inside cloze blocks', () => {
  it('two cloze blocks with KaTeX produce exactly two cloze tokens', () => {
    const input =
      '<p><code>KaTex:\\alpha</code> and <code>KaTex:\\beta</code></p>';
    const result = handleClozeDeletions(input);
    const matches = result.match(/\{\{c\d+::/g) ?? [];
    expect(matches.length).toBe(2);
    expect(result).toContain('{{c1::');
    expect(result).toContain('{{c2::');
  });

  it('three cloze blocks with mixed KaTeX and plain text produce exactly three cloze tokens', () => {
    const input =
      '<p><code>KaTex:\\alpha</code> and <code>plain text</code> and <code>KaTex:\\gamma</code></p>';
    const result = handleClozeDeletions(input);
    const matches = result.match(/\{\{c\d+::/g) ?? [];
    expect(matches.length).toBe(3);
  });

  it('non-standalone KaTeX (two code blocks) neither gets a trailing space', () => {
    const input =
      '<p><code>KaTex:\\frac{a}{b}</code> and <code>KaTex:\\frac{c}{d}</code></p>';
    const result = handleClozeDeletions(input);
    const matches = result.match(/\{\{c\d+::/g) ?? [];
    expect(matches.length).toBe(2);
    expect(result).not.toContain('\\frac{c}{d} }}');
    expect(result).not.toContain('\\frac{a}{b} }}');
  });
});

describe('#412 — pipe characters inside cloze deletions', () => {
  it('plain text with a pipe inside a cloze does not duplicate', () => {
    const input = '<p>Use the <code>x|y</code> operator</p>';
    const result = handleClozeDeletions(input);
    const matches = result.match(/\{\{c\d+::/g) ?? [];
    expect(matches.length).toBe(1);
    expect(result).toBe('<p>Use the {{c1::x|y}} operator</p>');
  });

  it('KaTeX with a pipe inside a cloze does not duplicate', () => {
    const input = '<p>The norm is <code>KaTex:\\|x\\|</code> here</p>';
    const result = handleClozeDeletions(input);
    const matches = result.match(/\{\{c\d+::/g) ?? [];
    expect(matches.length).toBe(1);
    expect(result).toBe('<p>The norm is {{c1::\\|x\\| }} here</p>');
  });

  it('multiple clozes each containing a pipe stay numbered correctly', () => {
    const input = '<p><code>a|b</code> and <code>c|d</code></p>';
    const result = handleClozeDeletions(input);
    const matches = result.match(/\{\{c\d+::/g) ?? [];
    expect(matches.length).toBe(2);
    expect(result).toContain('{{c1::a|b}}');
    expect(result).toContain('{{c2::c|d}}');
  });
});

describe('#1094 — code tags become cloze deletions', () => {
  it('code tag in the summary (front) of a toggle becomes a cloze deletion', () => {
    const input =
      '<p>The speed of light is <code>299792458 m/s</code> in a vacuum.</p>';
    const result = handleClozeDeletions(input);
    expect(result).toContain('{{c1::299792458 m/s}}');
    expect(result).not.toContain('<code>');
  });

  it('multiple code tags each become numbered cloze deletions', () => {
    const input = '<p><code>first</code> then <code>second</code></p>';
    const result = handleClozeDeletions(input);
    expect(result).toContain('{{c1::first}}');
    expect(result).toContain('{{c2::second}}');
  });
});

describe('#3245 — cloze on attributed inline code', () => {
  it('inline code carrying a class attribute still becomes a cloze', () => {
    const input =
      '<p>The capital is <code class="language-js">Paris</code></p>';
    const result = handleClozeDeletions(input);
    expect(result).toBe('<p>The capital is {{c1::Paris}}</p>');
  });

  it('explicit cloze on attributed code wraps the right element, not an earlier empty code', () => {
    const input = '<p>a <code></code> b <code>c1::answer</code> c</p>';
    const result = handleClozeDeletions(input);
    expect(result).toBe('<p>a <code></code> b {{c1::answer}} c</p>');
  });

  it('explicit cloze on a class-attributed code element gets the braces', () => {
    const input = '<p><code class="hl">c1::answer</code></p>';
    const result = handleClozeDeletions(input);
    expect(result).toBe('<p>{{c1::answer}}</p>');
  });
});

describe('inline equations wrapped in code become cloze deletions', () => {
  it('converts a coded MathJax equation into a single cloze without leaking a code tag', () => {
    const input = '<p>The identity <code>\\(E = mc^2\\)</code> is famous.</p>';
    const result = handleClozeDeletions(input);
    expect(result).toBe(
      '<p>The identity {{c1::\\(E = mc^2\\)}} is famous.</p>'
    );
    expect(result).not.toContain('<code>');
  });

  it('does not produce a triple closing brace when the equation ends in a curly brace', () => {
    const input = '<p><code>\\(\\frac{1}{2}\\)</code></p>';
    const result = handleClozeDeletions(input);
    expect(result).toBe('<p>{{c1::\\(\\frac{1}{2}\\)}}</p>');
    expect(result).not.toContain('}}}');
  });
});

describe('#2501 — group cloze blanks per toggle', () => {
  const threeBlanks =
    '<p><code>alpha</code> and <code>beta</code> and <code>gamma</code></p>';

  it('numbers each inline-code blank separately when grouping is off (default)', () => {
    const result = handleClozeDeletions(threeBlanks);

    expect(result).toContain('{{c1::alpha}}');
    expect(result).toContain('{{c2::beta}}');
    expect(result).toContain('{{c3::gamma}}');
  });

  it('collapses every inline-code blank onto the seed cloze number when grouping is on', () => {
    const result = handleClozeDeletions(threeBlanks, true);

    const c1Count = (result.match(/\{\{c1::/g) ?? []).length;
    expect(c1Count).toBe(3);
    expect(result).not.toContain('{{c2');
    expect(result).not.toContain('{{c3');
  });

  it('preserves an explicit user-typed cloze and collapses autos to the seed when grouping is on', () => {
    const withExplicit =
      '<p><code>c2::pinned</code> then <code>alpha</code> and <code>beta</code></p>';

    const result = handleClozeDeletions(withExplicit, true);

    expect(result).toContain('{{c2::pinned}}');
    const c3Count = (result.match(/\{\{c3::/g) ?? []).length;
    expect(c3Count).toBe(2);
    expect(result).not.toContain('{{c4');
  });
});
