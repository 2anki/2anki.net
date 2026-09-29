import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

async function cardsFor(html: string, options: Record<string, string>) {
  const name = 'plain.html';
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
  `<html><head><title>Plain</title></head><body><article class="page sans"><header><h1 class="page-title">Plain</h1></header><div class="page-body">${body}</div></article></body></html>`;

const nestedToggle = (summary: string) =>
  `<details class="toggle" open=""><summary>${summary}</summary><div class="indented"></div></details>`;

// The shape a real 2026 Notion export had when a user turned the option on:
// the question is a toggle and each answer line is a nested toggle.
const answersAsNestedToggles = wrap(
  `<details class="toggle" open=""><summary>The units for Cost-Minimisation (CMA) are </summary><div class="indented">${nestedToggle(
    'Cost is <strong>monetary</strong> (£)'
  )}${nestedToggle('Consequences is assumed equivalent (ignored)')}</div></details>`
);

describe('Use plain text for back (paragraph option)', () => {
  it('keeps the answer text when the answers are nested toggles', async () => {
    const cards = await cardsFor(answersAsNestedToggles, { paragraph: 'true' });

    expect(cards).toHaveLength(1);
    expect(cards[0].back).toContain('Cost is monetary (£)');
    expect(cards[0].back).toContain(
      'Consequences is assumed equivalent (ignored)'
    );
  });

  it('strips the formatting but keeps each answer line apart', async () => {
    const cards = await cardsFor(answersAsNestedToggles, { paragraph: 'true' });

    expect(cards[0].back).not.toContain('<strong>');
    expect(cards[0].back).not.toContain('<details');
    expect(cards[0].back).toBe(
      'Cost is monetary (£)<br>Consequences is assumed equivalent (ignored)'
    );
  });

  it('keeps plain paragraphs under the toggle, as before', async () => {
    const cards = await cardsFor(
      wrap(
        `<details class="toggle" open=""><summary>Capital of Albania?</summary><div class="indented"><p>Tirana, <em>since 1920</em>.</p><p>On the Ishëm.</p></div></details>`
      ),
      { paragraph: 'true' }
    );

    expect(cards[0].back).toBe('Tirana, since 1920.<br>On the Ishëm.');
  });

  it('leaves the back untouched when the option is off', async () => {
    const cards = await cardsFor(answersAsNestedToggles, {});

    expect(cards[0].back).toContain('<strong>monetary</strong>');
  });
});
