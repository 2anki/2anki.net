import type { Request, Response } from 'express';
import { getFeatureFlag } from '../lib/featureFlags/getFeatureFlag';
import { LANDING_PASS_PRICES_FLAG } from '../lib/featureFlags/landingPassPrices';

const CACHE_CONTROL = 'public, max-age=60';

export interface LandingConfigResponse {
  showPassPrices: boolean;
}

class LandingConfigController {
  async getConfig(_req: Request, res: Response): Promise<void> {
    const showPassPrices = await getFeatureFlag(
      LANDING_PASS_PRICES_FLAG,
      false
    );
    const body: LandingConfigResponse = { showPassPrices };
    res.set('Cache-Control', CACHE_CONTROL);
    res.status(200).json(body);
  }
}

export default LandingConfigController;
