import { vi, type Mock } from 'vitest';
import { Response } from 'express';
import CheckoutReceiptController, {
  parseCheckoutSessionId,
} from './CheckoutReceiptController';
import { GetCheckoutReceiptUseCase } from '../usecases/checkout/GetCheckoutReceiptUseCase';

const makeRes = (locals: Record<string, unknown> = {}) => {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { locals, json, status } as unknown as Response & {
    json: Mock;
    status: Mock;
  };
};

const makeController = (execute: Mock) =>
  new CheckoutReceiptController({
    execute,
  } as unknown as GetCheckoutReceiptUseCase);

describe('parseCheckoutSessionId', () => {
  it('accepts live and test session ids only', () => {
    expect(parseCheckoutSessionId('cs_test_a1B2c3D4e5F6g7')).toBe(
      'cs_test_a1B2c3D4e5F6g7'
    );
    expect(parseCheckoutSessionId('cs_live_a1B2c3D4e5F6g7')).toBe(
      'cs_live_a1B2c3D4e5F6g7'
    );
    expect(parseCheckoutSessionId('pi_123')).toBeUndefined();
    expect(parseCheckoutSessionId('cs_test_short')).toBeUndefined();
    expect(parseCheckoutSessionId('cs_test_has space1234')).toBeUndefined();
    expect(parseCheckoutSessionId(42)).toBeUndefined();
  });
});

describe('CheckoutReceiptController', () => {
  it('returns the receipt for a valid session id and the signed-in owner', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ amount: 600, currency: 'USD', kind: 'pass_24h' });
    const res = makeRes({ owner: 42 });

    await makeController(execute).getReceipt(
      { query: { session_id: 'cs_test_a1B2c3D4e5F6g7' } } as never,
      res
    );

    expect(execute).toHaveBeenCalledWith({
      sessionId: 'cs_test_a1B2c3D4e5F6g7',
      ownerId: 42,
    });
    expect(res.json).toHaveBeenCalledWith({
      amount: 600,
      currency: 'USD',
      kind: 'pass_24h',
    });
  });

  it('passes a null owner for anonymous visitors', async () => {
    const execute = vi.fn().mockResolvedValue(null);
    const res = makeRes();

    await makeController(execute).getReceipt(
      { query: { session_id: 'cs_live_a1B2c3D4e5F6g7' } } as never,
      res
    );

    expect(execute).toHaveBeenCalledWith({
      sessionId: 'cs_live_a1B2c3D4e5F6g7',
      ownerId: null,
    });
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('rejects a malformed session id before touching Stripe', async () => {
    const execute = vi.fn();
    const res = makeRes({ owner: 42 });

    await makeController(execute).getReceipt(
      { query: { session_id: 'not-a-session' } } as never,
      res
    );

    expect(execute).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
