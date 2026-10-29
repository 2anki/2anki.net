import { hasVisibleContent } from './hasVisibleContent';

describe('hasVisibleContent', () => {
  it.each([
    ['plain text', 'Answer'],
    ['text inside markup', '<p class="" id="p-1">Answer</p>'],
    ['an escaped character', '<p>&amp;</p>'],
    ['an emoji', '<span>🍒</span>'],
    ['a sound tag', '[sound:clip.mp3]'],
    ['an image', '<p><img src="a.png"></p>'],
    ['an embedded video', '<figure><video src="v.mp4"></video></figure>'],
    ['an iframe embed', '<iframe src="https://example.com"></iframe>'],
    ['an inline svg', '<svg viewBox="0 0 1 1"></svg>'],
    ['a not-equal operator', '<>'],
    ['a three-way comparison', '<=>'],
    ['angle brackets in prose', 'a < b > c'],
  ])('keeps a back with %s', (_what, html) => {
    expect(hasVisibleContent(html)).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace', ' \n\t '],
    ['an empty paragraph', '<p class="" id="p-2"></p>'],
    ['line breaks', '<p><br /><br></p>'],
    ['non-breaking spaces', '<p>&nbsp;&#160;</p>'],
    ['an empty nested toggle', '<details><summary></summary></details>'],
    ['a divider only', '<hr />'],
    ['an empty code block', '<pre><code class="language-plain"></code></pre>'],
  ])('treats %s as empty', (_what, html) => {
    expect(hasVisibleContent(html)).toBe(false);
  });

  it.each([
    ['bare brackets', '<'],
    ['tag starts', '<a'],
  ])(
    'reads a long run of unclosed %s as text without rescanning it',
    (_what, unit) => {
      expect(hasVisibleContent(unit.repeat(200_000))).toBe(true);
    }
  );
});
