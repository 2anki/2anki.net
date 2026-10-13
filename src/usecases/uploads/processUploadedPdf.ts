import CardOption from '../../lib/parser/Settings/CardOption';
import { isPDFFile } from '../../lib/storage/checks';

// "Process PDF files" skips PDFs found inside a ZIP. A PDF the user uploaded
// on its own is the whole point of the upload, so the switch never applies.
export function processUploadedPdf(
  fileName: string,
  settings: CardOption
): CardOption {
  if (settings.processPDFs || !isPDFFile(fileName)) {
    return settings;
  }

  const copy = Object.create(
    Object.getPrototypeOf(settings),
    Object.getOwnPropertyDescriptors(settings)
  );
  copy.processPDFs = true;
  return copy;
}
