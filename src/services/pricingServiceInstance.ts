import { PricingService } from './PricingService';
import { getStripe } from '../lib/integrations/stripe';

let instance: PricingService | null = null;

export const getPricingService = (): PricingService => {
  if (instance == null) {
    instance = new PricingService(getStripe());
  }
  return instance;
};

export const resetPricingServiceForTesting = (): void => {
  instance = null;
};
