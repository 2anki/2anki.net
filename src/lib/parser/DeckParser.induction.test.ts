import fs from 'fs';
import path from 'path';
import { DeckParser } from './DeckParser';
import CardOption from './Settings';
import Workspace from './WorkSpace';
import Deck from './Deck';
import { setupTests } from '../../test/configure-jest';

beforeEach(() => setupTests());

// Exercises the upload-path empty-deck rescue through the constructor, which
// runs processFirstFile -> handleHTML without spawning Python (no build()), so
// these run in a worktree that has no create_deck venv.

const HEADING_SECTIONS = `
  <h2>What is osmosis?</h2><p>Water crossing a membrane.</p>
  <h2>What is diffusion?</h2><p>Particles spreading out over time.</p>
  <h2>What is mitosis?</h2><p>Cell division into two identical cells.</p>
`;

// A toggle with a summary but no body renders one card with an empty back —
// the exact "present but unusable" shape Deck.CleanCards later strips.
const EMPTY_TOGGLE =
  '<ul class="toggle"><li><details open=""><summary>An empty toggle</summary></details></li></ul>';

function page(inner: string): string {
  return `<html><head><title>Notes</title></head><body><article class="page sans"><header><h1 class="page-title">Notes</h1></header><div class="page-body">${inner}</div></article></body></html>`;
}

function parse(html: string, settings: CardOption): DeckParser {
  return new DeckParser({
    name: 'notes.html',
    settings,
    files: [{ name: 'notes.html', contents: html }],
    noLimits: true,
    workspace: new Workspace(true, 'fs'),
  });
}

describe('DeckParser upload rescue gating', () => {
  it('rescues when the parse produced only cards CleanCards would strip', () => {
    const parser = parse(
      page(`${EMPTY_TOGGLE}${HEADING_SECTIONS}`),
      new CardOption({ cherry: 'false' })
    );

    const cards = parser.payload[0].cards;
    expect(Deck.CleanCards(cards).length).toBeGreaterThanOrEqual(3);
    const fronts = cards.map((card) => card.name).join(' ');
    expect(fronts).toContain('osmosis');
    expect(parser.inducedRule).toMatchObject({
      rule: 'heading',
      outcome: 'rescue_shipped',
    });
  });

  it('does not induce when the parse already produced usable cards', () => {
    const usableToggle =
      '<ul class="toggle"><li><details open=""><summary>What is a cell?</summary><div class="indented">The basic unit of life.</div></details></li></ul>';
    const parser = parse(
      page(`${usableToggle}${HEADING_SECTIONS}`),
      new CardOption({ cherry: 'false' })
    );

    expect(parser.inducedRule).toBeUndefined();
  });

  it('never induces on a cloze-only page (raw-stage cloze notes are usable)', () => {
    const clozeToggle = (summary: string) =>
      `<ul class="toggle"><li><details open=""><summary>${summary}</summary></details></li></ul>`;
    const parser = parse(
      page(
        [
          clozeToggle(
            '<code>{{c2::Canberra}}</code> was founded in <code>{{c1::1913}}</code>.'
          ),
          clozeToggle(
            '<code>{{c1::Canberra::city}}</code> was founded in <code>{{c2::1913::year}}</code>'
          ),
          clozeToggle(
            '<code>{{c1::Canberra::city}}</code> was founded in <code>{{c2::1913}}</code>'
          ),
          clozeToggle('<code>This</code> is a <code>cloze deletion</code>'),
        ].join('')
      ),
      new CardOption({
        cherry: 'false',
        reversed: 'true',
        'basic-reversed': 'true',
      })
    );

    expect(parser.inducedRule).toBeUndefined();
    const cards = parser.payload[0].cards;
    expect(cards).toHaveLength(4);
    expect(cards.filter((card) => card.name.includes('{{c'))).toHaveLength(3);
    expect(cards.some((card) => card.name.includes('</summary>'))).toBe(false);
  });

  it('does not induce on the real Some Cloze Deletions fixture (CI regression)', () => {
    const contents = fs.readFileSync(
      path.join(
        __dirname,
        '../../test/fixtures/Some Cloze Deletions 1a118169ada841a99a9aaccc7eaa6775.html'
      ),
      'utf8'
    );
    const parser = new DeckParser({
      name: 'Some Cloze Deletions 1a118169ada841a99a9aaccc7eaa6775.html',
      settings: new CardOption({
        cherry: 'false',
        reversed: 'true',
        'basic-reversed': 'true',
      }),
      files: [
        {
          name: 'Some Cloze Deletions 1a118169ada841a99a9aaccc7eaa6775.html',
          contents,
        },
      ],
      noLimits: true,
      workspace: new Workspace(true, 'fs'),
    });

    expect(parser.inducedRule).toBeUndefined();
    expect(parser.payload[0].cards).toHaveLength(4);
    expect(
      parser.payload[0].cards.some((card) => card.name.includes('</summary>'))
    ).toBe(false);
  });

  it('skips induction when the conversion is cherry-restricted', () => {
    const parser = parse(
      page(`${EMPTY_TOGGLE}${HEADING_SECTIONS}`),
      new CardOption({ cherry: 'true' })
    );

    expect(parser.inducedRule).toBeUndefined();
    const fronts = parser.payload[0].cards.map((card) => card.name).join(' ');
    expect(fronts).not.toContain('osmosis');
  });
});

