import fs from 'fs';
import path from 'path';

import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

const PNG_BYTES = Buffer.from('fake-png-bytes-for-a-toggle');
const PNG_B64 = PNG_BYTES.toString('base64');

function notionPageWithEmbeddedImage(): string {
  return [
    '<html><head><title>Anatomy</title></head><body>',
    '<article class="page sans"><h1 class="page-title">Anatomy</h1>',
    '<div class="page-body">',
    '<ul class="toggle"><li><details open=""><summary>What is shown?</summary>',
    `<p>The femur.</p><figure class="image"><img src="data:image/png;base64,${PNG_B64}"></figure>`,
    '</details></li></ul>',
    '</div></article></body></html>',
  ].join('');
}

function buildParser(workspace: Workspace) {
  return new DeckParser({
    name: 'anatomy.html',
    settings: new CardOption({}),
    files: [
      { name: 'anatomy.html', contents: notionPageWithEmbeddedImage() },
    ] as unknown as DeckParser['files'],
    noLimits: true,
    workspace,
  });
}

test('an image embedded as a data URI becomes a media file on the card instead of inline base64', async () => {
  process.env.SKIP_CREATE_DECK = 'true';

  const constructorWorkspace = new Workspace(true, 'fs');
  const buildWorkspace = Workspace.subdir(constructorWorkspace.location);
  const parser = buildParser(constructorWorkspace);

  await parser.writeDeckInfo(buildWorkspace);

  const card = parser.payload[0].cards[0];
  const src = /<img[^>]+src="([^"]+)"/.exec(card.back)?.[1];

  expect(card.back).not.toContain('data:image');
  expect(src).toMatch(/^[0-9a-f]+\.png$/);
  expect(card.media).toContain(src);
  expect(fs.readFileSync(path.join(buildWorkspace.location, src!))).toEqual(
    PNG_BYTES
  );
});

test('the parsed card HTML never holds the base64 payload, even before build', () => {
  const parser = buildParser(new Workspace(true, 'fs'));

  const card = parser.payload[0].cards[0];

  expect(card.back).not.toContain(PNG_B64);
  expect(card.back).toContain('.png"');
});
