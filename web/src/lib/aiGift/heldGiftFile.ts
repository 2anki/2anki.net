import { runRequest, withinStorableSize } from '../upload/pendingUpload';

// The file a signed-out visitor dropped on the AI card, kept on this device
// while they sign up. Google and the email form both leave the page, and a
// File does not survive that, so it waits in the browser's own store, the one
// the upload page already uses to hand back an interrupted upload. It is
// handed back once, within the hour, only to the tab that dropped it (a token
// in that tab's session storage must match), and deleted once taken or
// expired.
export const HELD_GIFT_FILE_TTL_MS = 60 * 60 * 1000;
export const HELD_GIFT_SIGNUP_KEY = '2anki-ai-gift-signup';

const RECORD_KEY = 'ai-gift-file';

interface HeldRecord {
  files: File[];
  savedAt: number;
  token: string;
}

export interface HeldGiftFileStore {
  save(files: File[]): Promise<boolean>;
  take(): Promise<File[] | null>;
}

export interface RecordStore {
  durable: boolean;
  put(record: HeldRecord): Promise<void>;
  get(): Promise<HeldRecord | null>;
  remove(): Promise<void>;
}

export function memoryRecords(durable: boolean): RecordStore {
  let current: HeldRecord | null = null;
  return {
    durable,
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
    durable: true,
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

function newToken(): string {
  return globalThis.crypto.randomUUID();
}

export function createHeldGiftFileStore(
  records: RecordStore,
  now: () => number = Date.now
): HeldGiftFileStore {
  return {
    // True only when the file is in a store that outlives the sign-up's page
    // load; the card says the file is kept only then.
    save: async (files) => {
      const tab = session();
      if (!records.durable || tab == null) return false;
      if (withinStorableSize(files).length === 0) return false;
      const token = newToken();
      try {
        await records.put({ files, savedAt: now(), token });
        tab.setItem(HELD_GIFT_SIGNUP_KEY, token);
        return true;
      } catch {
        return false;
      }
    },
    take: async () => {
      const tab = session();
      const token = tab?.getItem(HELD_GIFT_SIGNUP_KEY) ?? null;
      try {
        const record = await records.get();
        if (record == null) {
          tab?.removeItem(HELD_GIFT_SIGNUP_KEY);
          return null;
        }
        const expired = now() - record.savedAt > HELD_GIFT_FILE_TTL_MS;
        const ours = token != null && record.token === token;
        if (expired || ours) {
          await records.remove();
        }
        if (ours) tab?.removeItem(HELD_GIFT_SIGNUP_KEY);
        if (!ours || expired) return null;
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
  return createHeldGiftFileStore(memoryRecords(true), now);
}

let defaultStore: HeldGiftFileStore | null = null;

export function getHeldGiftFileStore(): HeldGiftFileStore {
  if (defaultStore == null) {
    const factory = globalThis.indexedDB;
    defaultStore = createHeldGiftFileStore(
      factory == null ? memoryRecords(false) : indexedDbRecords(factory)
    );
  }
  return defaultStore;
}
