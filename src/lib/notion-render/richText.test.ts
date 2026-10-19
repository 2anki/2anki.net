import {
  renderPlainText,
  renderRichText,
  wrapBlockWithColorClass,
} from './richText';

describe('wrapBlockWithColorClass', () => {
  it('wraps a text colour in a block div with an inline colour style', () => {
    expect(wrapBlockWithColorClass('red', 'body')).toBe(
      '<div class="block-color-red" style="color: #E03E3E">body</div>'
    );
  });

  it('wraps a background colour in a block div with an inline background style', () => {
    expect(wrapBlockWithColorClass('red_background', 'body')).toBe(
      '<div class="block-color-red_background" style="background-color: rgb(253, 235, 236)">body</div>'
    );
  });

  it('returns the content untouched for a default or unknown colour', () => {
    expect(wrapBlockWithColorClass('default', 'body')).toBe('body');
    expect(wrapBlockWithColorClass(undefined, 'body')).toBe('body');
    expect(wrapBlockWithColorClass('chartreuse', 'body')).toBe('body');
  });
});

describe('renderRichText', () => {
  it('returns empty string for nullish or empty input', () => {
    expect(renderRichText(undefined)).toBe('');
    expect(renderRichText([])).toBe('');
  });

  it('escapes html-special characters in plain_text', () => {
    expect(renderRichText([{ plain_text: '<script>&"' }])).toBe(
      '&lt;script&gt;&amp;&quot;'
    );
  });

  it('wraps annotated text — bold + italic + code + strike + underline', () => {
    expect(
      renderRichText([
        {
          plain_text: 'hi',
          annotations: {
            bold: true,
            italic: true,
            code: true,
            strikethrough: true,
            underline: true,
          },
        },
      ])
    ).toBe('<u><del><em><strong><code>hi</code></strong></em></del></u>');
  });

  it('wraps text in a color class for non-default text colors', () => {
    expect(
      renderRichText([{ plain_text: 'red', annotations: { color: 'red' } }])
    ).toBe('<span class="n2a-highlight-red" style="color: #E03E3E">red</span>');
  });

  it('wraps text in a background color class', () => {
    expect(
      renderRichText([
        { plain_text: 'hl', annotations: { color: 'blue_background' } },
      ])
    ).toBe(
      '<span class="n2a-highlight-blue_background" style="background-color: rgb(231, 243, 248)">hl</span>'
    );
  });

  it('keeps color inside bold and link wrapping', () => {
    expect(
      renderRichText([
        {
          plain_text: 'word',
          href: 'https://example.com',
          annotations: { bold: true, color: 'purple' },
        },
      ])
    ).toBe(
      '<a href="https://example.com"><span class="n2a-highlight-purple" style="color: #6940A5"><strong>word</strong></span></a>'
    );
  });

  it('does not wrap default color or unknown color names', () => {
    expect(
      renderRichText([{ plain_text: 'a', annotations: { color: 'default' } }])
    ).toBe('a');
    expect(
      renderRichText([
        { plain_text: 'b', annotations: { color: 'chartreuse' } },
      ])
    ).toBe('b');
  });

  it('renders an anchor tag when href is present', () => {
    expect(
      renderRichText([
        { plain_text: 'click', href: 'https://example.com/?x=1&y=2' },
      ])
    ).toBe('<a href="https://example.com/?x=1&amp;y=2">click</a>');
  });

  it('renders inline LaTeX for equation items', () => {
    expect(
      renderRichText([{ type: 'equation', equation: { expression: 'a < b' } }])
    ).toBe('\\(a &lt; b\\)');
  });
});

describe('renderPlainText', () => {
  it('joins plain_text without escaping or annotations', () => {
    expect(
      renderPlainText([
        { plain_text: 'a', annotations: { bold: true } },
        { plain_text: '<b>' },
      ])
    ).toBe('a<b>');
  });

  it('returns empty string for nullish input', () => {
    expect(renderPlainText(undefined)).toBe('');
  });
});
