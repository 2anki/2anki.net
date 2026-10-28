import type { Request, Response } from 'express';
import { getFeatureFlag } from '../lib/featureFlags/getFeatureFlag';
import {
  NATIVE_CARD_LIMIT_DEFAULT,
  NATIVE_CARD_LIMIT_FLAG,
} from '../lib/featureFlags/nativeCardLimit';
import { ANONYMOUS_CARD_CAP, MONTHLY_CARD_LIMIT } from '../lib/limits';

const CACHE_CONTROL = 'public, max-age=60';

export interface NativeConfigResponse {
  cardLimitEnabled: boolean;
  monthlyCardLimit: number;
  previewCardCount: number;
}

// Public config for the native app. No session: signed-out app users are
// capped too, and none of these values is per-user. The caps come from the
// same constants the web enforces, so the app never hardcodes them.
class NativeConfigController {
  async getConfig(_req: Request, res: Response): Promise<void> {
    const cardLimitEnabled = await getFeatureFlag(
      NATIVE_CARD_LIMIT_FLAG,
      NATIVE_CARD_LIMIT_DEFAULT
    );
    const body: NativeConfigResponse = {
      cardLimitEnabled,
      monthlyCardLimit: MONTHLY_CARD_LIMIT,
      previewCardCount: ANONYMOUS_CARD_CAP,
    };
    res.set('Cache-Control', CACHE_CONTROL);
    res.status(200).json(body);
  }
}

export default NativeConfigController;
