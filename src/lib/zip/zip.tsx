import fs from 'fs';
import path from 'path';
import { strFromU8, unzipSync } from 'fflate';
import { renderToStaticMarkup } from 'react-dom/server';
import { getUploadLimits } from '../misc/getUploadLimits';
import {
  isHiddenFileOrDirectory,
  isHTMLFile,
  isImageFile,
  isMarkdownFile,
  isPDFFile,
} from '../storage/checks';
import { processAndPrepareArchiveData } from './fallback/processAndPrepareArchiveData';
import { isSafeZipEntryName } from './isSafeZipEntryName';
import CardOption from '../parser/Settings';
import { getRandomUUID } from '../../shared/helpers/getRandomUUID';
import { convertImageToHTML } from '../../infrastracture/adapters/fileConversion/convertImageToHTML';
import { MAX_OLD_GENERATION_SIZE_MB } from '../conversionMemoryLimits';

interface File {
  name: string;
  contents?: Buffer | Uint8Array | string;
  // Declared decompressed size from the zip central directory, recorded on
  // spilled entries so length-only consumers (deck-size sums, telemetry) never
  // trigger the lazy disk read behind `contents`.
  size?: number;
}

// Conversion runs in a Piscina worker whose V8 old-generation heap is capped at
// MAX_OLD_GENERATION_SIZE_MB. The text ceiling below derives from that cap so
// the friendly "too large" error fires BEFORE V8 kills the worker with
// ERR_WORKER_OUT_OF_MEMORY (#3717). Note the decompressed bytes themselves live
// mostly in EXTERNAL (ArrayBuffer) memory outside the old-gen cap — the real
// extraction ceiling is process RSS, which is why extraction is batched below.
const WORKER_OLD_GEN_BYTES = MAX_OLD_GENERATION_SIZE_MB * 1024 * 1024;

// Text we KEEP in memory (decoded HTML/markdown, the OCR html) is stored as
// UTF-16 strings — roughly 2× the counted byte length — so hold this ceiling to
// about half the worker old-gen cap to leave headroom for that overhead, the
// inflated archive map, and other allocations. Binary entries (images, audio,
// misc media) are spilled to disk and bounded instead by the compressed-upload
// cap (`getUploadLimits().fileSize`); they do not count here (#3709/#3711).
const MAX_IN_MEMORY_BYTES = Math.floor(WORKER_OLD_GEN_BYTES * 0.5);

// Extraction is batched: a census pass reads every entry's declared size from
// the central directory WITHOUT inflating anything, then entries inflate in
// bounded batches that spill to disk and release. Peak resident bytes during
// extraction are therefore one batch (plus the compressed input), never the
// archive's total decompressed size — which is what let a real 643MB paying
// export through where the old whole-archive inflation could not. The total
// decompressed budget moved from a heap bound to a DISK budget: a zip bomb
// (DEFLATE of zeros, ~1000:1; nested archives compound it) still aborts with
// the friendly error at the census, before a single byte inflates (#3717).
const MAX_EXTRACTED_BYTES = 4 * 1024 * 1024 * 1024;

// One extraction batch's decompressed bytes. Far below the worker heap cap so
// a batch plus the compressed input plus text comfortably fit.
const MAX_BATCH_EXTRACT_BYTES = 128 * 1024 * 1024;

function formatGigabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Back a spilled entry with a lazy disk read so every consumer that reads
// `.contents` (embedFile, PrepareDeck converters, writeWorkspaceFile) still gets
// real bytes, but only one entry's bytes are resident at a time instead of all.
function makeDiskBackedFile(
  name: string,
  diskPath: string,
  size: number
): File {
  const file: File = { name, size };
  Object.defineProperty(file, 'contents', {
    enumerable: true,
    configurable: true,
    get() {
      return fs.readFileSync(diskPath);
    },
  });
  return file;
}

class ZipHandler {
  files: File[];
  zipFileCount: number;
  maxZipFiles: number;
  combinedHTML: string;
  inMemoryBytes: number;
  maxInMemoryBytes: number;
  decompressedBytes: number;
  maxDecompressedBytes: number;
  maxBatchBytes: number;
  spillLocation?: string;

