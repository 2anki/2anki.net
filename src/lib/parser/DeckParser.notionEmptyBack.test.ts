import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

const page = (body: string) =>
  `<html><head><title>x</title></head><body><article class="page" id="p"><div class="page-body">${body}</div></article></body></html>`;

const toggle = (summary: string, body: string, id?: string) =>
  `<ul${id ? ` id="${id}"` : ''} class="toggle"><li><details><summary>${summary}</summary>${body}</details></li></ul>`;

const blockId = (n: number) =>
  `3e432d87-07b3-8057-a7da-${String(n).padStart(12, '0')}`;

const countsFor = async (html: string, options: Record<string, string>) => {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'notes.html',
    settings: new CardOption(options),
    files: [{ name: 'notes.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.writeDeckInfo(workspace);
  return {
    emptyBackCount: parser.emptyBackCount,
    notionEmptyBackCount: parser.notionEmptyBackCount,
  };
};

describe('empty backs from Notion-export toggles', () => {
  it('counts answerless toggles that carry a Notion block id', async () => {
    const html = page(
      toggle('Capital of France', '<p>Paris</p>', blockId(1)) +
        toggle('Capital of Spain', '<p></p>', blockId(2)) +
        toggle('Capital of Italy', '', blockId(3))
    );

    expect(await countsFor(html, { cloze: 'false' })).toEqual({
      emptyBackCount: 2,
      notionEmptyBackCount: 2,
    });
  });

  it('leaves toggles without a Notion block id out of the Notion count', async () => {
    const html = page(
      toggle('Capital of France', '<p>Paris</p>') +
        toggle('Capital of Spain', '<p></p>') +
        toggle('Capital of Italy', '', blockId(3))
    );

    expect(await countsFor(html, { cloze: 'false' })).toEqual({
      emptyBackCount: 2,
      notionEmptyBackCount: 1,
    });
  });
});
