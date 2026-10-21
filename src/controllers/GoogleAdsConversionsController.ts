import type express from 'express';

import { BuildGoogleAdsClickConversionsCsvUseCase } from '../usecases/googleAds/BuildGoogleAdsClickConversionsCsvUseCase';

export class GoogleAdsConversionsController {
  constructor(
    private readonly useCase: BuildGoogleAdsClickConversionsCsvUseCase
  ) {}

  async getClickConversionsCsv(
    _req: express.Request,
    res: express.Response
  ): Promise<void> {
    const csv = await this.useCase.execute();
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.set(
      'Content-Disposition',
      'attachment; filename="2anki-google-ads-offline-conversions.csv"'
    );
    res.status(200).send(csv);
  }
}

export default GoogleAdsConversionsController;
