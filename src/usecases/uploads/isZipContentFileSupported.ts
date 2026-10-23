import {
  isHTMLFile,
  isMarkdownFile,
  isPlainText,
  isCSVFile,
  isPDFFile,
  isXLSXFile,
  isDocxFile,
  isLibreOfficeDocumentFile,
} from '../../lib/storage/checks';

const isFileWithoutExtension = (filename: string) =>
  Boolean(filename) && filename.indexOf('.') === -1;

export const isZipContentFileSupported = (filename: string) =>
  [
    isHTMLFile,
    isMarkdownFile,
    isPlainText,
    isCSVFile,
    isPDFFile,
    isXLSXFile,
    isDocxFile,
    isLibreOfficeDocumentFile,
    isFileWithoutExtension,
  ].some((check) => Boolean(check(filename)));
