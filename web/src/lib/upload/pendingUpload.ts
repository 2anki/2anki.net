// An upload the browser sent but never got an answer for. It is kept on this
// device only, so a refresh, a closed tab or a lost connection can hand the
// same files back with one click instead of a trip to the file picker. It is
// cleared as soon as the server answers and on logout, offered only to the
// same account (or the same signed-out visitor) that sent it, and ignored
// once it is a day old.

export interface PendingUpload {
  files: File[];
  filename: string;
  sizeBytes: number;
  submittedAt: number;
  recoveryToken: string | null;
  ownerId: number | null;
  pdfPageRange: string | null;
  aiFlag: string | null;
  // Sent by a Claude button, so a resume asks for Claude again with two pages
  // make one card off. Saves from before this field read as not one.
  claudeResend?: boolean;
}

export interface PendingUploadStore {
  save(upload: PendingUpload): Promise<void>;
  load(): Promise<PendingUpload | null>;
  clear(): Promise<void>;
}

export const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const PENDING_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

const DB_NAME = '2anki-pending-upload';
const STORE_NAME = 'upload';
const RECORD_KEY = 'current';

export function withinStorableSize(files: File[]): File[] {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  return total <= PENDING_UPLOAD_MAX_BYTES ? files : [];
}

function isFresh(upload: PendingUpload, now: number): boolean {
  return now - upload.submittedAt < PENDING_UPLOAD_TTL_MS;
}

export function createMemoryPendingUploadStore(
  now: () => number = Date.now
): PendingUploadStore {
  let current: PendingUpload | null = null;
  return {
    save: async (upload) => {
      current = upload;
    },
    load: async () => {
      if (current != null && !isFresh(current, now())) current = null;
      return current;
    },
    clear: async () => {
      current = null;
    },
  };
}

// A database left without its store (an interrupted first open, another tab
// on an older shape) is upgraded one version to add it, rather than failing
// every save from then on.
function openDatabase(
  factory: IDBFactory,
  version?: number
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      settled = true;
      reject(error);
    };
    const request =
      version == null ? factory.open(DB_NAME) : factory.open(DB_NAME, version);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      if (db.objectStoreNames.contains(STORE_NAME)) {
        resolve(db);
        return;
      }
      const nextVersion = db.version + 1;
      db.close();
      openDatabase(factory, nextVersion).then(resolve, reject);
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new Error('pending upload store blocked'));
  });
}

function runRequest<T>(
  factory: IDBFactory,
  mode: IDBTransactionMode,
  operate: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDatabase(factory).then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = operate(transaction.objectStore(STORE_NAME));
        transaction.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      })
  );
}

export function createIndexedDbPendingUploadStore(
  factory: IDBFactory,
  now: () => number = Date.now
): PendingUploadStore {
  return {
    save: async (upload) => {
      await runRequest(factory, 'readwrite', (store) =>
        store.put(upload, RECORD_KEY)
      );
    },
    load: async () => {
      const upload = (await runRequest(factory, 'readonly', (store) =>
        store.get(RECORD_KEY)
      )) as PendingUpload | undefined;
      if (upload == null) return null;
      if (isFresh(upload, now())) return upload;
      await runRequest(factory, 'readwrite', (store) =>
        store.delete(RECORD_KEY)
      );
      return null;
    },
    clear: async () => {
      await runRequest(factory, 'readwrite', (store) =>
        store.delete(RECORD_KEY)
      );
    },
  };
}

// Storage that can refuse (private mode, a full disk) must never break an
// upload, so every failure reads as "nothing pending". Each call opens its
// own transaction, so they run one after another: a clear sent after a save
// must not land first and leave the save behind.
function quietAndInOrder(store: PendingUploadStore): PendingUploadStore {
  let tail: Promise<unknown> = Promise.resolve();
  const inOrder = <T>(operation: () => Promise<T>, fallback: T): Promise<T> => {
    const next = tail.then(operation).catch(() => fallback);
    tail = next;
    return next;
  };
  return {
    save: (upload) => inOrder(() => store.save(upload), undefined),
    load: () => inOrder(() => store.load(), null),
    clear: () => inOrder(() => store.clear(), undefined),
  };
}

let defaultStore: PendingUploadStore | null = null;

export function getPendingUploadStore(): PendingUploadStore {
  if (defaultStore == null) {
    const factory = globalThis.indexedDB;
    defaultStore = quietAndInOrder(
      factory == null
        ? createMemoryPendingUploadStore()
        : createIndexedDbPendingUploadStore(factory)
    );
  }
  return defaultStore;
}

// Logout and account deletion must not wait on a browser store that never
// answers: they move on after a short wait either way.
export function forgetPendingUpload(waitMs = 500): Promise<void> {
  return Promise.race([
    getPendingUploadStore().clear(),
    new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
  ]);
}

export function resetPendingUploadStoreForTests(): void {
  defaultStore = null;
}