// mammoth converts a Word "Heading" style to an <h1>, which preprocessDocxHTML
// turns into a toggle. But many study docs mark sections with a fully bold
// paragraph instead, and mammoth emits those verbatim as <p><strong>…</strong>.
// That HTML reaches DeckParser unchanged, matches no toggle/list/table, and with
// cloze OFF the front-only paragraph notes are all filtered — an empty deck.
function docxBoldSections(count: number): string {
  const filler =
    'The cell membrane regulates transport of molecules and maintains homeostasis across the boundary of every living cell. '.repeat(
      3
    );
  return Array.from(
    { length: count },
    (_, i) =>
      `<p><strong>Section ${i + 1}: Cellular biology topic ${i + 1}</strong></p><p>Answer ${i + 1}. ${filler}</p><p>Further detail ${i + 1}. ${filler}</p>`
  ).join('');
}

describe('DeckParser docx bold-heading prose rescue', () => {
  it('produces cards from bold-pseudo-heading prose with cloze off', () => {
    const parser = parse(
      docxBoldSections(6),
      new CardOption({
        cherry: 'false',
        cloze: 'false',
      })
    );

    const cards = parser.payload[0].cards;
    expect(Deck.CleanCards([...cards]).length).toBeGreaterThanOrEqual(3);
    const fronts = cards.map((card) => card.name).join(' ');
    expect(fronts).toContain('Cellular biology topic 1');
    const backs = cards.map((card) => card.back).join(' ');
    expect(backs).toContain('homeostasis');
    expect(parser.inducedRule).toMatchObject({
      rule: 'heading',
      outcome: 'rescue_shipped',
    });
  });

  it('rescues the same prose to cards whether cloze is on or off', () => {
    const clozeOff = parse(
      docxBoldSections(6),
      new CardOption({
        cherry: 'false',
        cloze: 'false',
      })
    );
    const clozeOn = parse(
      docxBoldSections(6),
      new CardOption({
        cherry: 'false',
        cloze: 'true',
      })
    );

    expect(
      Deck.CleanCards([...clozeOn.payload[0].cards]).length
    ).toBeGreaterThanOrEqual(3);
    expect(clozeOn.inducedRule).toMatchObject({
      rule: 'heading',
      outcome: 'rescue_shipped',
    });
    expect(Deck.CleanCards([...clozeOff.payload[0].cards]).length).toBe(
      Deck.CleanCards([...clozeOn.payload[0].cards]).length
    );
  });
});

const USABLE_TOGGLE = (n: number) =>
  `<ul class="toggle"><li><details open=""><summary>Toggle question ${n}?</summary><div class="indented">Toggle answer ${n}.</div></details></li></ul>`;

function bigHeadingSections(count: number): string {
  const filler =
    'The cell membrane regulates transport of molecules and maintains homeostasis across the boundary of every living cell in the organism. '.repeat(
      4
    );
  return Array.from(
    { length: count },
    (_, i) =>
      `<h2>Section question ${i + 1}?</h2><p>Section answer ${i + 1}. ${filler}</p>`
  ).join('');
}

describe('DeckParser degenerate-yield rescue', () => {
  it('re-derives the deck when 2 cards ship from a large document', () => {
    const parser = parse(
      page(`${USABLE_TOGGLE(1)}${USABLE_TOGGLE(2)}${bigHeadingSections(40)}`),
      new CardOption({ cherry: 'false' })
    );

    const cards = parser.payload[0].cards;
    expect(cards.length).toBeGreaterThan(2);
    const fronts = cards.map((card) => card.name).join(' ');
    expect(fronts).toContain('Section question 1?');
    expect(parser.inducedRule).toMatchObject({
      rule: 'heading',
      outcome: 'rescue_shipped',
    });
  });

  it('leaves a small document with 2 usable cards alone', () => {
    const parser = parse(
      page(`${USABLE_TOGGLE(1)}${USABLE_TOGGLE(2)}${bigHeadingSections(2)}`),
      new CardOption({ cherry: 'false' })
    );

    expect(parser.payload[0].cards).toHaveLength(2);
    expect(parser.inducedRule).toBeUndefined();
  });

  it('leaves a large document alone when it yields more than 2 usable cards', () => {
    const parser = parse(
      page(
        `${USABLE_TOGGLE(1)}${USABLE_TOGGLE(2)}${USABLE_TOGGLE(3)}${bigHeadingSections(40)}`
      ),
      new CardOption({ cherry: 'false' })
    );

    expect(parser.payload[0].cards).toHaveLength(3);
    expect(parser.inducedRule).toBeUndefined();
  });

  it('keeps the original cards when no candidate beats them', () => {
    const prose = `<p>${'Plain narrative prose without any structural boundaries or markers, continuing at length about the topic in flowing paragraphs. '.repeat(200)}</p>`;
    const parser = parse(
      page(`${USABLE_TOGGLE(1)}${USABLE_TOGGLE(2)}${prose}`),
      new CardOption({ cherry: 'false' })
    );

    expect(parser.payload[0].cards).toHaveLength(2);
    const fronts = parser.payload[0].cards.map((card) => card.name).join(' ');
    expect(fronts).toContain('Toggle question 1?');
  });
});
