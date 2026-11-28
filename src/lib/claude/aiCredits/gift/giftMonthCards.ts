import type { ConversionEngine } from '../../../parser/conversionEngine';

interface JobPackage {
  engine?: ConversionEngine;
  cardCount?: number;
}

export interface GiftJobFile {
  packages: JobPackage[];
}

function madeByClaude(file: GiftJobFile): boolean {
  return file.packages.some((p) => p.engine === 'claude');
}

function cardsNotMadeByClaude(file: GiftJobFile): number {
  return file.packages
    .filter((p) => p.engine !== 'claude')
    .reduce((sum, p) => sum + (p.cardCount ?? 0), 0);
}

// The gift paid for the Claude cards of this job, so they are delivered even
// past the month's free cards and must not be lost to the cards Claude did not
// make. Those still meet the month: files are taken in upload order, and a file
// with no Claude cards that does not fit what is left is left out instead of
// refusing the whole job. A job with no Claude cards keeps the plain limit.
export function filesLeftOutOfGiftJob<F extends GiftJobFile>(
  files: F[],
  monthCardsLeft: number
): F[] {
  if (!files.some(madeByClaude)) return [];
  let left = monthCardsLeft;
  const leftOut: F[] = [];
  for (const file of files) {
    const cards = cardsNotMadeByClaude(file);
    if (cards === 0) continue;
    if (!madeByClaude(file) && cards > left) {
      leftOut.push(file);
    } else {
      left -= cards;
    }
  }
  return leftOut;
}
