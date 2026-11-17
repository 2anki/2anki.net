import type { Request, Response } from 'express';

const CACHE_CONTROL = 'public, max-age=60';

export interface LandingConfigResponse {
  showPassPrices: boolean;
}

// The current web app no longer asks; a tab loaded before pass prices stopped
// being flagged still does, and hides them unless the answer says to show.
class LandingConfigController {
  getConfig(_req: Request, res: Response): void {
    const body: LandingConfigResponse = { showPassPrices: true };
    res.set('Cache-Control', CACHE_CONTROL);
    res.status(200).json(body);
  }
}

export default LandingConfigController;
