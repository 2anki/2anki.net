import {
  buildClickConversionsCsv,
  GoogleAdsClickConversion,
  GOOGLE_ADS_CONVERSION_NAME,
} from './clickConversionsCsv';

function conversion(
  overrides: Partial<GoogleAdsClickConversion> = {}
): GoogleAdsClickConversion {
  return {
    gclid: 'Cj0abc',
    gbraid: null,
    wbraid: null,
    orderId: 'cs_test_123',
    valueCents: 600,
    currency: 'usd',
    conversionTime: new Date('2026-10-21T14:05:09.000Z'),
    ...overrides,
  };
}

describe('buildClickConversionsCsv', () => {
  it('starts with the UTC time-zone parameter line and the Google header row', () => {
    const csv = buildClickConversionsCsv([]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Parameters:TimeZone=+0000');
    expect(lines[1]).toBe(
      'Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID'
    );
  });

  it('emits only the headers when there are no conversions', () => {
    expect(buildClickConversionsCsv([])).toBe(
      'Parameters:TimeZone=+0000\n' +
        'Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID\n'
    );
  });

  it('writes a gclid row with value in major units, uppercase currency and session id as order id', () => {
    const csv = buildClickConversionsCsv([conversion()]);
    const dataLine = csv.split('\n')[2];
    expect(dataLine).toBe(
      `Cj0abc,,,${GOOGLE_ADS_CONVERSION_NAME},2026-10-21 14:05:09,6.00,USD,cs_test_123`
    );
  });

  it('places a gbraid id in the GBRAID column and leaves the others empty', () => {
    const csv = buildClickConversionsCsv([
      conversion({ gclid: null, gbraid: 'gb_123' }),
    ]);
    const dataLine = csv.split('\n')[2];
    expect(dataLine.startsWith(',gb_123,,')).toBe(true);
  });

  it('places a wbraid id in the WBRAID column and leaves the others empty', () => {
    const csv = buildClickConversionsCsv([
      conversion({ gclid: null, wbraid: 'wb_123' }),
    ]);
    const dataLine = csv.split('\n')[2];
    expect(dataLine.startsWith(',,wb_123,')).toBe(true);
  });

  it('prefers gclid over gbraid and wbraid when more than one is present', () => {
    const csv = buildClickConversionsCsv([
      conversion({ gclid: 'g', gbraid: 'gb', wbraid: 'wb' }),
    ]);
    const dataLine = csv.split('\n')[2];
    expect(dataLine.startsWith('g,,,')).toBe(true);
  });

  it('drops a conversion that carries no click id', () => {
    const csv = buildClickConversionsCsv([
      conversion({ gclid: null, gbraid: null, wbraid: null }),
    ]);
    expect(csv.split('\n').filter((line) => line.length > 0)).toHaveLength(2);
  });

  it('drops a conversion with a negative or non-finite value', () => {
    const csv = buildClickConversionsCsv([
      conversion({ valueCents: -1 }),
      conversion({ valueCents: Number.NaN }),
    ]);
    expect(csv.split('\n').filter((line) => line.length > 0)).toHaveLength(2);
  });

  it('keeps a zero-value conversion', () => {
    const csv = buildClickConversionsCsv([conversion({ valueCents: 0 })]);
    const dataLine = csv.split('\n')[2];
    expect(dataLine).toContain(',0.00,USD,');
  });

  it('drops a row whose only click id is a spreadsheet formula', () => {
    const csv = buildClickConversionsCsv([
      conversion({ gclid: '=HYPERLINK("http://evil","x")' }),
    ]);
    expect(csv.split('\n').filter((line) => line.length > 0)).toHaveLength(2);
  });

  it('drops a row whose click id contains a comma, quote or newline', () => {
    const csv = buildClickConversionsCsv([
      conversion({ gclid: 'a,b' }),
      conversion({ gclid: 'a"b' }),
      conversion({ gclid: 'a\nb' }),
    ]);
    expect(csv.split('\n').filter((line) => line.length > 0)).toHaveLength(2);
  });

  it('falls back to a valid gbraid when the gclid fails the charset check', () => {
    const csv = buildClickConversionsCsv([
      conversion({ gclid: '=cmd', gbraid: 'gb_ok' }),
    ]);
    const dataLine = csv.split('\n')[2];
    expect(dataLine.startsWith(',gb_ok,,')).toBe(true);
  });

  it('neutralises a click id that begins with a formula trigger', () => {
    const csv = buildClickConversionsCsv([
      conversion({ gclid: '-leadingdash' }),
    ]);
    const dataLine = csv.split('\n')[2];
    expect(dataLine.startsWith("'-leadingdash,,,")).toBe(true);
  });
});
