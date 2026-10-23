import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

async function cardsFor(html: string, options: Record<string, string>) {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'toggle.html',
    settings: new CardOption({ cherry: 'false', ...options }),
    files: [{ name: 'toggle.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);
  return parser.payload.flatMap((d) => d.cards);
}

const details = (id: string, summary: string, body: string) =>
  `<details id="${id}" open="" class="toggle" dir="auto"><summary>${summary}</summary><div class="indented">${body}</div></details>`;

const page = (body: string) =>
  `<html><head><title>T</title></head><body><article class="page sans"><header><h1 class="page-title">T</h1></header><div class="page-body">${body}</div></article></body></html>`;

const ID = (n: number) =>
  `3e432d87-07b3-8057-a7da-${String(n).padStart(12, '0')}`;

const threeLevels = page(
  details(
    ID(1),
    'Heart',
    '<p>Pumps blood.</p>' +
      details(
        ID(2),
        'Chambers',
        '<p>Four chambers.</p>' +
          details(ID(3), 'Left ventricle', '<p>Pumps to the body.</p>')
      ) +
      details(ID(4), 'Empty child', '')
  )
);

describe('promote-nested-toggles card option', () => {
  it('is off by default: one card, nested toggles stay inside it', async () => {
    const cards = await cardsFor(threeLevels, {});
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toContain('Heart');
  });

  it('makes a card per nested toggle with something inside, title as the front', async () => {
    const cards = await cardsFor(threeLevels, {
      'promote-nested-toggles': 'true',
    });
    const fronts = cards.map((card) => card.name);
    expect(cards).toHaveLength(3);
    expect(fronts[0]).toContain('Heart');
    expect(fronts.some((front) => front.includes('Chambers'))).toBe(true);
    expect(fronts.some((front) => front.includes('Left ventricle'))).toBe(true);
    expect(fronts.some((front) => front.includes('Empty child'))).toBe(false);
  });

  it('works with one toggle per card on, which is the default for most people', async () => {
    const cards = await cardsFor(threeLevels, {
      'promote-nested-toggles': 'true',
      'max-one-toggle-per-card': 'true',
    });
    expect(cards).toHaveLength(3);
  });

  it('puts the nested toggle body on the back of its own card', async () => {
    const cards = await cardsFor(threeLevels, {
      'promote-nested-toggles': 'true',
    });
    const ventricle = cards.find((card) =>
      card.name.includes('Left ventricle')
    );
    expect(ventricle?.back).toContain('Pumps to the body.');
    expect(ventricle?.notionId).toBe(ID(3));
  });

  it('does not double a nested toggle the cloze option already promotes', async () => {
    const page2 = page(
      details(
        ID(1),
        'Management',
        details(
          ID(2),
          'Use <code>Benzodiazepines</code>',
          '<p>Chlordiazepoxide.</p>'
        )
      )
    );
    const cards = await cardsFor(page2, {
      'promote-nested-toggles': 'true',
      'promote-nested-cloze': 'true',
      cloze: 'true',
    });
    expect(cards).toHaveLength(2);
  });
});
