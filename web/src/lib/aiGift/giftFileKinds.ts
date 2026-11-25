export type GiftFileKind = 'text' | 'html' | 'pdf' | 'office' | 'zip' | 'photo';

const KIND_BY_EXTENSION = new Map<string, GiftFileKind>([
  ['pdf', 'pdf'],
  ['txt', 'text'],
  ['md', 'text'],
  ['markdown', 'text'],
  ['csv', 'text'],
  ['tsv', 'text'],
  ['html', 'html'],
  ['htm', 'html'],
  ['docx', 'office'],
  ['pptx', 'office'],
  ['ppt', 'office'],
  ['zip', 'zip'],
  ['png', 'photo'],
  ['jpg', 'photo'],
  ['jpeg', 'photo'],
  ['gif', 'photo'],
  ['webp', 'photo'],
  ['heic', 'photo'],
]);

export const GIFT_ACCEPT = Array.from(KIND_BY_EXTENSION.keys())
  .map((extension) => `.${extension}`)
  .join(',');

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

// Kindle exports its highlights as a .txt that has its own converter.
function isKindleClippings(name: string): boolean {
  return name.trim().toLowerCase() === 'my clippings.txt';
}

// What the AI dropzone takes: PDF, photos, notes and Notion zips. Anything
// else (Anki decks, XML, mind maps, e-books) keeps its own converter.
export function giftFileKind(name: string): GiftFileKind | null {
  if (isKindleClippings(name)) return null;
  return KIND_BY_EXTENSION.get(extensionOf(name)) ?? null;
}

export function acceptedByGift(files: readonly { name: string }[]): boolean {
  return files.length > 0 && files.every((f) => giftFileKind(f.name) != null);
}

// Inputs Claude cards read, the ones the convert step offers Claude for.
// Photos go to Photo to Deck, which has its own path.
export function readByClaudeCards(files: readonly { name: string }[]): boolean {
  return (
    files.length > 0 &&
    files.every((f) => {
      const kind = giftFileKind(f.name);
      return kind != null && kind !== 'photo';
    })
  );
}

export function allPhotos(files: readonly { name: string }[]): boolean {
  return (
    files.length > 0 && files.every((f) => giftFileKind(f.name) === 'photo')
  );
}
