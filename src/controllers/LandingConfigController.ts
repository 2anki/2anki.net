import type { Request, Response } from 'express';
import { getFeatureFlag } from '../lib/featureFlags/getFeatureFlag';
import { LANDING_PASS_PRICES_FLAG } from '../lib/featureFlags/landingPassPrices';

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
    res.status(200).json(body);
  }
}

export default LandingConfigController;
