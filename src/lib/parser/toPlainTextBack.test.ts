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
});
