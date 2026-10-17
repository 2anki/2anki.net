import fs from 'fs';
import path from 'path';

import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';
import getUniqueFileName from '../misc/getUniqueFileName';

vi.mock('../../services/NotionService/helpers/downloadMediaOrSkip', () => ({
  downloadMediaOrSkip: vi.fn(async () => null),
}));

beforeEach(() => setupTests());

const PNG_BYTES = Buffer.from('fake-png-bytes-for-a-toggle');
const PNG_B64 = PNG_BYTES.toString('base64');
const PNG_NAME = `${getUniqueFileName(PNG_BYTES)}.png`;

function notionPageWithEmbeddedImage(extraToggles = ''): string {
  return [
    '<html><head><title>Anatomy</title></head><body>',
    '<article class="page sans"><h1 class="page-title">Anatomy</h1>',
    '<div class="page-body">',
    '<ul class="toggle"><li><details open=""><summary>What is shown?</summary>',
    `<p>The femur.</p><figure class="image"><img src="data:image/png;base64,${PNG_B64}"></figure>`,
    '</details></li></ul>',
    extraToggles,
    '</div></article></body></html>',
  ].join('');
}

function buildParser(
  workspace: Workspace,
  options: Record<string, string> = {},
  extraToggles = ''
) {
  return new DeckParser({
    name: 'anatomy.html',
    settings: new CardOption(options),
    files: [
      {
        name: 'anatomy.html',
        contents: notionPageWithEmbeddedImage(extraToggles),
      },
    ] as unknown as DeckParser['files'],
    noLimits: true,
    workspace,
  });
}

test('an image embedded as a data URI becomes a media file on the card instead of inline base64', async () => {
  const constructorWorkspace = new Workspace(true, 'fs');
  const buildWorkspace = Workspace.subdir(constructorWorkspace.location);
  const parser = buildParser(constructorWorkspace);

  await parser.writeDeckInfo(buildWorkspace);

  const card = parser.payload[0].cards[0];
  const src = /<img[^>]+src="([^"]+)"/.exec(card.back)?.[1];

  expect(card.back).not.toContain('data:image');
  expect(src).toBe(PNG_NAME);
  expect(card.media).toContain(PNG_NAME);
  expect(fs.readFileSync(path.join(buildWorkspace.location, src!))).toEqual(
    PNG_BYTES
  );
});

test('the parsed card HTML never holds the base64 payload, even before build', () => {
  const parser = buildParser(new Workspace(true, 'fs'));

  const card = parser.payload[0].cards[0];

  expect(card.back).not.toContain(PNG_B64);
  expect(card.back).toContain(`<img src="${PNG_NAME}">`);
});

test('with embed-images off the data URI stays inline so Anki can still show it', () => {
  const parser = buildParser(new Workspace(true, 'fs'), {
    'embed-images': 'false',
  });

  const card = parser.payload[0].cards[0];

  expect(card.back).toContain(`<img src="data:image/png;base64,${PNG_B64}">`);
  expect(parser.customExporter.media).toEqual([]);
});

test('a page mixing an embedded, a relative and a remote image keeps each on its own path', async () => {
  const workspace = new Workspace(true, 'fs');
  fs.writeFileSync(path.join(workspace.location, 'local.png'), 'local-bytes');
  const extra = [
    '<ul class="toggle"><li><details open=""><summary>Local?</summary>',
    '<img src="local.png"></details></li></ul>',
    '<ul class="toggle"><li><details open=""><summary>Remote?</summary>',
    '<img src="https://example.com/remote.png"></details></li></ul>',
  ].join('');
  const parser = buildParser(workspace, {}, extra);

  await parser.writeDeckInfo(workspace);

  const [embedded, local, remote] = parser.payload[0].cards;
  expect(embedded.back).toContain(`<img src="${PNG_NAME}">`);
  expect(embedded.media).toEqual([PNG_NAME]);
  expect(local.back).toContain(
    `<img src="${getUniqueFileName('local-bytes')}.png">`
  );
  expect(local.media).toEqual([`${getUniqueFileName('local-bytes')}.png`]);
  expect(remote.back).toContain('<img src="https://example.com/remote.png">');
  expect(remote.media).toEqual([]);
  expect(parser.droppedImageCount).toBe(1);
});

test('the same picture used twice is written once and both cards reference it', () => {
  const extra = [
    '<ul class="toggle"><li><details open=""><summary>Again?</summary>',
    `<img src="data:image/png;base64,${PNG_B64}"></details></li></ul>`,
  ].join('');
  const parser = buildParser(new Workspace(true, 'fs'), {}, extra);

  const [first, second] = parser.payload[0].cards;

  expect(first.back).toContain(`<img src="${PNG_NAME}">`);
  expect(second.back).toContain(`<img src="${PNG_NAME}">`);
  expect(parser.customExporter.media).toHaveLength(1);
});
