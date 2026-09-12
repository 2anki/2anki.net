export const isMarkdownFile = (fileName: string) => /.md$/i.exec(fileName);

export const isHTMLFile = (fileName: string) => /.html$/i.exec(fileName);

export const isPlainText = (fileName: string) => /\.txt$/i.exec(fileName);

export function hasMarkdownFileName(fileNames: string[]) {
  return fileNames.some(isMarkdownFile);
}

export const isSoundCloudURL = (url: string) => /soundcloud\.com/.exec(url);

export const isTwitterURL = (url: string) => /twitter\.com/.exec(url);

export const isVimeoURL = (url: string) => /vimeo\.com/.exec(url);

export const isLoomURL = (url: string) => /loom\.com/.exec(url);

export const isImageFileEmbedable = (url: string) => {
  const isLocalPath = !url.startsWith('http') && !url.startsWith('data:image');
  const hasTraversal = url.includes('../') || url.includes('..\\');
  return isLocalPath && !hasTraversal;
};

export const isCSVFile = (fileName: string) => /\.(csv|tsv)$/i.exec(fileName);

export const isDocxFile = (fileName: string) => /\.(docx|doc)$/i.exec(fileName);

export const isPDFFile = (fileName: string) => /.pdf$/i.exec(fileName);

export const isPPTFile = (fileName: string) => /\.(ppt|pptx)$/i.exec(fileName);

/**
 * Checks if a file is a compressed file based on its extension or naming pattern.
 * This includes .zip files, .z files (Unix compress format), temporary downloads,
 * and files without a proper extension.
 * @param filename
 * @returns boolean indicating if the file is likely a compressed file
 */
export const isCompressedFile = (
  filename: string | null | undefined
): boolean => {
  if (!filename) {
    return false;
  }
  const lowerCaseFilename = filename.toLowerCase();
  if (
    lowerCaseFilename.endsWith('.crdownload') ||
    lowerCaseFilename.endsWith('.tmp') ||
    lowerCaseFilename.endsWith('.zip') ||
    lowerCaseFilename.endsWith('.z')
  ) {
    return true;
  }
  return filename.trim().endsWith('.') || !filename.includes('.');
};

export const isImageFile = (name: string) =>
  isImageFileEmbedable(name) &&
  (name.toLowerCase().endsWith('.png') ||
    name.toLowerCase().endsWith('.jpg') ||
    name.toLowerCase().endsWith('.jpeg') ||
    name.toLowerCase().endsWith('.gif') ||
    name.toLowerCase().endsWith('.bmp') ||
    name.toLowerCase().endsWith('.svg'));

export const isXLSXFile = (fileName: string) => /.xlsx$/i.test(fileName);

export const isOpmlFile = (fileName: string) => /\.opml$/i.test(fileName);

export const isBrainstormsJsonFile = (fileName: string) =>
  /\.brainstorms\.json$/i.test(fileName);

export const isEpubFile = (fileName: string) => /\.epub$/i.test(fileName);

export const isKindleClippingsFile = (fileName: string) => {
  if (!fileName) return false;
  const base = fileName.replace(/\\/g, '/').split('/').pop();
  if (!base) return false;
  return /^my clippings\.txt$/i.test(base);
};

export const isHiddenFileOrDirectory = (fileName: string) =>
  fileName.startsWith('.') ||
  fileName.endsWith('/') ||
  fileName.startsWith('__MACOSX');

export const isAnkiDeckFile = (
  fileName: string | null | undefined
): boolean => {
  if (typeof fileName !== 'string') return false;
  return fileName.toLowerCase().endsWith('.apkg');
};

export const isXmlFile = (fileName: string) => /\.xml$/i.test(fileName);

export const isPagesFile = (fileName: string | null | undefined): boolean => {
  if (typeof fileName !== 'string') return false;
  return /\.pages$/i.test(fileName);
};

const ANKI_APP_SNIFF_BYTES = 2048;

export const isAnkiAppExportXml = (
  contents: Buffer | Uint8Array | string
): boolean => {
  const head =
    typeof contents === 'string'
      ? contents.slice(0, ANKI_APP_SNIFF_BYTES)
      : Buffer.from(contents.slice(0, ANKI_APP_SNIFF_BYTES)).toString('utf-8');
  const stripped = head
    .replace(/^\uFEFF/, '')
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trimStart();
  return /^<deck[\s>]/i.test(stripped);
};
