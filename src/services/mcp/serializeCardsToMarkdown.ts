export interface McpCard {
  front: string;
  back: string;
  deck?: string;
}

function escapeDetailsTags(text: string): string {
  return text.replace(/<(\/?)(details|summary)\b([^>]*)>/gi, '&lt;$1$2$3&gt;');
}

function escapeLeadingHeading(line: string): string {
  return line.replace(/^(#+)/, '\\$1');
}

// A back may legitimately start a line with `-`, but `-` is an unconditional
// card boundary in the upload parser, so a bare dash list would split the card.
// Rewrite it to an equivalent that survives the parse instead of escaping it to
// literal text: a dash bullet becomes a `*` bullet (gated off by the `##` front,
// still rendered as a list), a dash rule becomes `***`, and any other leading
// dash is escaped.
function rewriteLeadingDash(line: string): string {
  if (/^-(?=[ \t]|$)/.test(line)) {
    return line.replace(/^-/, '*');
  }
  if (/^-{3,}[ \t]*$/.test(line)) {
    return '***';
  }
  if (/^-/.test(line)) {
    return line.replace(/^-/, '\\-');
  }
  return line;
}

function isFenceDelimiter(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

function guardLeadingMarkers(text: string): string {
  let insideFence = false;
  return text
    .split('\n')
    .map((line) => {
      if (isFenceDelimiter(line)) {
        insideFence = !insideFence;
        return line;
      }
      if (insideFence) {
        return line;
      }
      return rewriteLeadingDash(escapeLeadingHeading(line));
    })
    .join('\n');
}

function flattenFront(front: string): string {
  const oneLine = front
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return escapeLeadingHeading(escapeDetailsTags(oneLine));
}

function guardBack(back: string): string {
  return guardLeadingMarkers(escapeDetailsTags(back.trim()));
}

export function serializeCardsToMarkdown(cards: McpCard[]): string {
  return cards
    .map(
      (card) => `## ${flattenFront(card.front)}\n\n${guardBack(card.back)}\n\n`
    )
    .join('');
}
