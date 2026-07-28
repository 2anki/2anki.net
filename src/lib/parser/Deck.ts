import Note from './Note';
import CardOption from './Settings';

export default class Deck {
  name: string;

  cards: Note[];

  image: string | undefined;

  style: string | null;

  id: number;

  settings: CardOption | null;

  globalTags: string[];

  mcqCount = 0;

  mcqSkippedCount = 0;

  get cardCount() {
    return this.cards.length;
  }

  constructor(
    name: string,
    cards: Note[],
    image: string | undefined,
    style: string | null,
    id: number,
    settings: CardOption
  ) {
    this.settings = settings;
    this.name = name.replace(/\n/g, ' ');
    this.cards = cards;
    this.image = image;
    this.style = style;
    this.id = id;
    this.globalTags = [];
    console.log(`New Deck with ${this.cards.length} cards`);
  }

  static CleanCards(cards: Note[]) {
    return cards.filter(
      (note) =>
        note.isValidMCQNote() ||
        note.isValidClozeNote() ||
        note.isValidInputNote() ||
        note.isValidBasicNote()
    );
  }

  // True when at least one card is salvageable at the RAW parse stage. A cloze
  // card's `cloze` flag is only set later in processPayload, so at parse time
  // CleanCards (which reads that flag) drops a card whose answer lives in a
  // {{c…}} deletion on the front. The empty-deck rescue gates on this so it
  // never mistakes a healthy cloze deck for an empty one and replaces it.
  static hasUsableCards(cards: Note[]): boolean {
    return (
      this.CleanCards(cards).length > 0 ||
      cards.some((note) => note.hasClozeDeletion())
    );
  }

  cleanStyle() {
    if (this.style) {
      return this.style.replace(/'/g, '"');
    }
    return '';
  }
}
