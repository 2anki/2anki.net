export interface NoteTypeField {
  name: string;
  ord: number;
}

export interface NoteTypeTemplate {
  name: string;
  ord: number;
  qfmt: string;
  afmt: string;
}

export interface NoteType {
  id: number;
  name: string;
  type: 0 | 1;
  css: string;
  fields: NoteTypeField[];
  templates: NoteTypeTemplate[];
}

export interface Note {
  id: number;
  mid: number;
  tags: string;
  fields: string[];
  guid?: string;
}

export interface Card {
  id: number;
  nid: number;
  did: number;
  ord: number;
}

export interface Deck {
  id: number;
  name: string;
}

export interface NormalizedCollection {
  noteTypes: Map<number, NoteType>;
  notes: Map<number, Note>;
  decks: Map<number, Deck>;
  cards: Card[];
}

export interface RenderedCard {
  id: number;
  ord: number;
  templateName: string;
  deckName: string;
  deckPath: string[];
  noteTypeName: string;
  css: string;
  front: string;
  back: string;
}

export interface EditableFieldValue {
  fieldIndex: number;
  fieldName: string;
  value: string;
}

export interface EditableRenderedCard extends RenderedCard {
  editable: {
    front: EditableFieldValue | null;
    back: EditableFieldValue | null;
  };
  noteHasOtherCards: boolean;
}

export interface DeckMeta {
  id: number;
  fullName: string;
  path: string[];
  cardCount: number;
}

export interface PreviewMeta {
  totalCards: number;
  decks: DeckMeta[];
}
