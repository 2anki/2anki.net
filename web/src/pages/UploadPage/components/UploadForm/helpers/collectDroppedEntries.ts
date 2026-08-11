export interface DroppedFile {
  path: string;
  file: File;
}

export const MAX_FOLDER_TOTAL_BYTES = 500 * 1024 * 1024;
const MAX_DEPTH = 20;
const MAX_FILE_COUNT = 2000;

export class FolderTooBigError extends Error {
  constructor() {
    super('Dropped folder exceeds the packaging size cap');
    this.name = 'FolderTooBigError';
  }
}

export class FolderEmptyError extends Error {
  constructor() {
    super('Dropped folder holds no uploadable files');
    this.name = 'FolderEmptyError';
  }
}

export class FolderTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FolderTraversalError';
  }
}

function shouldSkip(name: string): boolean {
  return name.startsWith('.') || name === '__MACOSX';
}

function readAllEntries(
  reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> {
  // readEntries returns results in batches and must be drained until it
  // yields an empty batch — a single call silently truncates large folders.
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

export function hasDirectoryEntry(
  entries: Array<FileSystemEntry | null>
): boolean {
  return entries.some((entry) => entry?.isDirectory === true);
}

export async function collectDroppedEntries(
  entries: Array<FileSystemEntry | null>
): Promise<DroppedFile[]> {
  const collected: DroppedFile[] = [];
  let totalBytes = 0;

  const walk = async (entry: FileSystemEntry, depth: number): Promise<void> => {
    if (shouldSkip(entry.name)) return;
    if (depth > MAX_DEPTH) {
      throw new FolderTraversalError('Folder is nested too deeply');
    }
    if (entry.isFile) {
      if (collected.length >= MAX_FILE_COUNT) {
        throw new FolderTraversalError('Folder holds too many files');
      }
      const file = await entryFile(entry as FileSystemFileEntry);
      totalBytes += file.size;
      if (totalBytes > MAX_FOLDER_TOTAL_BYTES) {
        throw new FolderTooBigError();
      }
      collected.push({
        path: entry.fullPath.replace(/^\//, ''),
        file,
      });
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const children = await readAllEntries(reader);
      for (const child of children) {
        await walk(child, depth + 1);
      }
    }
  };

  for (const entry of entries) {
    if (entry != null) {
      await walk(entry, 0);
    }
  }

  if (collected.length === 0) {
    throw new FolderEmptyError();
  }
  return collected;
}
