import { runRequest } from '../upload/pendingUpload';

// The file a signed-out visitor dropped on the AI card, kept on this device
// while they sign up. Google and the email form both leave the page, and a
// File does not survive that, so it waits in the browser's own store, the one
// the upload page already uses to hand back an interrupted upload. It is
// handed back only in the tab that started the sign-up, only within the hour,
// and once.
export const HELD_GIFT_FILE_TTL_MS = 60 * 60 * 1000;
export const HELD_GIFT_SIGNUP_KEY = '2anki-ai-gift-signup';

const RECORD_KEY = 'ai-gift-file';

interface HeldRecord {
  files: File[];
  savedAt: number;
}

export interface HeldGiftFileStore {
  save(files: File[]): Promise<void>;
  take(): Promise<File[] | null>;
}

interface RecordStore {
  put(record: HeldRecord): Promise<void>;
  get(): Promise<HeldRecord | null>;
  remove(): Promise<void>;
}

function memoryRecords(): RecordStore {
  let current: HeldRecord | null = null;
  return {
    put: async (record) => {
      current = record;
    },
    get: async () => current,
    remove: async () => {
      current = null;
    },
  };
}

function indexedDbRecords(factory: IDBFactory): RecordStore {
  return {
    put: async (record) => {
      await runRequest(factory, 'readwrite', (store) =>
        store.put(record, RECORD_KEY)
      );
    },
    get: async () =>
      ((await runRequest(factory, 'readonly', (store) =>
        store.get(RECORD_KEY)
      )) as HeldRecord | undefined) ?? null,
    remove: async () => {
      await runRequest(factory, 'readwrite', (store) =>
        store.delete(RECORD_KEY)
      );
    },
  };
}

function session(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function createHeldGiftFileStore(
  records: RecordStore,
  now: () => number = Date.now
): HeldGiftFileStore {
  return {
    save: async (files) => {
      session()?.setItem(HELD_GIFT_SIGNUP_KEY, '1');
      try {
        await records.put({ files, savedAt: now() });
      } catch {
        session()?.removeItem(HELD_GIFT_SIGNUP_KEY);
      }
    },
    take: async () => {
      if (session()?.getItem(HELD_GIFT_SIGNUP_KEY) == null) return null;
      session()?.removeItem(HELD_GIFT_SIGNUP_KEY);
      try {
        const record = await records.get();
        await records.remove();
        if (record == null || now() - record.savedAt > HELD_GIFT_FILE_TTL_MS) {
          return null;
        }
        return record.files.length > 0 ? record.files : null;
      } catch {
        return null;
      }
    },
  };
}

export function createMemoryHeldGiftFileStore(
  now: () => number = Date.now
): HeldGiftFileStore {
  return createHeldGiftFileStore(memoryRecords(), now);
}

let defaultStore: HeldGiftFileStore | null = null;

export function getHeldGiftFileStore(): HeldGiftFileStore {
  if (defaultStore == null) {
    const factory = globalThis.indexedDB;
    defaultStore = createHeldGiftFileStore(
      factory == null ? memoryRecords() : indexedDbRecords(factory)
    );
  }
  return defaultStore;
}
