import { AsyncLocalStorage } from 'node:async_hooks';

// Which gift grant pays for the Claude call running in this async context.
// The spend guard opens the context when it admits a call on gift credits, and
// recordClaudeUsage stamps the grant id on the ai_usage_recorded event, so
// gift spend is read back from the usage ledger by grant id and never counted
// against a plan allowance.
const giftFunding = new AsyncLocalStorage<{ giftId: number }>();

export function runOnGiftCredits<T>(
  giftId: number,
  run: () => Promise<T>
): Promise<T> {
  return giftFunding.run({ giftId }, run);
}

export function currentGiftId(): number | null {
  return giftFunding.getStore()?.giftId ?? null;
}
