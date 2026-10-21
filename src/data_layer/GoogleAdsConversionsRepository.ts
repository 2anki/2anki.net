import type { Knex } from 'knex';

import { GoogleAdsClickConversion } from '../lib/googleAds/clickConversionsCsv';

export interface GoogleAdsConversionRow {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  order_id: string | null;
  value_cents: string | null;
  currency: string | null;
  created_at: Date | string;
}

export interface IGoogleAdsConversionsRepository {
  listClickConversions(since: Date): Promise<GoogleAdsClickConversion[]>;
}

export function mapClickConversionRow(
  row: GoogleAdsConversionRow
): GoogleAdsClickConversion | null {
  const hasClickId =
    row.gclid != null || row.gbraid != null || row.wbraid != null;
  if (!hasClickId || row.order_id == null || row.currency == null) {
    return null;
  }
  const valueCents = Number(row.value_cents);
  if (!Number.isFinite(valueCents)) {
    return null;
  }
  return {
    gclid: row.gclid,
    gbraid: row.gbraid,
    wbraid: row.wbraid,
    orderId: row.order_id,
    valueCents,
    currency: row.currency,
    conversionTime:
      row.created_at instanceof Date
        ? row.created_at
        : new Date(row.created_at),
  };
}

export class GoogleAdsConversionsRepository implements IGoogleAdsConversionsRepository {
  private readonly table = 'events';

  constructor(private readonly database: Knex) {}

  buildClickConversionsQuery(since: Date): Knex.QueryBuilder {
    return this.database(this.table)
      .select(
        this.database.raw("props->>'gclid' as gclid"),
        this.database.raw("props->>'gbraid' as gbraid"),
        this.database.raw("props->>'wbraid' as wbraid"),
        this.database.raw("props->>'order_id' as order_id"),
        this.database.raw("props->>'value_cents' as value_cents"),
        this.database.raw("props->>'currency' as currency"),
        'created_at'
      )
      .where('name', 'checkout_completed')
      .where('created_at', '>=', since)
      .where((qb) =>
        qb
          .whereRaw("props->>'gclid' is not null")
          .orWhereRaw("props->>'gbraid' is not null")
          .orWhereRaw("props->>'wbraid' is not null")
      )
      .whereRaw("props->>'order_id' is not null")
      .whereRaw("props->>'value_cents' is not null")
      .whereRaw("props->>'currency' is not null")
      .orderBy('created_at', 'asc');
  }

  async listClickConversions(since: Date): Promise<GoogleAdsClickConversion[]> {
    const rows = (await this.buildClickConversionsQuery(
      since
    )) as GoogleAdsConversionRow[];
    return rows
      .map(mapClickConversionRow)
      .filter((row): row is GoogleAdsClickConversion => row != null);
  }
}

export default GoogleAdsConversionsRepository;
