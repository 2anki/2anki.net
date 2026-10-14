import { vi } from 'vitest';
import { GetCheckoutReceiptUseCase } from './GetCheckoutReceiptUseCase';

const retrieve = vi.fn();
const stripe = () => ({ checkout: { sessions: { retrieve } } }) as never;

const paidSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'cs_test_1',
  payment_status: 'paid',
  amount_total: 1200,
  currency: 'usd',
  mode: 'payment',
  metadata: { user_id: '42', pass_kind: '7d' },
  ...overrides,
});

beforeEach(() => {
  retrieve.mockReset();
});

describe('GetCheckoutReceiptUseCase', () => {
  it('returns amount, currency and kind for the owner of a paid pass session', async () => {
    retrieve.mockResolvedValue(paidSession());
    const uc = new GetCheckoutReceiptUseCase(stripe());

    await expect(
      uc.execute({ sessionId: 'cs_test_1', ownerId: 42 })
    ).resolves.toEqual({ amount: 1200, currency: 'USD', kind: 'pass_7d' });
    expect(retrieve).toHaveBeenCalledWith('cs_test_1');
  });

  it('lets the holder of an anonymous pass session read it without an account', async () => {
    retrieve.mockResolvedValue(
      paidSession({ metadata: { pass_anonymous: '1', pass_kind: '24h' } })
    );
    const uc = new GetCheckoutReceiptUseCase(stripe());

    await expect(
      uc.execute({ sessionId: 'cs_test_1', ownerId: null })
    ).resolves.toEqual({ amount: 1200, currency: 'USD', kind: 'pass_24h' });
  });

  it('refuses another user’s session', async () => {
    retrieve.mockResolvedValue(paidSession());
    const uc = new GetCheckoutReceiptUseCase(stripe());

    await expect(
      uc.execute({ sessionId: 'cs_test_1', ownerId: 7 })
    ).resolves.toBeNull();
  });

  it('refuses a signed-in session when nobody is signed in', async () => {
    retrieve.mockResolvedValue(paidSession());
    const uc = new GetCheckoutReceiptUseCase(stripe());

    await expect(
      uc.execute({ sessionId: 'cs_test_1', ownerId: null })
    ).resolves.toBeNull();
  });

  it('refuses a session that is not paid', async () => {
    retrieve.mockResolvedValue(paidSession({ payment_status: 'unpaid' }));
    const uc = new GetCheckoutReceiptUseCase(stripe());

    await expect(
      uc.execute({ sessionId: 'cs_test_1', ownerId: 42 })
    ).resolves.toBeNull();
  });

  it('returns null when Stripe does not know the session', async () => {
    retrieve.mockRejectedValue(new Error('No such checkout.session'));
    const uc = new GetCheckoutReceiptUseCase(stripe());

    await expect(
      uc.execute({ sessionId: 'cs_test_missing', ownerId: 42 })
    ).resolves.toBeNull();
  });

  it.each([
    [{ user_id: '42', credit_pack: '1' }, 'payment', 'credit_pack'],
    [{ user_id: '42' }, 'subscription', 'subscription'],
    [{ user_id: '42', pass_kind: '120d' }, 'payment', 'pass_120d'],
    [{ user_id: '42' }, 'payment', 'payment'],
  ])('classifies %o in mode %s as %s', async (metadata, mode, kind) => {
    retrieve.mockResolvedValue(paidSession({ metadata, mode }));
    const uc = new GetCheckoutReceiptUseCase(stripe());

    await expect(
      uc.execute({ sessionId: 'cs_test_1', ownerId: 42 })
    ).resolves.toMatchObject({ kind });
  });
});