  constructor(
    maxNestedZipFiles: number,
    maxInMemoryBytes: number = MAX_IN_MEMORY_BYTES,
    maxDecompressedBytes: number = MAX_EXTRACTED_BYTES,
    maxBatchBytes: number = MAX_BATCH_EXTRACT_BYTES
  ) {
    this.files = [];
    this.zipFileCount = 0;
    this.maxZipFiles = maxNestedZipFiles;
    this.combinedHTML = '';
    this.inMemoryBytes = 0;
    this.maxInMemoryBytes = maxInMemoryBytes;
    this.decompressedBytes = 0;
    this.maxDecompressedBytes = maxDecompressedBytes;
    this.maxBatchBytes = maxBatchBytes;
  }

  private trackInMemoryBytes(byteLength: number) {
    this.inMemoryBytes += byteLength;
    if (this.inMemoryBytes > this.maxInMemoryBytes) {
      throw new Error(
        `This upload is too large to process — it holds over ${formatGigabytes(
          this.maxInMemoryBytes
        )} of text in memory. Split it into smaller uploads and try again.`
      );
    }
  }

  // Sum each entry's declared decompressed size (shared across nested archives
  // via this instance counter) before fflate inflates it, so a zip bomb aborts
  // early instead of materializing the whole inflated map into the worker heap.
  private trackDecompressedBytes(originalSize: number) {
    this.decompressedBytes += originalSize;
    if (this.decompressedBytes > this.maxDecompressedBytes) {
      throw new Error(
        `This upload is too large to process — it decompresses to over ${formatGigabytes(
          this.maxDecompressedBytes
        )}. Split it into smaller uploads and try again.`
      );
    }
  }

  // Write a binary entry to the workspace on disk and return a lazily-read File.
  // Returns undefined when there is no spill location (in-memory callers/tests).
  private spillToDisk(name: string, file: Uint8Array): File | undefined {
    if (this.spillLocation == null) return undefined;
    const base = path.resolve(this.spillLocation);
    const abs = path.resolve(base, name);
    if (abs !== base && !abs.startsWith(base + path.sep)) {
      console.warn('Skipped zip entry that escaped the spill directory');
      return undefined;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file);
    return makeDiskBackedFile(name, abs, file.length);
  }

  async build(
    zipData: Uint8Array,
    paying: boolean,
    settings: CardOption,
    spillLocation?: string
  ) {
    this.spillLocation = spillLocation;
    const size = Buffer.byteLength(zipData);
    const limits = getUploadLimits(paying);

    if (size > limits.fileSize) {
      throw new Error(
        renderToStaticMarkup(
          <>
            Your upload is too big, there is a max of {size} / $
            {limits.fileSize} currently.{' '}
            <a href="https://alemayhu.com/patreon">Become a patron</a> to remove
            default limit.
          </>
        )
      );
    }

    await this.processZip(zipData, paying, settings);
  }

  // Entries the census keeps resident in memory when inflated: decoded text
  // and — in image-quiz mode — images that become OCR HTML. Everything else
  // inflates in bounded batches and spills to disk immediately.
  private isMemoryBoundEntry(
    name: string,
    paying: boolean,
    settings: CardOption
  ): boolean {
    if (isHTMLFile(name) || isMarkdownFile(name)) return true;
    return paying && settings.imageQuizHtmlToAnki && isImageFile(name);
  }

