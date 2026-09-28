import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

async function cardsFor(
  html: string,
  options: Record<string, string>,
  name = 'toggle.html'
) {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name,
    settings: new CardOption({ cherry: 'false', ...options }),
    files: [{ name, contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);
  return parser.payload.flatMap((d) => d.cards);
}

const wrap = (body: string) =>
  `<html><head><title>Toggles</title></head><body><article class="page sans"><header><h1 class="page-title">Toggles</h1></header><div class="page-body">${body}</div></article></body></html>`;

const PARENT_ID = '3e432d87-07b3-8057-a7da-fbaad7e41f5f';
const PLAIN_CHILD_ID = '3e432d87-07b3-8042-9f42-e3e4a3466599';
const CLOZE_CHILD_ID = '3e432d87-07b3-8060-b6ff-dd95e045263f';

const details2026 = (id: string, summary: string, body: string) =>
  `<details id="${id}" open="" class="toggle" dir="auto"><summary>${summary}</summary><div class="indented">${body}</div></details>`;

const page2026 = wrap(
  details2026(
    PARENT_ID,
    'Management of ARLD',
    details2026(
      PLAIN_CHILD_ID,
      'Complete abstinence: the most important step.',
      ''
    ) +
      details2026(
        CLOZE_CHILD_ID,
        'To manage acute alcohol withdrawal use <code>Benzodiazepines</code>',
        '<p>Chlordiazepoxide is the usual choice.</p>'
      )
  )
);

const detailsLegacy = (id: string, summary: string, body: string) =>
  `<div style="display:contents"><ul class="toggle" id="${id}"><li><details open=""><summary>${summary}</summary><div style="display:contents">${body}</div></details></li></ul></div>`;

const pageLegacy = wrap(
  detailsLegacy(
    PARENT_ID,
    'Management of ARLD',
    detailsLegacy(
      PLAIN_CHILD_ID,
      'Complete abstinence: the most important step.',
      ''
    ) +
      detailsLegacy(
        CLOZE_CHILD_ID,
        'To manage acute alcohol withdrawal use <code>Benzodiazepines</code>',
        '<p>Chlordiazepoxide is the usual choice.</p>'
      )
  )
);

const ON = { 'promote-nested-cloze': 'true' };

describe('promote-nested-cloze card option', () => {
  it('is off by default: the nested cloze stays a code box inside the parent back', async () => {
    const cards = await cardsFor(page2026, {});
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toContain('Management of ARLD');
    expect(cards[0].back).toContain('<code>Benzodiazepines</code>');
  });

  it.each([
    ['2026 details.toggle', page2026],
    ['legacy display:contents', pageLegacy],
  ])(
    'promotes a nested toggle with inline code to its own cloze card (%s)',
    async (_label, page) => {
      const cards = await cardsFor(page, ON);
      expect(cards).toHaveLength(2);

      const [parent, promoted] = cards;
      expect(parent.name).toContain('Management of ARLD');
      expect(parent.back).toContain('Complete abstinence');
      expect(parent.back).toContain('<b>Benzodiazepines</b>');
      expect(parent.back).not.toContain('<code>');

      expect(promoted.name).toContain('{{c1::Benzodiazepines}}');
      expect(promoted.back).toContain('Chlordiazepoxide is the usual choice.');
      expect(promoted.notionId).toBe(CLOZE_CHILD_ID);
    }
  );

  it('keeps the child block id as card identity when one toggle per card is on', async () => {
    const cards = await cardsFor(page2026, {
      ...ON,
      'max-one-toggle-per-card': 'true',
    });
    expect(cards).toHaveLength(2);
    expect(cards[1].name).toContain('{{c1::Benzodiazepines}}');
    expect(cards[1].notionId).toBe(CLOZE_CHILD_ID);
    expect(cards[0].back).toContain('<b>Benzodiazepines</b>');
    expect(cards[0].back).not.toContain('<code>');
  });

  it('does nothing when cloze deletion is off', async () => {
    const cards = await cardsFor(page2026, { ...ON, cloze: 'false' });
    expect(cards).toHaveLength(1);
    expect(cards[0].back).toContain('<code>Benzodiazepines</code>');
  });

  it('leaves nested toggles without inline code folded into the parent', async () => {
    const page = wrap(
      details2026(
        PARENT_ID,
        'Parent question?',
        details2026(PLAIN_CHILD_ID, 'Child fact one', '') +
          details2026(CLOZE_CHILD_ID, 'Child fact two', '')
      )
    );
    const cards = await cardsFor(page, ON);
    expect(cards).toHaveLength(1);
    expect(cards[0].back).toContain('Child fact one');
    expect(cards[0].back).toContain('Child fact two');
  });

  it('does not double-emit under cherry-pick, which already reaches nested toggles', async () => {
    const page = wrap(
      details2026(
        PARENT_ID,
        'Management of ARLD',
        details2026(
          CLOZE_CHILD_ID,
          '🍒 To manage acute alcohol withdrawal use <code>Benzodiazepines</code>',
          ''
        )
      )
    );
    const withCherry = await cardsFor(page, { cherry: 'true' });
    const withBoth = await cardsFor(page, { ...ON, cherry: 'true' });
    expect(withBoth).toHaveLength(withCherry.length);
  });
});
