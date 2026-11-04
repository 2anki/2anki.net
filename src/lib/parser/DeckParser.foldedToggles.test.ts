import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

const toggle = (summary: string, body: string) =>
  `<details open="" class="toggle"><summary>${summary}</summary><div class="indented">${body}</div></details>`;

const wrapped = (summary: string, body: string) =>
  `<ul class="toggle"><li><details open=""><summary>${summary}</summary>${body}</details></li></ul>`;

const pageOf = (body: string) =>
  `<html><head><title>T</title></head><body><article class="page sans"><header><h1 class="page-title">T</h1></header><div class="page-body">${body}</div></article></body></html>`;

const parse = async (html: string, options: Record<string, string>) => {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'sections.html',
    settings: new CardOption({ cherry: 'false', ...options }),
    files: [{ name: 'sections.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);
  return parser.payload;
};

const sectionsOf = (shape: typeof toggle) =>
  pageOf(
    shape(
      'Letters',
      toggle('What is shaddah?', '<p>Doubling.</p>') +
        toggle('What is hamzah?', '<p>A glottal stop.</p>') +
        toggle('Empty question', '')
    ) +
      shape(
        'Sun and moon',
        toggle('What are sun letters?', '<p>They take the lām.</p>')
      )
  );

describe('nested toggles folded into a card back (upload path)', () => {
  it.each([
    ['bare details', toggle, 'true'],
    ['bare details', toggle, 'false'],
    ['ul.toggle wrapped', wrapped, 'true'],
    ['ul.toggle wrapped', wrapped, 'false'],
  ])(
    'counts the nested toggles that would become cards (%s export, max-one %s)',
    async (_shape, shape, maxOne) => {
      const [deck] = await parse(sectionsOf(shape), {
        'max-one-toggle-per-card': maxOne,
      });

      expect(deck.cards).toHaveLength(2);
      expect(deck.foldedToggleCount).toBe(3);
    }
  );

  it.each(['true', 'false'])(
    'builds the same section cards it always did with the option off (max-one %s)',
    async (maxOne) => {
      const [deck] = await parse(sectionsOf(toggle), {
        'max-one-toggle-per-card': maxOne,
      });

      expect(deck.cards.map((card) => card.name)).toEqual([
        expect.stringContaining('Letters'),
        expect.stringContaining('Sun and moon'),
      ]);
      expect(
        deck.cards.some((card) => card.name.includes('What is shaddah?'))
      ).toBe(false);
    }
  );

  it('keeps the inner questions on the section back when max-one is off', async () => {
    const [deck] = await parse(sectionsOf(toggle), {
      'max-one-toggle-per-card': 'false',
    });

    expect(deck.cards[0].back).toContain('What is shaddah?');
    expect(deck.cards[0].back).toContain('Doubling.');
  });

  it('matches the cards the option adds when it is turned on', async () => {
    const [off] = await parse(sectionsOf(toggle), {});
    const [on] = await parse(sectionsOf(toggle), {
      'promote-nested-toggles': 'true',
    });

    expect(on.cards.length - off.cards.length).toBe(off.foldedToggleCount);
  });

  it('counts nothing once nested toggles are their own cards', async () => {
    const [deck] = await parse(sectionsOf(toggle), {
      'promote-nested-toggles': 'true',
    });

    expect(deck.foldedToggleCount).toBe(0);
  });

  it('counts nothing under Cherry-pick, which lists nested toggles itself', async () => {
    const [deck] = await parse(
      pageOf(toggle('🍒 Letters', toggle('🍒 What is shaddah?', '<p>D.</p>'))),
      { cherry: 'true' }
    );

    expect(deck.foldedToggleCount).toBe(0);
  });

  it('counts nothing on a page of flat toggles', async () => {
    const [deck] = await parse(
      pageOf(toggle('One', '<p>A.</p>') + toggle('Two', '<p>B.</p>')),
      {}
    );

    expect(deck.cards).toHaveLength(2);
    expect(deck.foldedToggleCount).toBe(0);
  });

  it.each([['notes.md', '- Letters\n  - What is shaddah?\n    - Doubling.\n']])(
    'counts nothing for %s, which never reaches the toggle parser',
    async (name, contents) => {
      const workspace = new Workspace(true, 'fs');
      const parser = new DeckParser({
        name,
        settings: new CardOption({ cherry: 'false' }),
        files: [{ name, contents }],
        noLimits: true,
        workspace,
      });
      await parser.build(workspace);

      expect(
        parser.payload.flatMap((deck) => deck.cards).length
      ).toBeGreaterThan(0);
      expect(
        parser.payload.reduce((sum, deck) => sum + deck.foldedToggleCount, 0)
      ).toBe(0);
    }
  );

  it('leaves out a nested cloze toggle the cloze option already promotes', async () => {
    const [deck] = await parse(
      pageOf(
        toggle(
          'Letters',
          toggle('<code>Shaddah</code> doubles a letter', '<p>x</p>') +
            toggle('What is hamzah?', '<p>A glottal stop.</p>')
        )
      ),
      { cloze: 'true', 'promote-nested-cloze': 'true' }
    );

    expect(deck.foldedToggleCount).toBe(1);
  });
});
