import express from 'express';
import type { SendConfirmEmailNoticesUseCase } from '../usecases/ops/SendConfirmEmailNoticesUseCase';

class OpsConfirmEmailNoticesController {
  constructor(private readonly useCase: SendConfirmEmailNoticesUseCase) {}

  async send(req: express.Request, res: express.Response) {
    const dryRun = req.query.dryRun !== 'false';
    try {
      const result = await this.useCase.execute(dryRun);
      res.status(200).json(result);
    } catch (error) {
      console.error('[ops] confirm email notices failed', error);
      res.status(500).json({ message: 'Could not run the confirm email job.' });
    }
  }
}

export default OpsConfirmEmailNoticesController;
