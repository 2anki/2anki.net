// File types the preview endpoint can read text from.
const PREVIEWABLE = /\.(pdf|txt|md|markdown|html?|csv)$/i;
const PDF = /\.pdf$/i;

const FEW_CARDS = 3;
const FEW_CARDS_FOR_A_LONG_FILE = 8;
const LONG_PDF_BYTES = 200 * 1024;
const LONG_TEXT_BYTES = 20 * 1024;

export function isPreviewableFile(filename: string): boolean {
  return PREVIEWABLE.test(filename);
}

// A deck is thin when it has fewer than three cards, or a handful of cards from
// a file long enough to hold many more. The client has no page or heading
// count, so length is the file size: a 200 KB PDF or a 20 KB text file.
export function isThinDeck(
  cardCount: number | null,
  filename: string,
  fileSizeBytes: number | null
): cardCount is number {
  if (cardCount == null || cardCount <= 0) {
    return false;
  }
  if (!isPreviewableFile(filename) || /my clippings\.txt$/i.test(filename)) {
    return false;
  }
  if (cardCount < FEW_CARDS) {
    return true;
  }
  if (fileSizeBytes == null || cardCount > FEW_CARDS_FOR_A_LONG_FILE) {
    return false;
  }
  return (
    fileSizeBytes >= (PDF.test(filename) ? LONG_PDF_BYTES : LONG_TEXT_BYTES)
  );
}
