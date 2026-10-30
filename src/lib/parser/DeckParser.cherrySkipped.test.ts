import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

const toggle = (summary: string, body: string) =>
  `<details open="" class="toggle"><summary>${summary}</summary><div class="indented">${body}</div></details>`;

const pageOf = (body: string) =>
  `<html><head><title>T</title></head><body><article class="page sans"><header><h1 class="page-title">T</h1></header><div class="page-body">${body}</div></article></body></html>`;

const parse = async (html: string, options: Record<string, string>) => {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'cherry.html',
    settings: new CardOption(options),
    files: [{ name: 'cherry.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);
  return parser.payload;
};

const mixedPage = pageOf(
  toggle('🍒 Kept', '<p>Answer one.</p>') +
    toggle('Left out', '<p>Answer two.</p>') +
    toggle('🥑 Also left out', '<p>Answer three.</p>') +
    toggle('Another left out', '<p>Answer four.</p>')
);

describe('cherry-skipped toggle count (upload path)', () => {
  it('counts the toggles Cherry-pick left out of the deck', async () => {
    const [deck] = await parse(mixedPage, { cherry: 'true' });

    expect(deck.cards.map((card) => card.name)).toEqual([
      expect.stringContaining('Kept'),
    ]);
    expect(deck.cherrySkippedCount).toBe(3);
  });

  it('does not count toggles the avocado filter removed', async () => {
    const [deck] = await parse(mixedPage, { cherry: 'true', avocado: 'true' });

    expect(deck.cherrySkippedCount).toBe(2);
  });

  describe('nested toggles under a kept 🍒 toggle', () => {
    const wrapped = (summary: string, body: string) =>
      `<ul class="toggle"><li><details open=""><summary>${summary}</summary>${body}</details></li></ul>`;
    const bareShape = (parentBody: string, children: string[]) =>
      pageOf(
        toggle(
          '🍒 Heart',
          parentBody +
            children
              .map((title) => toggle(title, '<p>Child answer.</p>'))
              .join('')
        )
      );
    const wrappedShape = (parentBody: string, children: string[]) =>
      pageOf(
        wrapped(
          '🍒 Heart',
          parentBody +
            children
              .map((title) => wrapped(title, '<p>Child answer.</p>'))
              .join('')
        )
      );

    it.each([
      { shape: 'bare details', build: bareShape, maxOne: 'true', expected: 0 },
      { shape: 'bare details', build: bareShape, maxOne: 'false', expected: 0 },
      { shape: 'ul.toggle', build: wrappedShape, maxOne: 'true', expected: 2 },
      { shape: 'ul.toggle', build: wrappedShape, maxOne: 'false', expected: 0 },
    ])(
      'counts $expected left out ($shape export, max-one $maxOne)',
      async ({ build, maxOne, expected }) => {
        const [deck] = await parse(
          build('<p>Pumps blood.</p>', ['Atrium', 'Ventricle']),
          { cherry: 'true', 'max-one-toggle-per-card': maxOne }
        );

        expect(deck.cards.map((card) => card.name)).toEqual([
          expect.stringContaining('Heart'),
        ]);
        expect(deck.cherrySkippedCount).toBe(expected);
      }
    );

    it('still counts a dropped child whose title also appears in the parent text', async () => {
      const [deck] = await parse(
        wrappedShape('<p>Atrium contracts first.</p>', ['Atrium', 'p']),
        { cherry: 'true', 'max-one-toggle-per-card': 'true' }
      );

      expect(deck.cherrySkippedCount).toBe(2);
    });

    it('does not count a child shown on the kept back even when its title is reformatted', async () => {
      const [deck] = await parse(
        wrappedShape('<p>Pumps blood.</p>', ['Two\nlines', 'Ventricle']),
        {
          cherry: 'true',
          'max-one-toggle-per-card': 'false',
          'perserve-newlines': 'true',
        }
      );

      expect(deck.cards[0].back).toContain('Ventricle');
      expect(deck.cherrySkippedCount).toBe(0);
    });
  });

  it('stays at zero with Cherry-pick off', async () => {
    const [deck] = await parse(mixedPage, { cherry: 'false', avocado: 'true' });

    expect(deck.cards).toHaveLength(3);
    expect(deck.cherrySkippedCount).toBe(0);
  });
});
