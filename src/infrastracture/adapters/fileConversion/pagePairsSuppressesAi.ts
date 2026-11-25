import type CardOption from '../../../lib/parser/Settings/CardOption';
import {
  isHiddenFileOrDirectory,
  isPDFFile,
} from '../../../lib/storage/checks';
import { isResourceForkEntry } from './documentStructureCensus';

// Page pairs is a PDF-only, saved preference, so it must not silence AI on the
// other formats a user also uploads. It wins over AI only when PDF processing is
// on and every content file in the upload is a PDF: those PDFs convert to
// deterministic page-pair image cards with no AI. Only zip artefacts (a macOS
// __MACOSX fork, .DS_Store, Thumbs.db, stray dotfiles, directory entries) are
// dropped; every other file — pptx, images, markdown — counts as content, so a
// single non-PDF keeps AI on. A mixed or non-PDF upload still reaches Claude;
// with PDF processing off the page-pair branch produces nothing, so suppressing
// AI would ship an empty deck.
export function pagePairsSuppressesAi(
  settings: Pick<CardOption, 'pdfPagePairs' | 'processPDFs'>,
  files: readonly { name: string }[]
): boolean {
  if (!settings.pdfPagePairs || settings.processPDFs === false) {
    return false;
  }
  const contentFiles = files.filter(
    (file) =>
      !isResourceForkEntry(file.name) && !isHiddenFileOrDirectory(file.name)
  );
  return (
    contentFiles.length > 0 &&
    contentFiles.every((file) => isPDFFile(file.name))
  );
}
