import fs from 'fs';
import { createHash } from 'node:crypto';
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
  isRtfFile,
} from '../storage/checks';
import { rtfEntryAsText } from '../rtf/readableUpload';
import { processAndPrepareArchiveData } from './fallback/processAndPrepareArchiveData';
import { isSafeZipEntryName } from './isSafeZipEntryName';
import { isZipContentFileSupported } from '../../usecases/uploads/isZipContentFileSupported';
import CardOption from '../parser/Settings';
import { getRandomUUID } from '../../shared/helpers/getRandomUUID';
import { convertImageToHTML } from '../../infrastracture/adapters/fileConversion/convertImageToHTML';
import {
  MAX_EXTRACTED_BYTES,
  MAX_IN_MEMORY_BYTES,
  MAX_RECOVERY_MS,
} from './zipLimits';
import { RecoveryBudget } from './fallback/types';
import { ZipRecoveryTooLargeError } from './fallback/ZipRecoveryTooLargeError';
import { DAMAGED_ZIP_MESSAGE } from './damagedZipMessage';

interface File {
  name: string;
  contents?: Buffer | Uint8Array | string;
  // Declared decompressed size from the zip central directory, recorded on
  // spilled entries so length-only consumers (deck-size sums, telemetry) never
  // trigger the lazy disk read behind `contents`.
  size?: number;
}

// One extraction batch's decompressed bytes. Far below the worker heap cap so
// a batch plus the compressed input plus text comfortably fit.
const MAX_BATCH_EXTRACT_BYTES = 128 * 1024 * 1024;

function formatGigabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Real prod failures (#4028) were zips that end mid-entry with no central
// directory — files grabbed while the export was still downloading or a cloud
// folder was still syncing. fflate needs the end-of-central-directory record,
// so these throw code 13 and land in the bsdtar fallback; when even that
// recovers nothing usable, the honest answer is "incomplete", not "no cards".
const INCOMPLETE_ZIP_MESSAGE =
  'This zip file is incomplete — it ends before its file index, which usually means it was still downloading or syncing when it was uploaded. Wait for the download to finish, then upload it again.';

const FFLATE_UNEXPECTED_EOF = 0;
const FFLATE_INVALID_BLOCK_TYPE = 1;
const FFLATE_INVALID_LENGTH_LITERAL = 2;
const FFLATE_INVALID_DISTANCE = 3;
const FFLATE_INVALID_ZIP_DATA = 13;
const DAMAGED_DATA_CODES = new Set([
  FFLATE_UNEXPECTED_EOF,
  FFLATE_INVALID_BLOCK_TYPE,
  FFLATE_INVALID_LENGTH_LITERAL,
  FFLATE_INVALID_DISTANCE,
]);

interface ArchiveStart {
  fileCount: number;
  inMemoryBytes: number;
  photoCount: number;
}

interface PhotoText {
  key: string;
  html: string;
}

function fflateErrorCode(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : undefined;
}

// The name is what survives the upload worker's thread boundary (errors cross
// it as { message, name }), so jobFailureReason matches on it, not the class.
class IncompleteZipError extends Error {
  code = 'ZIP_INVALID';

  constructor(message: string = INCOMPLETE_ZIP_MESSAGE) {
    super(message);
    this.name = 'IncompleteZipError';
  }
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
  photoTexts: PhotoText[];
  // Photos the failed pass of a damaged archive already read. When its
  // fallback reopens a nested zip, each of these is skipped once, so the
  // same photo is neither sent to OCR again nor written twice; any other
  // photo, a duplicate elsewhere included, is read as before.
  photosToSkipOnReopen: string[];
  inMemoryBytes: number;
  maxInMemoryBytes: number;
  decompressedBytes: number;
  maxDecompressedBytes: number;
  maxBatchBytes: number;
  spillLocation?: string;
  recoveredBytes = 0;
  recoveredBrokenArchive = false;
  recoveryStartedAt?: number;

  constructor(
    maxNestedZipFiles: number,
    maxInMemoryBytes: number = MAX_IN_MEMORY_BYTES,
    maxDecompressedBytes: number = MAX_EXTRACTED_BYTES,
    maxBatchBytes: number = MAX_BATCH_EXTRACT_BYTES
  ) {
    this.files = [];
    this.zipFileCount = 0;
    this.maxZipFiles = maxNestedZipFiles;
    this.photoTexts = [];
    this.photosToSkipOnReopen = [];
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
    this.addCombinedHTMLToFiles(paying, settings);
  }

  // Entries the census keeps resident in memory when inflated: decoded text
  // and — in image-quiz mode — images that become OCR HTML. Everything else
  // inflates in bounded batches and spills to disk immediately.
  private isMemoryBoundEntry(
    name: string,
    paying: boolean,
    settings: CardOption
  ): boolean {
    if (isHTMLFile(name) || isMarkdownFile(name) || isRtfFile(name)) {
      return true;
    }
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

    const before: ArchiveStart = {
      fileCount: this.files.length,
      inMemoryBytes: this.inMemoryBytes,
      photoCount: this.photoTexts.length,
    };
    const archiveKey =
      paying && settings.imageQuizHtmlToAnki
        ? createHash('sha256').update(zipData).digest('hex')
        : '';
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
          await this.handleFile(
            name,
            textMap[name],
            paying,
            settings,
            archiveKey
          );
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
          await this.handleFile(
            name,
            batchMap[name],
            paying,
            settings,
            archiveKey
          );
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
          'The zip file contains only files with no extension, so 2anki can’t tell what they are. Add the extension back (for example .txt, .md, .html, .csv, .pdf, .docx, .rtf, .xlsx or .pptx) and upload the zip again.'
        );
      }
    } catch (error: unknown) {
      await this.handleZipError(error, zipData, paying, settings, before);
    }
  }

  private async handleFile(
    name: string,
    file: Uint8Array,
    paying: boolean,
    settings: CardOption,
    archiveKey: string
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

    if (isRtfFile(name)) {
      this.trackInMemoryBytes(file.length);
      this.files.push(rtfEntryAsText(name, file));
    } else if (isHTMLFile(name) || isMarkdownFile(name)) {
      this.trackInMemoryBytes(file.length);
      this.files.push({ name, contents: strFromU8(file) });
    } else if (paying && settings.imageQuizHtmlToAnki && isImageFile(name)) {
      this.trackInMemoryBytes(file.length);
      await this.convertAndAddImageToHTML(archiveKey, name, file);
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

  private async convertAndAddImageToHTML(
    archiveKey: string,
    name: string,
    file: Uint8Array
  ) {
    const key = `${archiveKey}\0${name}\0${createHash('sha256').update(file).digest('hex')}`;
    const readBefore = this.photosToSkipOnReopen.indexOf(key);
    if (readBefore >= 0) {
      this.photosToSkipOnReopen.splice(readBefore, 1);
      return;
    }
    const html = await convertImageToHTML(Buffer.from(file).toString('base64'));
    this.photoTexts.push({ key, html });
    console.log('Converted image to HTML:', name, html);
  }

  get combinedHTML(): string {
    return this.photoTexts.map((photo) => photo.html).join('');
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
    paying: boolean,
    settings: CardOption,
    before: ArchiveStart
  ) {
    const code = fflateErrorCode(error);
    const isDamagedData = code != null && DAMAGED_DATA_CODES.has(code);
    if (code !== FFLATE_INVALID_ZIP_DATA && !isDamagedData) {
      throw error;
    }

    // An inflate error can land after earlier passes kept some entries; the
    // fallback reads this archive again, so drop them and the memory they
    // held. The nested-zip count and the decompressed budget never rewind:
    // they are what bound the total work a crafted upload can cause. Photo
    // text already read stays: build() writes it once the whole upload is
    // read, since the fallback does not read photos again.
    this.files.length = before.fileCount;
    this.inMemoryBytes = before.inMemoryBytes;

    const skipStart = this.photosToSkipOnReopen.length;
    this.photosToSkipOnReopen.push(
      ...this.photoTexts.slice(before.photoCount).map((photo) => photo.key)
    );
    try {
      await this.recoverWithFallback(zipData, paying, settings);
    } finally {
      this.photosToSkipOnReopen.length = skipStart;
    }

    const anySupported =
      (paying && this.combinedHTML !== '') ||
      this.files.some((f) => isZipContentFileSupported(f.name));
    if (!anySupported) {
      if (this.recoveredBytes >= this.maxDecompressedBytes) {
        throw new ZipRecoveryTooLargeError();
      }
      throw new IncompleteZipError(
        isDamagedData ? DAMAGED_ZIP_MESSAGE : INCOMPLETE_ZIP_MESSAGE
      );
    }
    this.recoveredBrokenArchive = true;
  }

  // Shared by every archive in one uploaded file, like the census budget. Bytes the
  // census counted are not subtracted: they are declared sizes of the same
  // archive being recovered, and would refuse a legitimate large export.
  private remainingRecoveryBudget(): RecoveryBudget {
    this.recoveryStartedAt ??= Date.now();
    const budget = {
      maxBytes: this.maxDecompressedBytes - this.recoveredBytes,
      maxTextBytes: this.maxInMemoryBytes - this.inMemoryBytes,
      timeoutMs: MAX_RECOVERY_MS - (Date.now() - this.recoveryStartedAt),
    };
    if (
      budget.maxBytes <= 0 ||
      budget.maxTextBytes <= 0 ||
      budget.timeoutMs <= 0
    ) {
      throw new ZipRecoveryTooLargeError();
    }
    return budget;
  }

  // Spent in full, so a refused recovery cannot be repeated by the next
  // archive and the file ends with the too-large message if nothing is left.
  private refuseRecovery(): ZipRecoveryTooLargeError {
    this.recoveredBytes = this.maxDecompressedBytes;
    return new ZipRecoveryTooLargeError();
  }

  private async readRecoveredArchive(zipData: Uint8Array, paying: boolean) {
    try {
      return await processAndPrepareArchiveData(
        zipData,
        paying,
        this.remainingRecoveryBudget()
      );
    } catch (error: unknown) {
      if (error instanceof ZipRecoveryTooLargeError)
        throw this.refuseRecovery();
      throw error;
    }
  }

  // Charged before any nested zip opens, so it sees what is really left.
  private chargeRecoveredFiles(files: { size?: number; contents?: unknown }[]) {
    for (const file of files) {
      // A file with a size is still on disk; reading it here would load it.
      const contents = file.size == null ? file.contents : undefined;
      const textBytes = typeof contents === 'string' ? contents.length : 0;
      this.recoveredBytes += file.size ?? textBytes;
      this.inMemoryBytes += textBytes;
    }
    if (
      this.recoveredBytes > this.maxDecompressedBytes ||
      this.inMemoryBytes > this.maxInMemoryBytes
    ) {
      throw this.refuseRecovery();
    }
  }

  private async recoverWithFallback(
    zipData: Uint8Array,
    paying: boolean,
    settings: CardOption
  ) {
    const foundFiles = await this.readRecoveredArchive(zipData, paying);
    this.chargeRecoveredFiles(foundFiles);
    console.log('Processed files using fallback method:');
    for (const file of foundFiles) {
      const nestedZip =
        /\.zip$/i.test(file.name) && this.zipFileCount < this.maxZipFiles
          ? file.contents
          : undefined;
      if (nestedZip instanceof Uint8Array) {
        // bsdtar reads sequentially and often recovers a nested export part
        // intact even when the outer archive is truncated. Recurse so its
        // pages convert; a nested part that is itself truncated fails its own
        // fallback below and is skipped rather than aborting the recovery.
        this.zipFileCount++;
        try {
          await this.processZip(nestedZip, paying, settings);
        } catch {
          console.warn('Recovered nested zip was itself unreadable, skipping');
        }
        continue;
      }
      this.files.push(file);
    }
  }

  getFileNames() {
    return this.files.map((file) => file.name);
  }
}

export {
  ZipHandler,
  File,
  IncompleteZipError,
  INCOMPLETE_ZIP_MESSAGE,
  DAMAGED_ZIP_MESSAGE,
  MAX_IN_MEMORY_BYTES,
  MAX_EXTRACTED_BYTES,
  MAX_BATCH_EXTRACT_BYTES,
};
