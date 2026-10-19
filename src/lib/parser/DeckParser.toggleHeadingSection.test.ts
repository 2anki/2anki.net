import fs from 'fs';
import path from 'path';

import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

function parse(
  html: string,
  settings: CardOption,
  name = 'toggle-heading.html'
) {
  const workspace = new Workspace(true, 'fs');
  return new DeckParser({
    name,
    settings,
    files: [{ name, contents: html }],
    noLimits: true,
    workspace,
  });
}

function cardsFor(html: string, settings: CardOption, name?: string) {
  return parse(html, settings, name).payload[0].cards;
}

function loadFixture(fileName: string): string {
  return fs
    .readFileSync(path.join(__dirname, '../../test/fixtures', fileName))
    .toString();
}

const bothModes: CardOption[] = [
  new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' }),
  new CardOption({ 'max-one-toggle-per-card': 'false', cherry: 'false' }),
];

// Old Notion HTML export: ul.toggle wrappers + div.indented bodies.
const wrapPage = (inner: string) =>
  `<html><head><title>T</title></head><body><article class="page sans"><header><h1 class="page-title">T</h1></header><div class="page-body">${inner}</div></article></body></html>`;
const oldToggle = (q: string, a: string) =>
  `<ul class="toggle"><li><details open=""><summary>${q}</summary><div class="indented"><p>${a}</p></div></details></li></ul>`;
const oldHeading = (title: string, body: string) =>
  `<details open=""><summary style="font-weight:600;font-size:1.5em">${title}</summary><div class="indented">${body}</div></details>`;

// New Notion HTML export: display:contents wrappers.
const dc = (s: string) => `<div style="display:contents" dir="auto">${s}</div>`;
const newToggle = (q: string, a: string, id: string) =>
  dc(
    `<ul id="${id}" class="toggle"><li><details open=""><summary>${q}</summary>${dc(`<p>${a}</p>`)}</details></li></ul>`
  );
const newHeading = (title: string, body: string) =>
  dc(
    `<details open=""><summary style="font-weight:600;font-size:1.5em;line-height:1.3;margin:0">${title}</summary>${dc(body)}</details>`
  );

const SYNTHETIC_FRONTS = [
  'What does the left ventricle do?',
  'Where does the vena cava return blood?',
  'Which valve sits between the left atrium and ventricle?',
];

