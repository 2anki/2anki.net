import { Request, Response } from 'express';
import { GetCheckoutReceiptUseCase } from '../usecases/checkout/GetCheckoutReceiptUseCase';

const SESSION_ID_PATTERN = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;

export function parseCheckoutSessionId(value: unknown): string | undefined {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value)
    ? value
    : undefined;
}

class CheckoutReceiptController {
  constructor(private readonly useCase: GetCheckoutReceiptUseCase) {}

  async getReceipt(req: Request, res: Response): Promise<void> {
    const sessionId = parseCheckoutSessionId(req.query?.session_id);
    if (sessionId == null) {
      res.status(400).json({ message: 'session_id is required' });
      return;
    }
    const ownerId = res.locals.owner as number | undefined;
    const receipt = await this.useCase.execute({
      sessionId,
      ownerId: ownerId ?? null,
    });
    if (receipt == null) {
      res.status(404).json({ message: 'No receipt for this session' });
      return;
    }
    res.json(receipt);
  }
}

export default CheckoutReceiptController;
