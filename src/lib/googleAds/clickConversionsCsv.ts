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

// Click ids originate in a user-controlled cookie. Accept only the Google
// click-id charset so a hostile value (=HYPERLINK(...), embedded commas,
// quotes or newlines) is dropped rather than written to the feed.
const CLICK_ID_CHARSET = /^[A-Za-z0-9_-]+$/;

// A spreadsheet treats a cell beginning with any of these as a formula, so
// neutralise it with a leading apostrophe before quoting (OWASP CSV-injection).
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

function escapeCsvField(value: string): string {
  const neutralized = FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

function validClickId(id: string | null): string | null {
  if (id != null && CLICK_ID_CHARSET.test(id)) {
    return id;
  }
  return null;
}

function formatConversionTime(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

// Google accepts exactly one of Google Click ID / GBRAID / WBRAID per row, with
// gclid the richest signal, so prefer it and fall back in that order.
function clickIdColumns(
  conversion: GoogleAdsClickConversion
): [string, string, string] | null {
  const gclid = validClickId(conversion.gclid);
  if (gclid != null) {
    return [gclid, '', ''];
  }
  const gbraid = validClickId(conversion.gbraid);
  if (gbraid != null) {
    return ['', gbraid, ''];
  }
  const wbraid = validClickId(conversion.wbraid);
  if (wbraid != null) {
    return ['', '', wbraid];
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
  // The click ids already passed CLICK_ID_CHARSET, which leaves no room for
  // a formula or a delimiter; prefixing one that starts with "-" would make
  // Google fail to match the click.
  const rest = [
    GOOGLE_ADS_CONVERSION_NAME,
    formatConversionTime(conversion.conversionTime),
    (conversion.valueCents / 100).toFixed(2),
    conversion.currency.toUpperCase(),
    conversion.orderId,
  ].map(escapeCsvField);
  return [...clickId, ...rest].join(',');
}

export function buildClickConversionsCsv(
  conversions: GoogleAdsClickConversion[]
): string {
  const seenOrderIds = new Set<string>();
  const rows = conversions
    .filter((conversion) => {
      if (seenOrderIds.has(conversion.orderId)) {
        return false;
      }
      seenOrderIds.add(conversion.orderId);
      return true;
    })
    .map(toRow)
    .filter((row): row is string => row != null);
  return [PARAMETERS_LINE, HEADER_LINE, ...rows].join('\n') + '\n';
}
