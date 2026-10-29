import { forgetLastDeck } from './upload/lastDeck';

const PASS_TOKEN_KEY = '2anki_pass_token';

export function getStoredPassToken(): string | null {
  return globalThis.localStorage?.getItem(PASS_TOKEN_KEY) ?? null;
}

export function storePassToken(sessionId: string): void {
  globalThis.localStorage?.setItem(PASS_TOKEN_KEY, sessionId);
}

export function storedCardOptions(): Record<string, string> {
  const storage = globalThis.localStorage;
  if (storage == null) return {};
  return Object.fromEntries(
    Object.entries(storage).filter(
      (entry): entry is [string, string] =>
        entry[0] !== PASS_TOKEN_KEY && typeof entry[1] === 'string'
    )
  );
}

export function clearPassToken(): void {
  globalThis.localStorage?.removeItem(PASS_TOKEN_KEY);
  void forgetLastDeck();
}
