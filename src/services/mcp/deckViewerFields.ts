import type { ParsedApkg } from '../ApkgPreviewService/ApkgPreviewService';

// Deck-level facts the card viewer app shows in its header. Additive fields on
// the deck results: hosts without MCP Apps and the model still read the same
// cardCount/decks/sampleCards they always did.
export interface DeckFacts {
  noteCount: number;
  noteTypes: string[];
  tts?: true;
}

const TTS_TEMPLATE_PATTERN = /\{\{tts[\s:]/;

// A partial parse (no collection) yields no facts rather than a misleading 0.
export function deckFacts(parsed: ParsedApkg): Partial<DeckFacts> {
  const collection = parsed.collection as ParsedApkg['collection'] | undefined;
  if (!Array.isArray(collection?.cards)) return {};
  const { cards, notes, noteTypes } = collection;
  const noteIds = new Set<number>();
  for (const card of cards) {
    noteIds.add(card.nid);
  }
  const typeUsage = new Map<number, number>();
  for (const nid of noteIds) {
    const note = notes.get(nid);
    if (note) {
      typeUsage.set(note.mid, (typeUsage.get(note.mid) ?? 0) + 1);
    }
  }
  let tts = false;
  const names: { name: string; count: number }[] = [];
  for (const [mid, count] of typeUsage) {
    const noteType = noteTypes.get(mid);
    if (!noteType) continue;
    names.push({ name: noteType.name, count });
    if (
      noteType.templates.some(
        (template) =>
          TTS_TEMPLATE_PATTERN.test(template.qfmt) ||
          TTS_TEMPLATE_PATTERN.test(template.afmt)
      )
    ) {
      tts = true;
    }
  }
  names.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const facts: DeckFacts = {
    noteCount: noteIds.size,
    noteTypes: Array.from(new Set(names.map((entry) => entry.name))),
  };
  if (tts) facts.tts = true;
  return facts;
}

export function cardTags(parsed: ParsedApkg, cardId: number): string[] {
  const collection = parsed.collection as ParsedApkg['collection'] | undefined;
  if (!Array.isArray(collection?.cards)) return [];
  const card = collection.cards.find((entry) => entry.id === cardId);
  if (!card) return [];
  const note = collection.notes.get(card.nid);
  if (!note) return [];
  return note.tags.split(/\s+/).filter((tag) => tag.length > 0);
}
