import {
  isAnkiDeckFile,
  isBrainstormsJsonFile,
  isEpubFile,
  isKindleClippingsFile,
  isOpmlFile,
  isXmlFile,
} from '../../lib/storage/checks';

// Files handled by these branches in processFile pre-empt the Claude/PrepareDeck
// route, so they must not count toward the cross-file gate even when their
// extension (e.g. "My Clippings.txt" matching isPlainText) otherwise would.
export function routedAwayFromClaude(name: string): boolean {
  return (
    isAnkiDeckFile(name) ||
    isXmlFile(name) ||
    isOpmlFile(name) ||
    isBrainstormsJsonFile(name) ||
    isKindleClippingsFile(name) ||
    isEpubFile(name)
  );
}
