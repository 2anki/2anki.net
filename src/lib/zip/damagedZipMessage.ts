// An intact index over compressed data that does not inflate: a copy damaged
// in transit or by the tool that made it. The web matches this sentence on
// My decks; damagedZip.parity.test.ts fails if the two drift apart.
export const DAMAGED_ZIP_MESSAGE =
  "Part of this zip file is damaged, so 2anki can't read it. Download or zip the files again, then upload the new zip.";

export function isDamagedZipError(err: Error): boolean {
  return (
    err.name === 'IncompleteZipError' && err.message === DAMAGED_ZIP_MESSAGE
  );
}
