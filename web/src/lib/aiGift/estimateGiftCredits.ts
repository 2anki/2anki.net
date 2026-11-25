import { giftFileKind, type GiftFileKind } from './giftFileKinds';

// No conversion has a cost check before it runs, so the convert step reads a
// file's size and type. One conversion chunk is 40,000 characters of text:
// about 10,000 input tokens and a few thousand output tokens at Sonnet
// prices, roughly 12 credits (a credit is one US cent).
export const CREDITS_PER_TEXT_CHARACTER = 12 / 40_000;

// The share of a file's bytes that is text Claude reads. A PDF and a Notion
// zip are mostly layout, fonts and images; plain notes are all text.
export const TEXT_SHARE_BY_KIND: Readonly<Record<GiftFileKind, number>> = {
  text: 1,
  html: 0.5,
  office: 0.3,
  pdf: 0.1,
  zip: 0.05,
  photo: 0,
};

export const MIN_ESTIMATE_CREDITS = 5;

// An "about" figure, rounded to 5. A scanned PDF read page by page costs more
// than its text share suggests; the gift's own balance still stops every call
// once its credits are used, so an estimate that is low never spends more.
export function estimateGiftCredits(
  files: readonly { name: string; size: number }[]
): number {
  const raw = files.reduce((sum, file) => {
    const kind = giftFileKind(file.name);
    const share = kind == null ? 0 : TEXT_SHARE_BY_KIND[kind];
    return sum + file.size * share * CREDITS_PER_TEXT_CHARACTER;
  }, 0);
  return Math.max(MIN_ESTIMATE_CREDITS, Math.ceil(raw / 5) * 5);
}
