import fs from 'fs';
import os from 'os';
import path from 'path';

import { setupTests } from '../../../test/configure-jest';
import { expandCompactDeckInfo } from '../../claude/ClaudeService';
import { parseApkgNotes } from '../../../services/ApkgPreviewService/parseApkgNotes';
import CardOption from '../Settings/CardOption';
import { DeckParser } from '../DeckParser';
import Deck from '../Deck';
import Workspace from '../WorkSpace';
import CustomExporter from './CustomExporter';

const FOLDER = 'Lecture notes 3f2a9c1b';
const LONG_FOLDER = `${'Very long Notion page title '.repeat(5)}1a2b3c4d`;
const UPLOAD_IMAGES = [
  `${FOLDER}/image[1].png`,
  `${FOLDER}/time 10:15.png`,
  `${FOLDER}/why?.png`,
  `${LONG_FOLDER}/photo.png`,
];
const REFUSED_CHARACTER = /[[\]<>:"/?*^\\|]/;
const MAX_MEDIA_NAME_BYTES = 120;

beforeEach(() => {
  setupTests();
});

function workspaceWithImages(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-names-'));
  UPLOAD_IMAGES.forEach((image, index) => {
    fs.mkdirSync(path.join(dir, path.dirname(image)), { recursive: true });
    fs.writeFileSync(path.join(dir, image), `image-${index}`);
  });
  return dir;
}

function aiDecks() {
  return expandCompactDeckInfo(
    [
      {
        deck: 'Lecture',
        cards: UPLOAD_IMAGES.map((image, index) => ({
          q: `Question ${index}`,
          a: `<img src="${encodeURI(image)}">`,
        })),
      },
    ],
    UPLOAD_IMAGES,
    null
  );
}

function isNameAnkiAccepts(name: string): boolean {
  return (
    !REFUSED_CHARACTER.test(name) &&
    Buffer.byteLength(name, 'utf8') <= MAX_MEDIA_NAME_BYTES
  );
}

describe('media names written to deck_info.json', () => {
  it('carries the AI path upload names, refused characters and all, to the deck writer', () => {
    const dir = workspaceWithImages();
    const exporter = new CustomExporter('Lecture', dir);

    exporter.configure(aiDecks() as unknown as Deck[]);

    const written = JSON.parse(
      fs.readFileSync(exporter.deckInfoPath(), 'utf8')
    ) as Array<{ cards: Array<{ media: Array<{ name: string }> }> }>;
    const names = written[0].cards.flatMap((card) =>
      card.media.map((entry) => entry.name)
    );
    expect(names).toEqual([
      'Lecture notes 3f2a9c1b_image[1].png',
      'Lecture notes 3f2a9c1b_time 10:15.png',
      'Lecture notes 3f2a9c1b_why?.png',
      `${LONG_FOLDER}_photo.png`,
    ]);
    expect(names.filter(isNameAnkiAccepts)).toEqual([]);
  });

  it('gives an uploaded export image a content-hash name on the parser path, whatever the user named it', async () => {
    const images = ['image[1].png', 'why?.png', `${'x'.repeat(130)}.png`];
    const toggles = images
      .map(
        (image, index) =>
          `<ul class="toggle"><li><details open=""><summary>Question ${index}</summary><p><img src="${encodeURI(image)}"></p></details></li></ul>`
      )
      .join('');
    const html = `<html><head><title>Images</title></head><body><article class="page sans"><header><h1 class="page-title">Images</h1></header><div class="page-body">${toggles}</div></article></body></html>`;
    const workspace = new Workspace(true, 'fs');
    const parser = new DeckParser({
      name: 'Images.html',
      settings: new CardOption({ cherry: 'false' }),
      files: [
        { name: 'Images.html', contents: html },
        ...images.map((image, index) => ({
          name: image,
          contents: Buffer.from(`bytes-${index}`),
        })),
      ],
      noLimits: true,
      workspace,
    });

    await parser.build(workspace);

    const media = parser.payload[0].cards.flatMap((card) => card.media);
    expect(media).toHaveLength(3);
    for (const name of media) {
      expect(name).toMatch(/^[0-9a-f]{100}\.png$/);
    }
  });
});

const describeWithPython = process.env.SKIP_CREATE_DECK
  ? describe.skip
  : describe;

describeWithPython('the packaged deck', () => {
  it('ships every AI path image under a name Anki accepts, and each card shows its own picture', async () => {
    const dir = workspaceWithImages();
    const exporter = new CustomExporter('Lecture', dir);
    exporter.configure(aiDecks() as unknown as Deck[]);

    const parsed = await parseApkgNotes(await exporter.save());

    const mediaByName = new Map(
      parsed.sourceMedia.map((file) => [file.filename, file.bytes.toString()])
    );
    expect([...mediaByName.keys()].filter(isNameAnkiAccepts)).toHaveLength(4);
    const shown = parsed.notes
      .sort((a, b) => a.fields[0].localeCompare(b.fields[0]))
      .map((note) => {
        const src = /<img src="([^"]+)">/.exec(note.fields[1])?.[1] ?? '';
        return mediaByName.get(src.replaceAll('&amp;', '&'));
      });
    expect(shown).toEqual(['image-0', 'image-1', 'image-2', 'image-3']);
  });
});
