import { forgetLastDeck } from './upload/lastDeck';

const PASS_TOKEN_KEY = '2anki_pass_token';

export function getStoredPassToken(): string | null {
  return globalThis.localStorage?.getItem(PASS_TOKEN_KEY) ?? null;
}

export function storePassToken(sessionId: string): void {
  globalThis.localStorage?.setItem(PASS_TOKEN_KEY, sessionId);
}

export function clearPassToken(): void {
  globalThis.localStorage?.removeItem(PASS_TOKEN_KEY);
  void forgetLastDeck();
}
