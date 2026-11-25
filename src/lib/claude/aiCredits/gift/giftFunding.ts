import { AsyncLocalStorage } from 'node:async_hooks';

// Which gift grant pays for the Claude call running in this async context.
// The spend guard opens the context when it admits a call on gift credits, and
// recordClaudeUsage stamps the grant id on the ai_usage_recorded event, so
// gift spend is read back from the usage ledger by grant id and never counted
// against a plan allowance. onCharged runs when that stamp is written, which
// is how the grant's clock starts at its first charged call.
interface GiftFunding {
  giftId: number;
  onCharged?: () => void;
}

const giftFunding = new AsyncLocalStorage<GiftFunding>();

export function runOnGiftCredits<T>(
  giftId: number,
  run: () => Promise<T>,
  onCharged?: () => void
): Promise<T> {
  return giftFunding.run({ giftId, onCharged }, run);
}

export function currentGiftId(): number | null {
  return giftFunding.getStore()?.giftId ?? null;
}

export function noteGiftCharge(): void {
  giftFunding.getStore()?.onCharged?.();
}
