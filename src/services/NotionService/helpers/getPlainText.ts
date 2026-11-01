import type TagRegistry from '../../../lib/parser/TagRegistry';

interface Text {
  plain_text: string;
  annotations?: { strikethrough?: boolean };
}

const becameTag = (t: Text, tagRegistry?: TagRegistry): boolean =>
  t.annotations?.strikethrough === true &&
  tagRegistry?.addStrikethrough(t.plain_text) === true;

export default function getPlainText(
  text: Text[],
  tagRegistry?: TagRegistry
): string {
  if (!text || text.length === 0) {
    return '';
  }
  // join, not reduce with a seed: seeding with '' would prepend a stray <br>
  // before the first fragment. join is the operation this always was.
  return text
    .filter((t) => !becameTag(t, tagRegistry))
    .map((t) => t.plain_text)
    .join('<br>');
}
