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
    const shapes = {
      'bare details export': pageOf(
        toggle(
          '🍒 Heart',
          '<p>Pumps blood.</p>' +
            toggle('Atrium', '<p>Receives blood.</p>') +
            toggle('Ventricle', '<p>Pumps blood out.</p>')
        )
      ),
      'ul.toggle export': pageOf(
        wrapped(
          '🍒 Heart',
          '<p>Pumps blood.</p>' +
            wrapped('Atrium', '<p>Receives blood.</p>') +
            wrapped('Ventricle', '<p>Pumps blood out.</p>')
        )
      ),
    };

    it.each(
      Object.entries(shapes).flatMap(([shape, html]) =>
        ['true', 'false'].map((maxOne) => ({ shape, html, maxOne }))
      )
    )(
      'counts only the ones its card leaves out ($shape, max-one $maxOne)',
      async ({ html, maxOne }) => {
        const [deck] = await parse(html, {
          cherry: 'true',
          'max-one-toggle-per-card': maxOne,
        });

        expect(deck.cards.map((card) => card.name)).toEqual([
          expect.stringContaining('Heart'),
        ]);
        const leftOut = ['Atrium', 'Ventricle'].filter(
          (title) => !deck.cards[0].back.includes(title)
        );
        expect(deck.cherrySkippedCount).toBe(leftOut.length);
      }
    );

    it('still counts nested toggles a one-toggle card leaves out', async () => {
      const [deck] = await parse(shapes['ul.toggle export'], {
        cherry: 'true',
        'max-one-toggle-per-card': 'true',
      });

      expect(deck.cards[0].back).not.toContain('Atrium');
      expect(deck.cherrySkippedCount).toBe(2);
    });

    it('does not count nested toggles a kept card shows on its back', async () => {
      const [deck] = await parse(shapes['ul.toggle export'], {
        cherry: 'true',
        'max-one-toggle-per-card': 'false',
      });

      expect(deck.cards[0].back).toContain('Atrium');
      expect(deck.cherrySkippedCount).toBe(0);
    });
  });

  it('stays at zero with Cherry-pick off', async () => {
    const [deck] = await parse(mixedPage, { cherry: 'false', avocado: 'true' });

    expect(deck.cards).toHaveLength(3);
    expect(deck.cherrySkippedCount).toBe(0);
  });
});
