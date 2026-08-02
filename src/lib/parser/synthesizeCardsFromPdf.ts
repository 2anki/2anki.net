export interface PdfPage {
  text: string;
}

export interface PdfCard {
  front: string;
  back: string;
  tags: string[];
  // 0-based page the card's front came from, so per-page assets (extracted
  // figures) can be attached to the right card.
  pageIndex?: number;
}

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

export function synthesizeCardsFromPdf(
  pages: PdfPage[],
  deckName: string
): PdfCard[] {
  const cards: PdfCard[] = [];
  const tag = deckName.replace(/\s+/g, '_');

  for (let i = 0; i + 1 < pages.length; i += 2) {
    const front = pages[i].text.trim();
    const back = pages[i + 1].text.trim();

    if (isBlank(front) || isBlank(back)) {
      continue;
    }

    cards.push({ front, back, tags: [tag], pageIndex: i });
  }

  return cards;
}
