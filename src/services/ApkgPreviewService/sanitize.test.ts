import {
  extractTemplateStyles,
  sanitizeCardHtml,
  sanitizeCss,
} from './sanitize';

describe('sanitizeCardHtml', () => {
  it('preserves mark tags with highlight-yellow_background class', () => {
    const html =
      '<p><mark class="highlight-yellow_background">yellow highlighted</mark></p>';
    expect(sanitizeCardHtml(html)).toBe(html);
  });

  it('preserves hljs token spans on highlighted code', () => {
    const html =
      '<pre><code class="hljs language-javascript"><span class="hljs-keyword">const</span> x = 1;</code></pre>';
    expect(sanitizeCardHtml(html)).toBe(html);
  });

  it('preserves mark tags with highlight-red_background class', () => {
    const html =
      '<p><mark class="highlight-red_background">red highlighted</mark></p>';
    expect(sanitizeCardHtml(html)).toBe(html);
  });

  it('preserves mark tags with inline background style', () => {
    const input =
      '<p><mark style="background: rgb(251,243,219)">styled highlight</mark></p>';
    const result = sanitizeCardHtml(input);
    expect(result).toContain('<mark');
    expect(result).toContain('background');
    expect(result).toContain('styled highlight</mark>');
  });

  it('preserves multiple highlight colors in the same card', () => {
    const html =
      '<p><mark class="highlight-yellow_background">yellow</mark> and <mark class="highlight-blue_background">blue</mark></p>';
    expect(sanitizeCardHtml(html)).toBe(html);
  });

  it('strips script tags', () => {
    expect(sanitizeCardHtml('<script>alert(1)</script>')).toBe('');
  });

  it('strips canvas tags used by the Image Occlusion template', () => {
    expect(
      sanitizeCardHtml('<canvas id="image-occlusion-canvas"></canvas>')
    ).toBe('');
  });

  it('strips on* event handlers from allowed elements', () => {
    const result = sanitizeCardHtml(
      '<rect x="0" y="0" onclick="alert(1)" onload="x()" />'
    );
    expect(result).not.toMatch(/\son[a-z]+=/i);
  });

  it('preserves static inline SVG occlusion primitives', () => {
    const svg =
      '<svg class="apkg-io-overlay" viewBox="0 0 1 1" preserveAspectRatio="none">' +
      '<image href="brain.png" x="0" y="0" width="1" height="1" preserveAspectRatio="none" />' +
      '<g><rect x="0.1" y="0.2" width="0.3" height="0.4" fill="#ffeba2" stroke="#e6a900" stroke-width="0.004" />' +
      '<ellipse cx="0.35" cy="0.35" rx="0.1" ry="0.05" fill="#ffeba2" />' +
      '<polygon points="0.1,0.2 0.3,0.4 0.5,0.1" fill="#ffeba2" /></g></svg>';
    const result = sanitizeCardHtml(svg);
    expect(result).toContain('<svg');
    expect(result).toContain('viewBox="0 0 1 1"');
    expect(result).toContain('<image');
    expect(result).toContain('href="brain.png"');
    expect(result).toContain('<rect');
    expect(result).toContain('<ellipse');
    expect(result).toContain('<polygon');
  });

  it('preserves basic formatting tags', () => {
    const html = '<p><strong>bold</strong> and <em>italic</em></p>';
    expect(sanitizeCardHtml(html)).toBe(html);
  });

  it('preserves ruby furigana markup including rb and rp (regression: #3739)', () => {
    const html = '<ruby><rb>一</rb><rp>(</rp><rt>いち</rt><rp>)</rp></ruby>';
    expect(sanitizeCardHtml(html)).toBe(html);
  });

  it('preserves details and summary toggle markup (regression: #3739)', () => {
    const html = '<details open><summary>hint</summary>answer</details>';
    expect(sanitizeCardHtml(html)).toBe(html);
  });
});

describe('sanitizeCss', () => {
  it('strips @import rules', () => {
    expect(sanitizeCss('@import url("evil.css");')).toBe('');
  });

  it('strips javascript: in expressions', () => {
    expect(sanitizeCss('expression(alert(1))')).toBe('alert(1))');
  });

  it('preserves highlight class definitions', () => {
    const css =
      '.highlight-yellow_background { background: rgb(251,243,219); }';
    expect(sanitizeCss(css)).toBe(css);
  });
});

describe('sanitizeCardHtml — print option', () => {
  const html = '<div id="popup"><button onclick="x()">Close</button>kept</div>';

  it('strips ids and keeps button labels by default', () => {
    expect(sanitizeCardHtml(html)).toBe('<div>Closekept</div>');
  });

  it('keeps ids and drops buttons with their labels when printing', () => {
    expect(sanitizeCardHtml(html, { print: true })).toBe(
      '<div id="popup">kept</div>'
    );
  });

  it('still drops scripts and event handlers when printing', () => {
    expect(
      sanitizeCardHtml('<div onclick="x()">a</div><script>x()</script>', {
        print: true,
      })
    ).toBe('<div>a</div>');
  });

  it('drops href-less popup anchors and their glyph when printing', () => {
    expect(
      sanitizeCardHtml('<div id="popup"><a href="">↪</a>kept</div>', {
        print: true,
      })
    ).toBe('<div id="popup">kept</div>');
  });

  it('keeps anchors with an href when printing', () => {
    const html = '<a href="https://x.com">link</a><a href="#jump">frag</a>';
    expect(sanitizeCardHtml(html, { print: true })).toBe(html);
  });

  it('keeps href-less anchors that carry words when printing', () => {
    expect(
      sanitizeCardHtml('<a name="term">Key term</a> after', { print: true })
    ).toBe('<a>Key term</a> after');
  });

  it('keeps href-less anchors that wrap an image when printing', () => {
    const html = '<a><img src="logo.png" /></a>';
    expect(sanitizeCardHtml(html, { print: true })).toBe(html);
  });

  it('keeps href-less anchors that wrap a nested image when printing', () => {
    const html = '<a><span><img src="logo.png" /></span></a>';
    expect(sanitizeCardHtml(html, { print: true })).toBe(html);
  });

  it('keeps href-less anchors on non-print surfaces', () => {
    expect(sanitizeCardHtml('<a>↪</a>kept')).toBe('<a>↪</a>kept');
  });
});

describe('extractTemplateStyles', () => {
  it('returns the contents of every <style> block in a template', () => {
    const template =
      '<div>{{Front}}</div><style>#a { color: red; }</style><style media="all">.b { top: 0; }</style>';
    expect(extractTemplateStyles(template)).toBe(
      '#a { color: red; }\n.b { top: 0; }'
    );
  });

  it('returns an empty string when the template has no <style>', () => {
    expect(extractTemplateStyles('{{Front}}')).toBe('');
  });
});

describe('sanitizeCss — cannot close its <style> element', () => {
  it.each([
    '.a{}</style><script>alert(1)</script>',
    '.a{}</sty</style>le><script>alert(1)</script>',
    '.a{}</style\n<img src=x onerror=alert(1)>',
  ])('leaves no HTML tag in %s', (css) => {
    const out = sanitizeCss(css);
    expect(out).not.toMatch(/<\/?[a-z]/i);
  });
});
