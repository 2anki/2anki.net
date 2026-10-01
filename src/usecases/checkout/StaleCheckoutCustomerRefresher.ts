import type { StripeCustomerResolver } from '../../services/StripeCustomerResolver';
import type { RecoverStaleCustomer } from './createCheckoutSession';

export interface CheckoutCustomerRefresher {
  refresh(
    userId: number,
    email: string,
    staleCustomerId: string
  ): Promise<string>;
}

export const recoverWith = (
  refresher: CheckoutCustomerRefresher | undefined,
  userId: number | undefined,
  email: string | undefined
): RecoverStaleCustomer | undefined => {
  if (refresher == null || userId == null || email == null || email === '') {
    return undefined;
  }
  return (staleCustomerId: string) =>
    refresher.refresh(userId, email, staleCustomerId);
};

export interface StaleCustomerStore {
  clearStripeCustomerIdIf(id: string | number, oldValue: string): Promise<void>;
}

export class StaleCheckoutCustomerRefresher implements CheckoutCustomerRefresher {
  constructor(
    private readonly store: StaleCustomerStore,
    private readonly resolver: Pick<StripeCustomerResolver, 'resolveOrCreate'>
  ) {}

  async refresh(
    userId: number,
    email: string,
    staleCustomerId: string
  ): Promise<string> {
    await this.store.clearStripeCustomerIdIf(userId, staleCustomerId);
    return this.resolver.resolveOrCreate(userId, email);
  }
}
