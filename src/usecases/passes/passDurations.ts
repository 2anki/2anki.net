export type AnonymousPassKind = '24h' | '7d';

export const PASS_DURATION_MS: Record<AnonymousPassKind, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export const PASS_CLAIM_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function isAnonymousPassKind(kind: string): kind is AnonymousPassKind {
  return kind === '24h' || kind === '7d';
}
