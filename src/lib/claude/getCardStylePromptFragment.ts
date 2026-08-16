const VALID_PICKER_STYLES = new Set(['cloze', 'qa']);

export function validateCardStylePicker(raw: string | undefined): string {
  if (raw != null && VALID_PICKER_STYLES.has(raw)) {
    return raw;
  }
  return '';
}

export function getCardStylePromptFragment(style: string | undefined): string {
  if (style === 'heading-driven') {
    return "For each chunk, produce 2–6 cards. Each card's front references this chunk's heading; each card's back holds one fact.";
  }
  if (style === 'cloze') {
    return "Produce cloze deletion cards. Every card's front must contain at least one {{c1::...}} deletion wrapping the key term or fact. The back field should be left empty — Anki generates the back from the cloze syntax. When several deletions come from the same list or enumeration, put them on one card as sequential {{c1::...}} {{c2::...}} ... deletions — one card per list, not one card per item.";
  }
  if (style === 'qa') {
    return "Produce question-and-answer cards. Each card's front is a direct question; the back is a concise direct answer to that question. Do not use cloze syntax.";
  }
  return '';
}
