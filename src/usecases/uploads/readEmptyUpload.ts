import {
  censusUploadedFile,
  DocumentStructureCensus,
  ZipStructureCensus,
} from '../../infrastracture/adapters/fileConversion/documentStructureCensus';
import type {
  DocumentReading,
  EmptyUploadReading,
  ZipReading,
} from '../../types/EmptyUploadReading';

// The reading is built on the request before the 400 goes out, so it is
// bounded: a handful of files, none large enough to make re-reading them from
// disk or the census (which re-converts a docx) a visible delay or a heap
// spike on the empty-deck answer. A 5 MB text document is already hundreds
// of pages; a bigger one simply gets no reading.
export const READING_MAX_FILES = 5;
export const READING_MAX_BYTES = 5 * 1024 * 1024;

export interface ReadableUpload {
  originalname: string;
  size: number;
}

function emptyDocument(): DocumentReading {
  return {
    kind: 'document',
    words: 0,
    headings: 0,
    listItems: 0,
    tables: 0,
    toggles: 0,
    images: 0,
  };
}

function addDocument(
  total: DocumentReading,
  census: DocumentStructureCensus
): DocumentReading {
  return {
    kind: 'document',
    words: total.words + census.words,
    headings: total.headings + census.headings,
    listItems: total.listItems + census.listItems,
    tables: total.tables + census.tables,
    toggles: total.toggles + census.toggles,
    images: total.images + census.images,
  };
}

function zipReading(census: ZipStructureCensus): ZipReading {
  return {
    kind: 'zip',
    files: census.entryCount,
    readable: census.supportedCount,
    archives: census.nestedZipCount,
    imageFiles: census.imageCount,
    otherFiles: Math.max(census.unsupportedCount - census.imageCount, 0),
  };
}

// A single zip is read as an archive; everything else sums into one document
// reading. A zip mixed with loose files is rare and reads as the loose files,
// since those are what the parser could pair.
export async function readEmptyUpload<T extends ReadableUpload>(
  files: T[] | undefined,
  readBytes: (file: T) => Promise<Buffer | null>
): Promise<EmptyUploadReading | null> {
  const candidates = (files ?? [])
    .filter((file) => file.size <= READING_MAX_BYTES)
    .slice(0, READING_MAX_FILES);
  let document: DocumentReading | null = null;
  let zip: ZipReading | null = null;
  for (const file of candidates) {
    const buffer = await readBytes(file);
    if (buffer == null) continue;
    const census = await censusUploadedFile({
      originalname: file.originalname,
      buffer,
    });
    if (census == null) continue;
    if ('kind' in census) {
      if (!census.unreadable) zip = zip ?? zipReading(census);
    } else {
      document = addDocument(document ?? emptyDocument(), census);
    }
  }
  return document ?? zip;
}
