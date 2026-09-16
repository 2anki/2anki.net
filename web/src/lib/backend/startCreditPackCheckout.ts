import { get2ankiApi } from './get2ankiApi';

export type StartCreditPackCheckoutOutcome =
  | 'redirecting'
  | 'unavailable'
  | 'error';

export async function startCreditPackCheckout(
  source: string
): Promise<StartCreditPackCheckoutOutcome> {
  const result = await get2ankiApi().startCreditPackCheckout(source);
  if ('url' in result) {
    globalThis.location.href = result.url;
    return 'redirecting';
  }
  return result.status;
}
