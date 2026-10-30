import path from 'path';
import fs from 'fs';

import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Note from './Note';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

const fixture = fs
  .readFileSync(path.join(__dirname, '../../test/fixtures/section-tags.html'))
  .toString();

const buildCards = async (options: { [key: string]: string }) => {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'section-tags.html',
    settings: new CardOption(options),
    files: [{ name: 'section-tags.html', contents: fixture }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);
  return parser.payload[0].cards;
};

const findCard = (cards: Note[], needle: string) =>
  cards.find((c) => c.name.includes(needle));

describe('section-scoped tags (upload path)', () => {
  it('tags each card with its enclosing parent toggle marker in cherry mode', async () => {
    const cards = await buildCards({ cherry: 'true', 'section-tags': 'true' });

    const apple = findCard(cards, 'apple');
    const car = findCard(cards, 'car');

    expect(apple?.tags).toEqual(
      expect.arrayContaining(['chapter-1', 'global-tag'])
    );
    expect(apple?.tags).not.toContain('chapter-2');

    expect(car?.tags).toEqual(
      expect.arrayContaining(['chapter-2', 'global-tag'])
    );
    expect(car?.tags).not.toContain('chapter-1');
  });

  it('compounds nested section markers onto a deeply nested card', async () => {
    const cards = await buildCards({ cherry: 'true', 'section-tags': 'true' });

    const banana = findCard(cards, 'banana');

    expect(banana?.tags).toEqual(
      expect.arrayContaining(['chapter-1', 'section-A', 'global-tag'])
    );
    expect(banana?.tags).not.toContain('chapter-2');
  });

  it('strips the marker so it never becomes its own card and leaves no markup', async () => {
    const cards = await buildCards({ cherry: 'true', 'section-tags': 'true' });

    expect(findCard(cards, 'chapter-1')).toBeUndefined();
    expect(findCard(cards, 'chapter-2')).toBeUndefined();
    for (const card of cards) {
      expect(card.back).not.toContain('chapter-1');
      expect(card.back).not.toContain('chapter-2');
      expect(card.back).not.toContain('section-A');
    }
  });

  it('dedupes tags that already exist per-card or globally', async () => {
    const cards = await buildCards({ cherry: 'true', 'section-tags': 'true' });
    const apple = findCard(cards, 'apple');
    const chapterOneCount = apple?.tags.filter((t) => t === 'chapter-1').length;
    expect(chapterOneCount).toBe(1);
  });

  it('produces byte-identical card output when the option is off', async () => {
    const off = await buildCards({ cherry: 'true', 'section-tags': 'false' });
    const baseline = await buildCards({ cherry: 'true' });

    expect(
      off.map((c) => ({ name: c.name, back: c.back, tags: c.tags }))
    ).toEqual(
      baseline.map((c) => ({ name: c.name, back: c.back, tags: c.tags }))
    );
  });

  it('off-mode cards do not carry the section markers as tags', async () => {
    const off = await buildCards({ cherry: 'true', 'section-tags': 'false' });
    const apple = findCard(off, 'apple');

    expect(apple?.tags).not.toContain('chapter-1');
    expect(apple?.tags).not.toContain('section-A');
    expect(apple?.tags).toContain('global-tag');
  });
});

const nestedOptions = {
  cherry: 'false',
  'promote-nested-toggles': 'true',
};

const toggle = (summary: string, body: string) =>
  `<details open="" class="toggle"><summary>${summary}</summary><div class="indented">${body}</div></details>`;

const pageOf = (body: string) =>
  `<html><head><title>T</title></head><body><article class="page sans"><header><h1 class="page-title">T</h1></header><div class="page-body">${body}</div></article></body></html>`;