  private async processZip(
    zipData: Uint8Array,
    paying: boolean,
    settings: CardOption
  ) {
    if (this.zipFileCount >= this.maxZipFiles) {
      throw new Error('Too many zip files in the upload.');
    }

    try {
      // Census pass: read every entry's name and declared decompressed size
      // from the central directory without inflating anything. The cumulative
      // disk budget (shared across nested archives) trips HERE, so a zip bomb
      // aborts before a single byte inflates.
      const census: { name: string; size: number }[] = [];
      unzipSync(zipData, {
        filter: (file) => {
          if (!isHiddenFileOrDirectory(file.name)) {
            this.trackDecompressedBytes(file.originalSize);
            census.push({ name: file.name, size: file.originalSize });
          }
          return false;
        },
      });

      const noSuffixCount = census.filter((c) => !c.name.includes('.')).length;

      // Text pass: inflate only the memory-bound entries in one go; the
      // existing in-memory text guard bounds them.
      const memoryBound = new Set(
        census
          .filter((c) => this.isMemoryBoundEntry(c.name, paying, settings))
          .map((c) => c.name)
      );
      if (memoryBound.size > 0) {
        const textMap = unzipSync(zipData, {
          filter: (file) => memoryBound.has(file.name),
        });
        for (const name in textMap) {
          await this.handleFile(name, textMap[name], paying, settings);
        }
      }

      // Binary passes: inflate the rest in batches bounded by maxBatchBytes,
      // spilling each batch to disk before the next inflates, so peak resident
      // decompressed bytes are one batch — never the archive total.
      const remaining = census.filter((c) => !memoryBound.has(c.name));
      let batch = new Set<string>();
      let batchBytes = 0;
      const flushBatch = async () => {
        if (batch.size === 0) return;
        const batchMap = unzipSync(zipData, {
          filter: (file) => batch.has(file.name),
        });
        for (const name in batchMap) {
          await this.handleFile(name, batchMap[name], paying, settings);
        }
        batch = new Set<string>();
        batchBytes = 0;
      };
      for (const entry of remaining) {
        if (batchBytes + entry.size > this.maxBatchBytes && batch.size > 0) {
          await flushBatch();
        }
        batch.add(entry.name);
        batchBytes += entry.size;
      }
      await flushBatch();

      if (noSuffixCount === census.length) {
        throw new Error(
          'The zip file contains only files with no suffix. Supported file types are: .zip, .html, .csv, .md, .pdf, .ppt, and .pptx.'
        );
      }

      this.addCombinedHTMLToFiles(paying, settings);
    } catch (error: unknown) {
      await this.handleZipError(error, zipData, paying);
    }
  }

  private async handleFile(
    name: string,
    file: Uint8Array,
    paying: boolean,
    settings: CardOption
  ) {
    if (name.includes('__MACOSX/')) return;

    if (!isSafeZipEntryName(name)) {
      console.warn('Skipped zip entry with unsafe path of length', name.length);
      return;
    }

    if (name.endsWith('.zip')) {
      this.zipFileCount++;
      await this.processZip(file, paying, settings);
      return;
    }

    if (isHTMLFile(name) || isMarkdownFile(name)) {
      this.trackInMemoryBytes(file.length);
      this.files.push({ name, contents: strFromU8(file) });
    } else if (paying && settings.imageQuizHtmlToAnki && isImageFile(name)) {
      this.trackInMemoryBytes(file.length);
      await this.convertAndAddImageToHTML(name, file);
    } else if (isPDFFile(name) && settings.processPDFs === false) {
      // Skip PDF processing when processPDFs is false
      return;
    } else {
      const spilled = this.spillToDisk(name, file);
      if (spilled) {
        this.files.push(spilled);
      } else {
        this.trackInMemoryBytes(file.length);
        this.files.push({ name, contents: file });
      }
    }
  }

  private async convertAndAddImageToHTML(name: string, file: Uint8Array) {
    const html = await convertImageToHTML(Buffer.from(file).toString('base64'));
    this.combinedHTML += html;
    console.log('Converted image to HTML:', name, html);
  }

  private addCombinedHTMLToFiles(paying: boolean, settings: CardOption) {
    if (this.combinedHTML && paying) {
      const finalHTML = `<!DOCTYPE html>
<html>
<head><title>${settings.deckName ?? 'Image Quiz'}</title></head>
<body>
${this.combinedHTML}
</body>
</html>`;
      this.files.push({
        name: `ocr-${getRandomUUID()}.html`,
        contents: finalHTML,
      });
    }
  }

  private async handleZipError(
    error: unknown,
    zipData: Uint8Array,
    paying: boolean
  ) {
    const isArchiveProcessingError = (error as { code?: number }).code === 13;

    if (isArchiveProcessingError) {
      const foundFiles = await processAndPrepareArchiveData(zipData, paying);
      this.files.push(...foundFiles);
      console.log('Processed files using fallback method:');
    } else {
      throw error;
    }
  }

  getFileNames() {
    return this.files.map((file) => file.name);
  }
}

export {
  ZipHandler,
  File,
  MAX_IN_MEMORY_BYTES,
  MAX_EXTRACTED_BYTES,
  MAX_BATCH_EXTRACT_BYTES,
};
