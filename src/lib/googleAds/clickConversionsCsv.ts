export const GOOGLE_ADS_CONVERSION_NAME = 'Purchase (server)';

export interface GoogleAdsClickConversion {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  orderId: string;
  valueCents: number;
  currency: string;
  conversionTime: Date;
}

const PARAMETERS_LINE = 'Parameters:TimeZone=+0000';

const HEADER_LINE = [
  'Google Click ID',
  'GBRAID',
  'WBRAID',
  'Conversion Name',
  'Conversion Time',
  'Conversion Value',
  'Conversion Currency',
  'Order ID',
].join(',');

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatConversionTime(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

// Google accepts exactly one of Google Click ID / GBRAID / WBRAID per row, with
// gclid the richest signal, so prefer it and fall back in that order.
function clickIdColumns(
  conversion: GoogleAdsClickConversion
): [string, string, string] | null {
  if (conversion.gclid != null && conversion.gclid !== '') {
    return [conversion.gclid, '', ''];
  }
  if (conversion.gbraid != null && conversion.gbraid !== '') {
    return ['', conversion.gbraid, ''];
  }
  if (conversion.wbraid != null && conversion.wbraid !== '') {
    return ['', '', conversion.wbraid];
  }
  return null;
}

function toRow(conversion: GoogleAdsClickConversion): string | null {
  const clickId = clickIdColumns(conversion);
  if (clickId == null) {
    return null;
  }
  if (!Number.isFinite(conversion.valueCents) || conversion.valueCents < 0) {
    return null;
  }
  const [gclid, gbraid, wbraid] = clickId;
  return [
    gclid,
    gbraid,
    wbraid,
    GOOGLE_ADS_CONVERSION_NAME,
    formatConversionTime(conversion.conversionTime),
    (conversion.valueCents / 100).toFixed(2),
    conversion.currency.toUpperCase(),
    conversion.orderId,
  ]
    .map(escapeCsvField)
    .join(',');
}

export function buildClickConversionsCsv(
  conversions: GoogleAdsClickConversion[]
): string {
  const rows = conversions
    .map(toRow)
    .filter((row): row is string => row != null);
  return [PARAMETERS_LINE, HEADER_LINE, ...rows].join('\n') + '\n';
}
