import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

async function cardsFor(html: string) {
  const name = 'export.html';
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name,
    settings: new CardOption({ cherry: 'false' }),
    files: [{ name, contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);
  return parser.payload.flatMap((d) => d.cards);
}

const wrap = (body: string) =>
  `<html><head><title>Geography</title></head><body><article class="page sans"><header><h1 class="page-title">Geography</h1></header><div class="page-body">${body}</div></article></body></html>`;

const importedToggle = (question: string, answer: string) =>
  `<details class="toggle" open=""><summary><mark class="highlight-default" data-notion-highlight="default">${question}</mark></summary><div class="indented"><p><mark class="highlight-default" data-notion-highlight="default">${answer}</mark></p></div></details>`;

describe('Notion text with a default highlight', () => {
  it('produces a card with no mark, so the export colour cannot hide the text in dark mode', async () => {
    const cards = await cardsFor(
      wrap(importedToggle('What is the capital of Albania?', 'Tirana'))
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].name).not.toContain('<mark');
    expect(cards[0].back).not.toContain('<mark');
    expect(cards[0].name).toContain('What is the capital of Albania?');
    expect(cards[0].back).toContain('Tirana');
  });

  it('produces a card with no mark from the 2024 display:contents export shape', async () => {
    const cards = await cardsFor(
      wrap(
        `<div style="display:contents"><ul class="toggle"><li><details open=""><summary><mark class="highlight-default" data-notion-highlight="default">What is the capital of Albania?</mark></summary><div style="display:contents"><p><mark class="highlight-default" data-notion-highlight="default">Tirana</mark></p></div></details></li></ul></div>`
      )
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].name).not.toContain('<mark');
    expect(cards[0].back).not.toContain('<mark');
    expect(cards[0].back).toContain('Tirana');
  });

  it('keeps a real colour highlight on the card', async () => {
    const cards = await cardsFor(
      wrap(
        `<details class="toggle" open=""><summary>What is the capital of Albania?</summary><div class="indented"><p><mark class="highlight-yellow_background">Tirana</mark></p></div></details>`
      )
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].back).toContain('highlight-yellow_background');
  });
});
