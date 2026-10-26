import express from 'express';

import { getDatabase } from '../data_layer';
import { GoogleAdsConversionsRepository } from '../data_layer/GoogleAdsConversionsRepository';
import { BuildGoogleAdsClickConversionsCsvUseCase } from '../usecases/googleAds/BuildGoogleAdsClickConversionsCsvUseCase';
import { GoogleAdsConversionsController } from '../controllers/GoogleAdsConversionsController';
import { requireGoogleAdsCsvAuth } from './middleware/RequireGoogleAdsCsvAuth';
import { ipRateLimit } from './middleware/ipRateLimit';

const REQUESTS_PER_MINUTE = 10;

const GoogleAdsConversionsRouter = () => {
  const router = express.Router();
  const database = getDatabase();
  const controller = new GoogleAdsConversionsController(
    new BuildGoogleAdsClickConversionsCsvUseCase(
      new GoogleAdsConversionsRepository(database)
    )
  );

  router.get(
    '/api/google-ads/offline-conversions.csv',
    ipRateLimit(REQUESTS_PER_MINUTE),
    requireGoogleAdsCsvAuth,
    (req, res) => controller.getClickConversionsCsv(req, res)
  );

  return router;
};

export default GoogleAdsConversionsRouter;
