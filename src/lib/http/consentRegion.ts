export type ConsentRegion = 'eea' | 'other';

// EU 27 + EEA (IS, LI, NO) + UK + Switzerland: where a cookie banner with a
// real choice is required before marketing or analytics cookies are set.
const CONSENT_REQUIRED_COUNTRIES: ReadonlySet<string> = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'IS',
  'LI',
  'NO',
  'GB',
  'CH',
]);

/**
 * Unknown country → treat as EEA. Showing the banner to someone who did not
 * need it costs a click; skipping it for someone who did is a violation.
 */
export function consentRegionFor(country: string | null): ConsentRegion {
  if (country == null || country.length === 0) {
    return 'eea';
  }
  return CONSENT_REQUIRED_COUNTRIES.has(country.toUpperCase())
    ? 'eea'
    : 'other';
}
