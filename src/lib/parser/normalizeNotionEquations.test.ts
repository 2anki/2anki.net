import * as cheerio from 'cheerio';

import { normalizeNotionEquations } from './normalizeNotionEquations';

const INLINE_EQUATION = `<p>Euler: <span class="notion-text-equation-token" contenteditable="false">
  <span class="katex">
    <span class="katex-mathml">
      <math xmlns="http://www.w3.org/1998/Math/MathML">
        <semantics>
          <mrow><msup><mi>e</mi><mrow><mi>i</mi><mi>π</mi></mrow></msup></mrow>
          <annotation encoding="application/x-tex">e^{i\\pi} = -1</annotation>
        </semantics>
      </math>
    </span>
    <span class="katex-html" aria-hidden="true"><span class="base">e</span></span>
  </span>
</span> is neat.</p>`;

const BLOCK_EQUATION = `<figure class="equation">
  <div contenteditable="false">
    <span class="katex-display">
      <span class="katex">
        <span class="katex-mathml">
          <math xmlns="http://www.w3.org/1998/Math/MathML">
            <semantics>
              <mrow><mo>&#x222B;</mo></mrow>
              <annotation encoding="application/x-tex">\\int_0^1 x^2\\,dx = \\frac{1}{3}</annotation>
            </semantics>
          </math>
        </span>
        <span class="katex-html" aria-hidden="true"><span class="base">i</span></span>
      </span>
    </span>
  </div>
</figure>`;

const INLINE_LESS_THAN = `<p><span class="notion-text-equation-token">
  <span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow>
  <annotation encoding="application/x-tex">a &lt; b</annotation></semantics></math></span></span>
</span></p>`;

const MISSING_ANNOTATION = `<p>See <span class="notion-text-equation-token">
  <span class="katex"><span class="katex-html">x squared</span></span>
</span> here.</p>`;

// Real Notion HTML export (2026-07-23) never includes katex-mathml/annotation —
// only katex-html (the rendered glyphs) plus a data-notion-equation(-inline)?
// attribute carrying the raw LaTeX source.
const REAL_EXPORT_BLOCK_EQUATION = `<figure class="equation" data-notion-equation="E = mc^2" dir="auto"><style>@import url('https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/katex-swap.min.css')</style><div class="equation-container"><span class="katex-display"><span class="katex"><span class="katex-html" aria-hidden="true">E=mc2</span></span></span></div></figure>`;

const REAL_EXPORT_INLINE_EQUATION = `<p><span data-notion-inline-equation=" \\Delta D_P = \\sqrt{(\\Delta x)^2 + (\\Delta y)^2}" class="notion-text-equation-token" contenteditable="false"><span class="katex"><span class="katex-html" aria-hidden="true">ΔDP=(Δx)2+(Δy)2</span></span></span></p>`;

describe('normalizeNotionEquations', () => {
  it('converts an inline equation to Anki inline math delimiters', () => {
    const dom = cheerio.load(INLINE_EQUATION);

    normalizeNotionEquations(dom);
    const html = dom.html();

    expect(html).toContain('\\(e^{i\\pi} = -1\\)');
    expect(html).not.toContain('notion-text-equation-token');
    expect(html).not.toContain('class="katex"');
    expect(html).not.toContain('annotation');
  });

  it('converts a block equation to Anki display math delimiters', () => {
    const dom = cheerio.load(BLOCK_EQUATION);

    normalizeNotionEquations(dom);
    const html = dom.html();

    expect(html).toContain('\\[\\int_0^1 x^2\\,dx = \\frac{1}{3}\\]');
    expect(html).not.toContain('\\(\\int');
    expect(html).not.toContain('class="equation"');
    expect(html).not.toContain('katex-display');
  });

  it('escapes HTML-special characters in the extracted LaTeX', () => {
    const dom = cheerio.load(INLINE_LESS_THAN);

    normalizeNotionEquations(dom);

    expect(dom.html()).toContain('\\(a &lt; b\\)');
  });

  it('degrades a missing annotation to plain text without throwing or broken markup', () => {
    const dom = cheerio.load(MISSING_ANNOTATION);

    expect(() => normalizeNotionEquations(dom)).not.toThrow();
    const html = dom.html();

    expect(html).toContain('x squared');
    expect(html).not.toContain('\\(\\)');
    expect(html).not.toContain('notion-text-equation-token');
    expect(html).not.toContain('class="katex"');
  });

  it('extracts LaTeX from data-notion-equation on a real-export block equation (no annotation present)', () => {
    const dom = cheerio.load(REAL_EXPORT_BLOCK_EQUATION);

    normalizeNotionEquations(dom);
    const html = dom.html();

    expect(html).toContain('\\[E = mc^2\\]');
    expect(html).not.toContain('@import');
    expect(html).not.toContain('katex-swap');
    expect(html).not.toContain('class="equation"');
  });

  it('extracts LaTeX from data-notion-inline-equation on a real-export inline equation (no annotation present)', () => {
    const dom = cheerio.load(REAL_EXPORT_INLINE_EQUATION);

    normalizeNotionEquations(dom);
    const html = dom.html();

    expect(html).toContain(
      '\\(\\Delta D_P = \\sqrt{(\\Delta x)^2 + (\\Delta y)^2}\\)'
    );
    expect(html).not.toContain('notion-text-equation-token');
  });

  it('preserves a code wrapper when the code tag is nested inside the equation token', () => {
    const codeInsideToken = `<p>Recall <span data-notion-inline-equation="E = mc^2" class="notion-text-equation-token" contenteditable="false"><code><span class="katex"><span class="katex-html" aria-hidden="true">E=mc2</span></span></code></span> now.</p>`;
    const dom = cheerio.load(codeInsideToken);

    normalizeNotionEquations(dom);
    const html = dom.html();

    expect(html).toContain('<code>\\(E = mc^2\\)</code>');
    expect(html).not.toContain('notion-text-equation-token');
    expect(html).not.toContain('class="katex"');
  });

  it('keeps a code wrapper that sits outside the equation token untouched', () => {
    const codeOutsideToken = `<p>Recall <code><span data-notion-inline-equation="E = mc^2" class="notion-text-equation-token" contenteditable="false"><span class="katex"><span class="katex-html" aria-hidden="true">E=mc2</span></span></span></code> now.</p>`;
    const dom = cheerio.load(codeOutsideToken);

    normalizeNotionEquations(dom);
    const html = dom.html();

    expect(html).toContain('<code>\\(E = mc^2\\)</code>');
    expect(html).not.toContain('notion-text-equation-token');
  });

  it('strips a stray style tag instead of leaking its CSS text when degrading to plain text', () => {
    const noAttrNoAnnotation = `<figure class="equation" dir="auto"><style>@import url('https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/katex-swap.min.css')</style><div class="equation-container"><span class="katex-display"><span class="katex"><span class="katex-html" aria-hidden="true">E=mc2</span></span></span></div></figure>`;
    const dom = cheerio.load(noAttrNoAnnotation);

    normalizeNotionEquations(dom);
    const html = dom.html();

    expect(html).not.toContain('@import');
    expect(html).not.toContain('katex-swap');
    expect(html).toContain('E=mc2');
  });
});