describe('Toggle heading wrapping toggles (section expansion)', () => {
  // Hand-written fixture in Notion's current display:contents export shape — no
  // real display:contents export of a toggle heading wrapping toggles was
  // available in the repo. The real-export coverage below uses the old-shape
  // file that ships in the repo.
  const synthetic = loadFixture('toggle-heading-with-toggles-synthetic.html');

  it('builds one card per nested toggle with maxOne on', () => {
    const cards = cardsFor(
      synthetic,
      new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' }),
      'toggle-heading-with-toggles-synthetic.html'
    );
    expect(cards.length).toBe(3);
    SYNTHETIC_FRONTS.forEach((front, index) => {
      expect(cards[index].name).toContain(front);
    });
    expect(cards[0].back).toContain('aorta');
    expect(cards[1].back).toContain('right atrium');
    expect(cards[2].back).toContain('mitral valve');
  });

  it('builds one card per nested toggle with maxOne off', () => {
    const cards = cardsFor(
      synthetic,
      new CardOption({ 'max-one-toggle-per-card': 'false', cherry: 'false' }),
      'toggle-heading-with-toggles-synthetic.html'
    );
    expect(cards.length).toBe(3);
    SYNTHETIC_FRONTS.forEach((front, index) => {
      expect(cards[index].name).toContain(front);
    });
  });

  it('keeps a real old-shape toggle-heading export with plain content as one card', () => {
    const cards = cardsFor(
      loadFixture('Toggle Hea 0e02b 2.html'),
      new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' }),
      'Toggle Hea 0e02b 2.html'
    );
    expect(cards.length).toBe(1);
    expect(cards[0].name).toContain('Front with heading 1');
    expect(cards[0].back).toContain('Back with heading 1');
  });

  it('keeps a toggle heading with plain content as a single card', () => {
    const html = wrapPage(
      oldHeading(
        'Overview of the cell',
        '<p>The cell is the basic unit of life.</p>'
      )
    );
    const cards = cardsFor(
      html,
      new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' })
    );
    expect(cards.length).toBe(1);
    expect(cards[0].name).toContain('Overview of the cell');
    expect(cards[0].back).toContain('basic unit of life');
  });

  it('keeps a nested toggle under a regular toggle folded into one card (#3515)', () => {
    const html = wrapPage(
      `<ul class="toggle"><li><details open=""><summary>Japanese greetings</summary><div class="indented">${oldToggle('Ohayou', 'Good morning.')}</div></details></li></ul>`
    );

    const folded = cardsFor(
      html,
      new CardOption({ 'max-one-toggle-per-card': 'false', cherry: 'false' })
    );
    expect(folded.length).toBe(1);
    expect(folded[0].name).toContain('Japanese greetings');
    expect(folded[0].back).toContain('Ohayou');

    const stripped = cardsFor(
      html,
      new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' })
    );
    expect(stripped.length).toBe(1);
    expect(stripped[0].name).toContain('Japanese greetings');
  });

  it('does not expand when non-toggle content sits beside the toggles', () => {
    const html = wrapPage(
      oldHeading(
        'The cardiovascular system',
        `<p>Read this introduction before the questions.</p>${oldToggle('What does the left ventricle do?', 'It pumps blood into the aorta.')}`
      )
    );
    const cards = cardsFor(
      html,
      new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' })
    );
    expect(cards.length).toBe(1);
    expect(cards[0].name).toContain('The cardiovascular system');
    expect(cards[0].back).toContain('Read this introduction');
  });

  it('does not expand when an hr sits beside the toggles', () => {
    const html = wrapPage(
      oldHeading(
        'Reference section',
        `<hr/>${oldToggle('Hidden question?', 'Hidden answer.')}`
      )
    );
    for (const settings of bothModes) {
      const cards = cardsFor(html, settings);
      expect(cards.length).toBe(1);
      expect(cards[0].name).toContain('Reference section');
      expect(cards[0].name).not.toContain('Hidden question?');
    }
  });

  it('expands a sub-heading that wraps toggles', () => {
    const html = wrapPage(
      oldHeading(
        'Chapter one',
        oldHeading(
          'Section A',
          oldToggle('First question?', 'First answer.') +
            oldToggle('Second question?', 'Second answer.')
        )
      )
    );
    const cards = cardsFor(
      html,
      new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' })
    );
    expect(cards.length).toBe(2);
    expect(cards[0].name).toContain('First question?');
    expect(cards[1].name).toContain('Second question?');
  });

  it('expands a toggle heading sitting next to a top-level toggle', () => {
    const html = wrapPage(
      oldHeading(
        'Chapter one',
        oldToggle('Inside A?', 'Answer A.') +
          oldToggle('Inside B?', 'Answer B.')
      ) + oldToggle('Standalone question?', 'Standalone answer.')
    );
    const cards = cardsFor(
      html,
      new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' })
    );
    expect(cards.length).toBe(3);
    const fronts = cards.map((card) => card.name).join(' ');
    expect(fronts).toContain('Inside A?');
    expect(fronts).toContain('Inside B?');
    expect(fronts).toContain('Standalone question?');
  });

  it('keeps the heading as one card when its summary carries a cherry marker', () => {
    const html = wrapPage(
      oldHeading(
        'Pinned section 🍒',
        oldToggle('Hidden question?', 'Hidden answer.')
      )
    );
    const cards = cardsFor(
      html,
      new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' })
    );
    expect(cards.length).toBe(1);
    expect(cards[0].name).toContain('Pinned section');
  });

  it('keeps the heading as one card when its summary carries a cloze marker', () => {
    const html = wrapPage(
      oldHeading(
        'The capital is <code>Canberra</code>',
        oldToggle('Nested question?', 'Nested answer.')
      )
    );
    const cards = cardsFor(
      html,
      new CardOption({
        'max-one-toggle-per-card': 'true',
        cherry: 'false',
        cloze: 'true',
      })
    );
    expect(cards.length).toBe(1);
    expect(cards[0].name).toContain('Canberra');
  });

  // #4877 B1: expanding one heading must never drop a different heading on the
  // same page. When any heading would bail, the whole page is left as-is, so a
  // mixed page (one expanding heading + one plain heading) keeps both heading
  // cards exactly as before this change — in both export shapes.
  it('does not expand a mixed page, keeping both heading cards (old shape)', () => {
    const html = wrapPage(
      oldHeading(
        'Chapter A',
        oldToggle('Ventricle question?', 'Answer A.') +
          oldToggle('Vena cava question?', 'Answer B.')
      ) + oldHeading('Plain section B', '<p>plain body text</p>')
    );
    for (const settings of bothModes) {
      const cards = cardsFor(html, settings);
      expect(cards.length).toBe(2);
      expect(cards[0].name).toContain('Chapter A');
      expect(cards[1].name).toContain('Plain section B');
      expect(cards.map((c) => c.name).join(' ')).not.toContain(
        'Ventricle question?'
      );
      expect(cards[1].back).toContain('plain body text');
    }
  });

  it('does not expand a mixed page, keeping both heading cards (new display:contents shape)', () => {
    const html = wrapPage(
      newHeading(
        'Chapter A',
        newToggle(
          'Ventricle question?',
          'Answer A.',
          '2ce7ab29-a11e-8001-0000-000000000001'
        ) +
          newToggle(
            'Vena cava question?',
            'Answer B.',
            '2ce7ab29-a11e-8001-0000-000000000002'
          )
      ) + newHeading('Plain section B', '<p class="">plain body text</p>')
    );
    for (const settings of bothModes) {
      const cards = cardsFor(html, settings);
      expect(cards.length).toBe(2);
      expect(cards[0].name).toContain('Chapter A');
      expect(cards[1].name).toContain('Plain section B');
      expect(cards.map((c) => c.name).join(' ')).not.toContain(
        'Ventricle question?'
      );
      expect(cards[1].back).toContain('plain body text');
    }
  });
});
