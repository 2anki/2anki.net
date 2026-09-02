import type {
  PassPriceKind,
  PricingService,
  ResolvedPassPrice,
} from '../../services/PricingService';

export interface PassPriceView {
  amount: number;
  currency: string;
  display: string;
}

export interface PassPricingResponse {
  passes: Partial<Record<PassPriceKind, PassPriceView>>;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  usd: '$',
  eur: '€',
  gbp: '£',
};

const symbolFor = (currency: string): string =>
  CURRENCY_SYMBOLS[currency.toLowerCase()] ?? `${currency.toUpperCase()} `;

const formatDisplay = (amount: number, currency: string): string => {
  const dollars = amount / 100;
  const rendered = amount % 100 === 0 ? String(dollars) : dollars.toFixed(2);
  return `${symbolFor(currency)}${rendered}`;
};

export class GetPassPricingUseCase {
  constructor(private readonly pricingService: PricingService) {}

  async execute(): Promise<PassPricingResponse> {
    const resolved = await this.pricingService.resolveAll();
    const passes: PassPricingResponse['passes'] = {};

    for (const record of resolved) {
      const view = this.toView(record);
      if (view != null) {
        passes[record.kind] = view;
      }
    }

    return { passes };
  }

  private toView(record: ResolvedPassPrice): PassPriceView | null {
    if (record.amount == null || record.currency == null) {
      return null;
    }
    return {
      amount: record.amount,
      currency: record.currency,
      display: formatDisplay(record.amount, record.currency),
    };
  }
}
