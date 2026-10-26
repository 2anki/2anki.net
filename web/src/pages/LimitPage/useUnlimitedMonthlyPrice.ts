import { useEffect, useState } from 'react';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { formatMonthly } from '../PricingPage/pricing.constants';

export function useUnlimitedMonthlyPrice(enabled: boolean): string | undefined {
  const [price, setPrice] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    get2ankiApi()
      .getCheckoutPrices()
      .then((result) => {
        if (!cancelled && result != null) {
          setPrice(formatMonthly(result.monthly.cents));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return enabled ? price : undefined;
}
