// An intact index over compressed data that does not inflate: a copy damaged
// in transit or by the tool that made it. The web matches this sentence on
// My decks; damagedZip.parity.test.ts fails if the two drift apart.
export const DAMAGED_ZIP_MESSAGE =
  "Part of this zip file is damaged, so 2anki can't read it. Download or zip the files again, then upload the new zip.";

export const ZIP_PARTLY_RECOVERED_WARNING = 'zip-partly-recovered';

// This text travels in the X-Warning response header, which is Latin-1 only.
export const ZIP_PARTLY_RECOVERED_WARNING_TEXT =
  'Part of this zip was damaged, so some files may be missing from this deck.';

export function zipErrorCode(
  err: Error
): 'zip_damaged' | 'zip_incomplete' | 'zip_too_large' | null {
  if (err.name === 'ZipRecoveryTooLargeError') return 'zip_too_large';
  if (err.name !== 'IncompleteZipError') return null;
  return err.message === DAMAGED_ZIP_MESSAGE ? 'zip_damaged' : 'zip_incomplete';
}
