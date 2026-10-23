import Deck from '../../lib/parser/Deck';
import CardOption from '../../lib/parser/Settings';
import { guessMarkdownCards } from '../../lib/parser/guessMarkdownCards';
import get16DigitRandomId from '../../shared/helpers/get16DigitRandomId';
import { serializeCardsToMarkdown } from './serializeCardsToMarkdown';
import { SubdeckGroup } from './composeSubdecks';
import { buildDeckStyle } from '../../lib/parser/buildDeckStyle';

function buildDeck(group: SubdeckGroup): Deck {
  const markdown = serializeCardsToMarkdown(group.cards);
  const heuristic = guessMarkdownCards(markdown);
  const notes = heuristic?.notes ?? [];
  for (const note of notes) {
    note.media = [];
  }
  const settings = new CardOption({ deckName: group.deck });
  return new Deck(
    group.deck,
    notes,
    '',
    buildDeckStyle(settings),
    get16DigitRandomId(),
    settings
  );
}

export function buildSubdeckDecks(groups: SubdeckGroup[]): Deck[] {
  return groups.map(buildDeck);
}
