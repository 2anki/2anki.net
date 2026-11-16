import path from 'path';
import fs from 'fs';

import { setupTests } from '../../test/configure-jest';
import { track } from '../../services/events/track';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

vi.mock('../../services/events/track', () => ({ track: vi.fn() }));

beforeEach(() => {
  setupTests();
  vi.mocked(track).mockClear();
});

const readFixture = (file: string) =>
  fs.readFileSync(path.join(__dirname, '../../test/fixtures', file)).toString();

const pageOf = (body: string) =>
  `<html><head><title>T</title></head><body><article class="page sans"><header><h1 class="page-title">T</h1></header><div class="page-body">${body}</div></article></body></html>`;

const build = async (
  file: string,
  contents: string,
  options: Record<string, string>
) => {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: file,
    settings: new CardOption(options),
    files: [{ name: file, contents }],
    noLimits: true,
    workspace,
  });
  await parser.writeDeckInfo(workspace);
  return parser.payload.flatMap((deck) => deck.cards);
};

const fronts = async (
  file: string,
  contents: string,
  options: Record<string, string>
) =>
  (await build(file, contents, options)).map((card) => ({
    name: card.name,
    back: card.back,
  }));

const nestedUnderBullet = readFixture('notion-toggle-under-bullet.html');

describe('a request that still carries the retired parent-context option', () => {
  it('gives a nested card under a bullet only its own front', async () => {
    const cards = await build('outline.html', nestedUnderBullet, {
      cloze: 'false',
      'parent-context': 'true',
    });

    expect(cards.map((card) => card.name)).toEqual([
      "<div class='bulleted-list'>ACS</div>",
      "<div class='toggle'>Hypertension</div>",
    ]);
  });

  it('converts a Notion export with nested cards exactly as without the key', async () => {
    const withKey = await fronts('outline.html', nestedUnderBullet, {
      'parent-context': 'true',
    });
    const withoutKey = await fronts('outline.html', nestedUnderBullet, {});

    expect(withKey).toEqual(withoutKey);
  });

  it('converts a Notion export with only top-level toggles exactly as without the key', async () => {
    const flat = pageOf(
      '<ul class="toggle"><li><details open=""><summary>Hypertension</summary><p>Raised pressure</p></details></li></ul>'
    );

    const withKey = await fronts('flat.html', flat, {
      'parent-context': 'true',
    });
    const withoutKey = await fronts('flat.html', flat, {});

    expect(withKey).toEqual(withoutKey);
    expect(withKey).toHaveLength(1);
  });

  it('builds a nested multiple-choice card exactly as without the key', async () => {
    const quiz = pageOf(
      '<ul class="bulleted-list"><li>Cell biology<ul class="toggle"><li><details open=""><summary>Which organelle makes ATP?</summary><ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> Mitochondrion</li><li><div class="checkbox checkbox-off"></div> Ribosome</li></ul></details></li></ul></li></ul>'
    );
    const options = { 'mcq-enabled': 'true', 'parent-context': 'true' };

    const withKey = await build('quiz.html', quiz, options);
    const withoutKey = await build('quiz.html', quiz, {
      'mcq-enabled': 'true',
    });

    expect(withKey.map((card) => card.mcq)).toEqual([true]);
    expect(withKey.map((card) => card.name)).toEqual(
      withoutKey.map((card) => card.name)
    );
  });

  it('keeps the cherry nested-toggle branch exactly as without the key', async () => {
    const sectionTags = readFixture('section-tags.html');

    const withKey = await fronts('section-tags.html', sectionTags, {
      cherry: 'true',
      'parent-context': 'true',
    });
    const withoutKey = await fronts('section-tags.html', sectionTags, {
      cherry: 'true',
    });

    expect(withKey).toEqual(withoutKey);
  });

  it('records no usage event', async () => {
    await build('outline.html', nestedUnderBullet, {
      cloze: 'false',
      'parent-context': 'true',
    });

    expect(vi.mocked(track)).not.toHaveBeenCalled();
  });
});
