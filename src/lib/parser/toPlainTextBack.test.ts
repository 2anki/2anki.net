import { toPlainTextBack } from './toPlainTextBack';

describe('toPlainTextBack', () => {
  it('turns nested toggle summaries into one line each', () => {
    const html =
      '<details class="toggle"><summary>Cost is <strong>monetary</strong> (£)</summary><div class="indented"></div></details><details class="toggle"><summary>Consequences ignored</summary></details>';

    expect(toPlainTextBack(html)).toBe(
      'Cost is monetary (£)<br>Consequences ignored'
    );
  });

  it('keeps paragraphs and list items apart and drops inline formatting', () => {
    expect(
      toPlainTextBack(
        '<p>One <em>two</em></p><ul><li>three</li><li>four</li></ul>'
      )
    ).toBe('One two<br>three<br>four');
  });

  it('treats explicit line breaks as lines and collapses whitespace', () => {
    expect(toPlainTextBack('<p>a<br/>b</p>\n   <p>  c   d </p>')).toBe(
      'a<br>b<br>c d'
    );
  });

  it('returns an empty string for an empty or whitespace-only back', () => {
    expect(toPlainTextBack('')).toBe('');
    expect(toPlainTextBack('<div class="indented">  </div>')).toBe('');
  });

  it('keeps text that looks like markup as text', () => {
    expect(
      toPlainTextBack('<p>a &lt;script&gt;x&lt;/script&gt; b &amp; c</p>')
    ).toBe('a &lt;script&gt;x&lt;/script&gt; b &amp; c');
  });

  it('keeps table cells apart with a space and rows on their own lines', () => {
    expect(
      toPlainTextBack(
        '<table><tr><td>Cost</td><td>£5</td></tr><tr><td>Time</td><td>2 h</td></tr></table>'
      )
    ).toBe('Cost £5<br>Time 2 h');
  });

  it('cuts a parent bullet off before its nested list', () => {
    expect(
      toPlainTextBack(
        '<ul><li>first<ul><li>sub</li></ul></li><li>second</li></ul>'
      )
    ).toBe('first<br>sub<br>second');
  });

  it('keeps everything after a stray close tag', () => {
    expect(toPlainTextBack('<p>a</p></div><p>b</p>')).toBe('a<br>b');
  });

  it('drops script and style content', () => {
    expect(
      toPlainTextBack('<style>.x{}</style><p>a</p><script>1</script>')
    ).toBe('a');
  });
});
