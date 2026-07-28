// Question/answer boundary markers across the 10 supported document languages.
// A document's language is independent of the account's UI language — a German
// deck can be uploaded under an English UI — so the marker set is a fixed union
// matched regardless of locale. Keying marker choice off i18n settings would
// break determinism: the same input must always yield the same .apkg.
//
// These markers locate a card boundary on PLAIN text only. The card's front and
// back are always rendered from the rich source (rich text / inner HTML), so
// bold, highlight and equations survive. Case-insensitive matching covers Latin
// and Cyrillic case; Japanese has no case. A trailing colon (:, or fullwidth ：)
// is required so an ordinary word that merely starts with a marker letter —
// Osmosis, Photosynthesis — is never mistaken for a marker. A period is NOT a
// valid separator: 'Q. What…' / 'A. London' / 'V. Conclusion' / 'P. 42' are MCQ
// option labels, Roman-numeral outlines and page refs, not question/answer
// boundaries — matching them shipped an MCQ's first option as the answer.
//
//   en Q/A · de F/A · es P/R · pt P/R · fr Q/R · it D/R
//   nl V/A · pl P/O · ru В/О · ja 問/答
export const QUESTION_MARKERS = ['Q', 'F', 'P', 'D', 'V', 'В', '問'] as const;

export const ANSWER_MARKERS = ['A', 'R', 'O', 'О', '答'] as const;

// A neutral, language-independent term/definition separator (term::definition).
export const TERM_DEFINITION_SEPARATOR = '::';

function markerPattern(markers: readonly string[]): RegExp {
  return new RegExp(`^\\s*(?:${markers.join('|')})\\s*[:：]\\s*`, 'i');
}

export const QUESTION_MARKER_PATTERN = markerPattern(QUESTION_MARKERS);
export const ANSWER_MARKER_PATTERN = markerPattern(ANSWER_MARKERS);

export function startsWithQuestionMarker(text: string): boolean {
  return QUESTION_MARKER_PATTERN.test(text);
}

export function startsWithAnswerMarker(text: string): boolean {
  return ANSWER_MARKER_PATTERN.test(text);
}

// Length of the leading marker (and its separator/whitespace) matched at the
// start of the plain text, or 0 if none. Callers slice this many characters off
// the rich source so the marker itself never appears on the card.
export function questionMarkerLength(text: string): number {
  return QUESTION_MARKER_PATTERN.exec(text)?.[0].length ?? 0;
}

export function answerMarkerLength(text: string): number {
  return ANSWER_MARKER_PATTERN.exec(text)?.[0].length ?? 0;
}
