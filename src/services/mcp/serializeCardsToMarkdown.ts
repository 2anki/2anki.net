export interface McpCard {
  front: string;
  back: string;
  deck?: string;
}

function escapeDetailsTags(text: string): string {
  return text.replace(/<(\/?)(details|summary)\b([^>]*)>/gi, '&lt;$1$2$3&gt;');
}

function escapeLeadingHeadings(text: string): string {
  return text.replace(/^(#+)/gm, '\\$1');
}

function escapeLeadingDash(text: string): string {
  return text.replace(/^-/gm, '\\-');
}

function flattenFront(front: string): string {
  const oneLine = front
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return escapeLeadingHeadings(escapeDetailsTags(oneLine));
}

function guardBack(back: string): string {
  return escapeLeadingDash(
    escapeLeadingHeadings(escapeDetailsTags(back.trim()))
  );
}

export function serializeCardsToMarkdown(cards: McpCard[]): string {
  return cards
    .map(
      (card) => `## ${flattenFront(card.front)}\n\n${guardBack(card.back)}\n\n`
    )
    .join('');
}
