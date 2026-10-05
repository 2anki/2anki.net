import { markdownToHTML, markdownToInlineHTML } from './markdown';

describe('markdownToHTML', () => {
  describe('basic inline formatting', () => {
    it('renders bold text as strong', () => {
      const result = markdownToHTML('**Galactosaemia** and other text');
      expect(result).toContain('<strong>Galactosaemia</strong>');
      expect(result).toContain('and other text');
    });

    it('renders a plain paragraph', () => {
      const result = markdownToHTML('Simple paragraph here');
      expect(result).toContain('Simple paragraph here');
    });

    it('renders inline code', () => {
      const result = markdownToHTML('Use `markdownToHTML` function');
      expect(result).toContain('<code>markdownToHTML</code>');
    });
  });

  describe('simple line breaks', () => {
    it('converts bare newlines to br tags', () => {
      const result = markdownToHTML('Line one\nLine two');
      expect(result).toContain('<br');
      expect(result).toContain('Line one');
      expect(result).toContain('Line two');
    });
  });

  describe('headings', () => {
    it('renders a heading', () => {
      const result = markdownToHTML('## Section heading');
      expect(result).toContain('<h2>');
      expect(result).toContain('Section heading');
    });
  });

  describe('nested bullets', () => {
    it('renders nested list items', () => {
      const result = markdownToHTML('- Parent item\n  - Child item');
      expect(result).toContain('<ul>');
      expect(result).toContain('Parent item');
      expect(result).toContain('Child item');
    });
  });

  describe('task lists (MCQ compatibility)', () => {
    it('renders a task list byte-for-byte like the former plugin', () => {
      const result = markdownToHTML(
        '- [x] Correct answer\n- [ ] Wrong one\n- [ ] Also wrong'
      );
      expect(result).toBe(
        '<ul class="contains-task-list">\n' +
          '<li class="task-list-item"><input class="task-list-item-checkbox" checked="" disabled="" type="checkbox"> Correct answer</li>\n' +
          '<li class="task-list-item"><input class="task-list-item-checkbox" disabled="" type="checkbox"> Wrong one</li>\n' +
          '<li class="task-list-item"><input class="task-list-item-checkbox" disabled="" type="checkbox"> Also wrong</li>\n' +
          '</ul>\n'
      );
    });

    it('keeps the checkbox a direct child of the li for MCQ detection', () => {
      const result = markdownToHTML('- [x] Correct\n- [ ] Wrong');
      expect(result).toContain(
        '<li class="task-list-item"><input class="task-list-item-checkbox" checked="" disabled="" type="checkbox">'
      );
    });

    it('treats an uppercase [X] as checked', () => {
      const result = markdownToHTML('- [X] Upper');
      expect(result).toBe(
        '<ul class="contains-task-list">\n' +
          '<li class="task-list-item"><input class="task-list-item-checkbox" checked="" disabled="" type="checkbox"> Upper</li>\n' +
          '</ul>\n'
      );
    });

    it('nests a task list under a task item like the former plugin', () => {
      const result = markdownToHTML('- [ ] Parent\n  - [x] Child');
      expect(result).toBe(
        '<ul class="contains-task-list">\n' +
          '<li class="task-list-item"><input class="task-list-item-checkbox" disabled="" type="checkbox"> Parent\n' +
          '<ul class="contains-task-list">\n' +
          '<li class="task-list-item"><input class="task-list-item-checkbox" checked="" disabled="" type="checkbox"> Child</li>\n' +
          '</ul>\n' +
          '</li>\n' +
          '</ul>\n'
      );
    });

    it('leaves a plain bullet (no checkbox marker) untouched', () => {
      const result = markdownToHTML('- Just a bullet');
      expect(result).toBe('<ul>\n<li>Just a bullet</li>\n</ul>\n');
    });
  });

  describe('standalone GFM table (core renderer)', () => {
    const table = [
      '| Category | Cause | Mechanism |',
      '| :--- | :---: | ---: |',
      '| Increased | Haemolytic *disease* | `code` and \\| pipe |',
    ].join('\n');

    it('renders a table with per-column alignment styles', () => {
      const result = markdownToHTML(table);
      expect(result).toContain('<th style="text-align:left">Category</th>');
      expect(result).toContain('<th style="text-align:center">Cause</th>');
      expect(result).toContain('<th style="text-align:right">Mechanism</th>');
    });

    it('renders inline formatting and code inside cells', () => {
      const result = markdownToHTML(table);
      expect(result).toContain('Haemolytic <em>disease</em>');
      expect(result).toContain('<code>code</code>');
    });

    it('unescapes an escaped pipe inside a cell to a literal bar', () => {
      const result = markdownToHTML(table);
      expect(result).toContain('and | pipe');
      expect(result).not.toContain('\\|');
    });
  });

  describe('MultiMarkdown-only syntax is intentionally unsupported', () => {
    it('does not emit colspan for the `||` cell-span syntax', () => {
      const result = markdownToHTML(
        ['| A | B | C |', '| --- | --- | --- |', '| 1 | spanning ||'].join('\n')
      );
      expect(result).toContain('<table');
      expect(result).not.toContain('colspan');
    });

    it('renders a `||` empty cell as an empty <td>, not a span', () => {
      const result = markdownToHTML(
        ['| A | B |', '| --- | --- |', '| 1 | ||'].join('\n')
      );
      expect(result).toContain('<td>1</td>\n<td></td>');
      expect(result).not.toContain('colspan');
    });

    it('leaves a trailing `[Caption]` as an extra table row, not a <caption>', () => {
      const result = markdownToHTML(
        ['| A | B |', '| --- | --- |', '| 1 | 2 |', '[Cap]'].join('\n')
      );
      expect(result).toContain('<table');
      expect(result).not.toContain('<caption');
      expect(result).toContain('<td>[Cap]</td>');
    });

    it('ends the table at a blank line, dropping any later rows out of it', () => {
      const result = markdownToHTML(
        ['| A | B |', '| --- | --- |', '| 1 | 2 |', '', '| 3 | 4 |'].join('\n')
      );
      expect(result).toContain('<p>| 3 | 4 |</p>');
    });

    it('pulls a GFM continuation line into the table as an extra row', () => {
      const result = markdownToHTML(
        ['| A | B |', '| --- | --- |', '| 1 | 2 |', 'next line'].join('\n')
      );
      expect(result).toContain('<td>next line</td>');
    });

    it('splits an unescaped pipe inside inline code across cells (escape it)', () => {
      const result = markdownToHTML(
        ['| A | B |', '| --- | --- |', '| `a | b` | c |'].join('\n')
      );
      expect(result).toContain('<td>`a</td>');
      expect(result).toContain('<td>b`</td>');
    });

    it('renders an escaped pipe inside a cell as a literal bar', () => {
      const result = markdownToHTML(
        ['| A | B |', '| --- | --- |', '| a \\| b | c |'].join('\n')
      );
      expect(result).toContain('<td>a | b</td>');
    });
  });

  describe('tables inside code and indented contexts are left alone', () => {
    it('keeps table pipes literal inside a fenced code block', () => {
      const result = markdownToHTML(
        ['```', 'x = 1', '| A | B |', '| --- | --- |', '```'].join('\n')
      );
      expect(result).toContain('<pre><code>');
      expect(result).toContain('| A | B |');
      expect(result).not.toContain('<table');
    });

    it('nests a table indented under a bullet without making the list loose', () => {
      const result = markdownToHTML(
        ['- bullet', '  | A | B |', '  | --- | --- |', '  | 1 | 2 |'].join('\n')
      );
      expect(result).toContain('<li>bullet\n<table>');
      expect(result).not.toContain('<li>\n<p>');
    });

    it('keeps a shorter inner fence as code and still isolates the table after it', () => {
      const result = markdownToHTML(
        [
          '````',
          '```',
          'x',
          '````',
          '- item',
          '| A | B |',
          '| --- | --- |',
        ].join('\n')
      );
      expect(result).toContain('<pre><code>');
      expect(result).toContain('<table');
    });

    it('keeps an info-string fence line as code and still isolates the table after it', () => {
      const result = markdownToHTML(
        [
          '```',
          '```js',
          'x = 1',
          '```',
          '- item',
          '| A | B |',
          '| --- | --- |',
        ].join('\n')
      );
      expect(result).toContain('x = 1');
      expect(result).toContain('<table');
    });

    it('treats a line-start inline code span as a paragraph, not a never-closing fence', () => {
      const result = markdownToHTML(
        ['```x``` here', '', '- item', '| A | B |', '| --- | --- |'].join('\n')
      );
      expect(result).toContain('<code>x</code>');
      expect(result).toContain('<table');
      expect(result).not.toContain('<pre>');
    });
  });

  describe('U+00A0 non-breaking space', () => {
    it('passes through content containing U+00A0 without double-escaping', () => {
      const input = 'Hello world';
      const result = markdownToHTML(input);
      expect(result).not.toContain('&amp;nbsp;');
      expect(result).toContain('world');
    });
  });

  describe('trimWhitespace option', () => {
    it('trims leading and trailing whitespace when flag is true', () => {
      const result = markdownToHTML('  hello  ', true);
      expect(result).toContain('hello');
    });
  });

  describe('Notion callout <aside> wrapper (regression: #2529)', () => {
    it('strips opening <aside> tag from rendered HTML', () => {
      const input =
        '<aside>\n🩺 Jaundice is abnormal when:\n\n- It occurs within 24 hours of birth\n</aside>';
      const html = markdownToHTML(input);
      expect(html).not.toContain('&lt;aside');
      expect(html).not.toContain('&lt;/aside');
      expect(html).not.toContain('<aside');
      expect(html).not.toContain('</aside>');
    });

    it('preserves callout content after stripping <aside> wrapper', () => {
      const input =
        '<aside>\n🩺 Jaundice is abnormal when:\n\n- It occurs within 24 hours of birth\n</aside>';
      const html = markdownToHTML(input);
      expect(html).toContain('Jaundice is abnormal');
    });

    it('preserves bullet list inside a callout block', () => {
      const input =
        '<aside>\n🩺 Jaundice is abnormal when:\n\n- It occurs within 24 hours of birth\n</aside>';
      const html = markdownToHTML(input);
      expect(html).toContain('<ul>');
      expect(html).toContain('24 hours');
    });
  });

  describe('GFM table in bullet item (regression: user 10781)', () => {
    const galactosaemia = [
      '- **Galactosaemia** and other inborn errors of metabolism',
      '| Category | Cause | Mechanism / Explanation |',
      '| --- | --- | --- |',
      '| Increased Production of Bilirubin | Haemolytic disease | Excessive breakdown |',
    ].join('\n');

    it('renders a table element (not pipe text)', () => {
      const result = markdownToHTML(galactosaemia);
      expect(result).toContain('<table');
    });

    it('includes a thead with the correct column headers', () => {
      const result = markdownToHTML(galactosaemia);
      expect(result).toContain('<thead');
      expect(result).toContain('Category');
      expect(result).toContain('Cause');
      expect(result).toContain('Mechanism / Explanation');
    });

    it('includes at least one data row in tbody', () => {
      const result = markdownToHTML(galactosaemia);
      expect(result).toContain('<tbody');
      expect(result).toContain('Haemolytic disease');
      expect(result).toContain('Excessive breakdown');
    });

    it('preserves the bold text in the bullet', () => {
      const result = markdownToHTML(galactosaemia);
      expect(result).toContain('<strong>Galactosaemia</strong>');
    });

    it('does not leak raw pipe characters as text', () => {
      const result = markdownToHTML(galactosaemia);
      expect(result).not.toContain('| --- | --- |');
    });
  });

  describe('furigana and toggle markup (regression: #3739)', () => {
    it('passes ruby furigana tags through instead of escaping them', () => {
      const result = markdownToHTML('<ruby>一<rt>いち</rt></ruby>');
      expect(result).toContain('<ruby>一<rt>いち</rt></ruby>');
      expect(result).not.toContain('&lt;ruby&gt;');
    });

    it('passes rp and rb ruby fallback tags through', () => {
      const result = markdownToHTML(
        '<ruby><rb>一</rb><rp>(</rp><rt>いち</rt><rp>)</rp></ruby>'
      );
      expect(result).toContain('<rb>一</rb>');
      expect(result).toContain('<rp>(</rp>');
      expect(result).not.toContain('&lt;rb&gt;');
    });

    it('passes details and summary toggle tags through', () => {
      const result = markdownToHTML('<summary>hint</summary>answer');
      expect(result).toContain('<summary>hint</summary>');
      expect(result).not.toContain('&lt;summary&gt;');
    });

    it('renders furigana in an inline (front) render too', () => {
      const result = markdownToInlineHTML('<ruby>猫<rt>ねこ</rt></ruby>');
      expect(result).toContain('<ruby>猫<rt>ねこ</rt></ruby>');
    });

    it('still escapes non-allowlisted tags like script', () => {
      const result = markdownToHTML('<script>alert(1)</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
    });

    it('does not un-escape a tag that merely starts with an allowlisted name', () => {
      const result = markdownToHTML('<rubyish>x</rubyish>');
      expect(result).not.toContain('<rubyish>');
      expect(result).toContain('&lt;rubyish&gt;');
    });
  });

  describe('inline HTML formatting tags (regression: #3743)', () => {
    it('passes br and bold tags through instead of escaping them', () => {
      const result = markdownToHTML('foo<br><b>bar</b>');
      expect(result).toContain('foo<br><b>bar</b>');
      expect(result).not.toContain('&lt;br&gt;');
      expect(result).not.toContain('&lt;b&gt;');
    });

    it('passes the common inline set through (em, u, s, code, sub, sup, mark, small)', () => {
      const result = markdownToHTML(
        '<em>a</em><u>b</u><s>c</s><code>d</code><sub>e</sub><sup>f</sup><mark>g</mark><small>h</small>'
      );
      for (const tag of [
        'em',
        'u',
        's',
        'code',
        'sub',
        'sup',
        'mark',
        'small',
      ]) {
        expect(result).toContain(`<${tag}>`);
        expect(result).not.toContain(`&lt;${tag}&gt;`);
      }
    });

    it('renders inline formatting in an inline (front) render too', () => {
      const result = markdownToInlineHTML('term<br><strong>x</strong>');
      expect(result).toContain('<br>');
      expect(result).toContain('<strong>x</strong>');
    });

    it('does not un-escape blockquote just because it starts with b', () => {
      const result = markdownToHTML('<blockquote>x</blockquote>');
      expect(result).not.toContain('<blockquote>');
      expect(result).toContain('&lt;blockquote&gt;');
    });
  });

  describe('raw <img> tags in markdown (regression: #4403)', () => {
    it('restores an inline base64 image instead of escaping it into text', () => {
      const src = 'data:image/png;base64,iVBORw0KGgo=';
      const result = markdownToHTML(`Look: <img src="${src}" alt="cell">`);
      expect(result).toContain(`<img src="${src}" alt="cell">`);
      expect(result).not.toContain('&lt;img');
    });

    it('restores a relative image path so the zip embed step can pick it up', () => {
      const result = markdownToHTML("<img src='images/heart.png'>");
      expect(result).toContain('<img src="images/heart.png">');
    });

    it('keeps only src and alt, dropping event handler attributes', () => {
      const result = markdownToHTML(
        '<img src="x.png" onerror="alert(1)" alt="a">'
      );
      expect(result).toContain('<img src="x.png" alt="a">');
      expect(result).not.toContain('onerror');
    });

    it('leaves an image with a script scheme escaped', () => {
      const result = markdownToHTML('<img src="javascript:alert(1)">');
      expect(result).not.toContain('<img');
      expect(result).toContain('&lt;img');
    });

    it('restores images in the inline (front) render too', () => {
      const result = markdownToInlineHTML('<img src="a.png">');
      expect(result).toContain('<img src="a.png">');
    });
  });
});
