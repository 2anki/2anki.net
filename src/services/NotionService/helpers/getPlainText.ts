interface Text {
  plain_text: string;
}

export default function getPlainText(text: Text[]): string {
  if (!text || text.length === 0) {
    return '';
  }
  // join, not reduce with a seed: seeding with '' would prepend a stray <br>
  // before the first fragment. join is the operation this always was.
  return text.map((t) => t.plain_text).join('<br>');
}
