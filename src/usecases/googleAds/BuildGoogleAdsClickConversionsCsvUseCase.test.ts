import { BuildGoogleAdsClickConversionsCsvUseCase } from './BuildGoogleAdsClickConversionsCsvUseCase';
import { GoogleAdsClickConversion } from '../../lib/googleAds/clickConversionsCsv';

describe('BuildGoogleAdsClickConversionsCsvUseCase', () => {
  const now = new Date('2026-10-21T00:00:00.000Z');

  function makeRepository(conversions: GoogleAdsClickConversion[]) {
    const listClickConversions = vi.fn().mockResolvedValue(conversions);
    return { repository: { listClickConversions }, listClickConversions };
  }

  it('asks the repository for conversions from the last 90 days', async () => {
    const { repository, listClickConversions } = makeRepository([]);
    const useCase = new BuildGoogleAdsClickConversionsCsvUseCase(
      repository,
      () => now
    );

    await useCase.execute();

    const since = listClickConversions.mock.calls[0][0] as Date;
    expect(since).toEqual(new Date('2026-07-23T00:00:00.000Z'));
  });

  it('returns a CSV built from the repository rows', async () => {
    const { repository } = makeRepository([
      {
        gclid: 'Cj0abc',
        gbraid: null,
        wbraid: null,
        orderId: 'cs_1',
        valueCents: 600,
        currency: 'usd',
        conversionTime: new Date('2026-10-20T10:00:00.000Z'),
      },
    ]);
    const useCase = new BuildGoogleAdsClickConversionsCsvUseCase(
      repository,
      () => now
    );

    const csv = await useCase.execute();

    expect(csv.split('\n')[0]).toBe('Parameters:TimeZone=+0000');
    expect(csv).toContain('Cj0abc,,,Purchase (server),2026-10-20 10:00:00');
    expect(csv).toContain('6.00,USD,cs_1');
  });
});
