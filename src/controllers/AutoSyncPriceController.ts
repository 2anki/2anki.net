import { Request, Response } from 'express';
import type { GetAutoSyncPriceUseCase } from '../usecases/checkout/GetAutoSyncPriceUseCase';

const CACHE_CONTROL = 'public, max-age=300';

class AutoSyncPriceController {
  constructor(private readonly useCase: GetAutoSyncPriceUseCase) {}

  async getPrice(_req: Request, res: Response): Promise<void> {
    const price = await this.useCase.execute();
    if (price == null) {
      res.status(404).json({ message: 'Auto Sync is not available' });
      return;
    }
    res.set('Cache-Control', CACHE_CONTROL);
    res.json(price);
  }
}

export default AutoSyncPriceController;
