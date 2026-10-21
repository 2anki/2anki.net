import { IGoogleAdsConversionsRepository } from '../../data_layer/GoogleAdsConversionsRepository';
import { buildClickConversionsCsv } from '../../lib/googleAds/clickConversionsCsv';

const CONVERSION_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export class BuildGoogleAdsClickConversionsCsvUseCase {
  constructor(
    private readonly repository: IGoogleAdsConversionsRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(): Promise<string> {
    const since = new Date(
      this.now().getTime() - CONVERSION_WINDOW_DAYS * DAY_MS
    );
    const conversions = await this.repository.listClickConversions(since);
    return buildClickConversionsCsv(conversions);
  }
}

export default BuildGoogleAdsClickConversionsCsvUseCase;
