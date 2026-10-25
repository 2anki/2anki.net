import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

const page = `<html><head><title>Page</title></head><body><article class="page sans"><header><h1 class="page-title">Page</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>Question</summary>
<aside class="block-color-gray_background callout" data-notion-callout="" data-notion-callout-icon="💡" style="white-space:pre-wrap;display:flex"><div style="font-size:1.5em"><span class="icon" data-emoji="💡"></span></div><div style="width:100%"><ul class="bulleted-list"><li style="list-style-type:disc">Answer</li></ul></div></aside>
</details></li></ul></div></article></body></html>`;

async function backOfFirstCard(html: string) {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'test.html',
    settings: new CardOption({ cherry: 'false' }),
    files: [{ name: 'test.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);
  return parser.payload[0].cards[0].back;
}

describe('callout icon in a Notion HTML export', () => {
  it('writes the emoji into the empty icon span so the card shows it', async () => {
    const back = await backOfFirstCard(page);

    expect(back).toContain('<span class="icon" data-emoji="💡">💡</span>');
  });

  it('leaves an icon span that already has content alone', async () => {
    const back = await backOfFirstCard(
      page.replace('data-emoji="💡"></span>', 'data-emoji="💡">★</span>')
    );

    expect(back).toContain('>★</span>');
    expect(back).not.toContain('★💡');
  });
});
