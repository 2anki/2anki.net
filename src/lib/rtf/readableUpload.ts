import { isRtfFile } from '../storage/checks';
import type { UploadedFile } from '../storage/types';
import { rtfToText } from './rtfToText';

// RTF (TextEdit's default, WordPad) is read in-process into plain text and
// then converts like a .txt. It never reaches a document converter: RTF can
// link pictures and fields to local paths and URLs, and following those would
// read files or hosts on the server.
export function asReadableUpload(
  file: UploadedFile,
  contents: Buffer
): { file: UploadedFile; contents: Buffer } {
  if (!isRtfFile(file.originalname)) return { file, contents };
  return {
    file: {
      ...file,
      originalname: file.originalname.replace(/\.rtf$/i, '.txt'),
    },
    contents: Buffer.from(rtfToText(contents.toString('latin1'))),
  };
}

export function rtfEntryAsText(
  name: string,
  contents: Uint8Array
): { name: string; contents: string } {
  return {
    name: name.replace(/\.rtf$/i, '.txt'),
    contents: rtfToText(Buffer.from(contents).toString('latin1')),
  };
}