const cardsFromHtml = async (
  html: string,
  options: { [key: string]: string }
) => {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'nested.html',
    settings: new CardOption(options),
    files: [{ name: 'nested.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);
  return parser.payload.flatMap((deck) => deck.cards);
};

describe('section-scoped tags with nested toggles and Cherry-pick off', () => {
  it('tags each nested card with its parent toggle marker', async () => {
    const cards = await buildCards({
      ...nestedOptions,
      'section-tags': 'true',
    });

    const apple = findCard(cards, 'apple');
    const car = findCard(cards, 'car');

    expect(apple?.tags).toEqual(
      expect.arrayContaining(['chapter-1', 'global-tag'])
    );
    expect(apple?.tags).not.toContain('chapter-2');
    expect(apple?.tags).not.toContain('section-A');
    expect(car?.tags).toEqual(
      expect.arrayContaining(['chapter-2', 'global-tag'])
    );
    expect(car?.tags).not.toContain('chapter-1');
  });

  it('compounds every enclosing toggle marker onto a deeply nested card', async () => {
    const cards = await buildCards({
      ...nestedOptions,
      'section-tags': 'true',
    });

    const banana = findCard(cards, 'banana');

    expect(banana?.tags).toEqual(
      expect.arrayContaining(['chapter-1', 'section-A', 'global-tag'])
    );
    expect(banana?.tags).not.toContain('chapter-2');
  });

  it('keeps the parent toggle card and its own strikethrough tag', async () => {
    const cards = await buildCards({
      ...nestedOptions,
      'section-tags': 'true',
    });

    const chapterOne = findCard(cards, 'Chapter 1');

    expect(chapterOne?.tags).toEqual(
      expect.arrayContaining(['chapter-1', 'global-tag'])
    );
    expect(chapterOne?.back).not.toContain('<del>');
  });

  it('keeps a nested card strikethrough tag on that card only', async () => {
    const html = pageOf(
      toggle(
        'Heart',
        '<p><del>cardiology</del></p><p>Pumps blood.</p>' +
          toggle('Atrium', '<p><del>upper</del></p><p>Receives blood.</p>') +
          toggle('Ventricle', '<p>Pumps blood out.</p>')
      )
    );

    const cards = await cardsFromHtml(html, {
      ...nestedOptions,
      'section-tags': 'true',
    });

    const atrium = findCard(cards, 'Atrium');
    const ventricle = findCard(cards, 'Ventricle');

    expect(atrium?.tags).toEqual(
      expect.arrayContaining(['cardiology', 'upper'])
    );
    expect(ventricle?.tags).toContain('cardiology');
    expect(ventricle?.tags).not.toContain('upper');
  });

  it('leaves nested cards untagged by their parent when the option is off', async () => {
    const cards = await buildCards({
      ...nestedOptions,
      'section-tags': 'false',
    });

    const apple = findCard(cards, 'apple');

    expect(apple?.tags).not.toContain('chapter-1');
    expect(apple?.tags).toContain('global-tag');
  });

  it('tags a nested cloze card with its parent toggle marker', async () => {
    const html = pageOf(
      toggle(
        'Capitals',
        '<p><del>geography</del></p><p>European capitals.</p>' +
          toggle(
            'Capital of Sweden is <code>Stockholm</code>',
            '<p>On the east coast.</p>'
          )
      )
    );

    const cards = await cardsFromHtml(html, {
      ...nestedOptions,
      cloze: 'true',
      'promote-nested-cloze': 'true',
      'section-tags': 'true',
    });

    const sweden = findCard(cards, 'Sweden');

    expect(sweden?.name).toContain('{{c1::Stockholm}}');
    expect(sweden?.tags).toContain('geography');
  });

  it('ignores the option when nested toggles are off too', async () => {
    const on = await buildCards({ cherry: 'false', 'section-tags': 'true' });
    const off = await buildCards({ cherry: 'false', 'section-tags': 'false' });

    expect(
      on.map((c) => ({ name: c.name, back: c.back, tags: c.tags }))
    ).toEqual(off.map((c) => ({ name: c.name, back: c.back, tags: c.tags })));
  });
});
