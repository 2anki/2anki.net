import { vi } from 'vitest';
import { GetAutoSyncPriceUseCase } from './GetAutoSyncPriceUseCase';

const retrieve = vi.fn();
const stripe = { prices: { retrieve } } as never;

beforeEach(() => {
  retrieve.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T10:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GetAutoSyncPriceUseCase', () => {
  it('returns the live Stripe amount, so the card never shows a price checkout would not charge', async () => {
    retrieve.mockResolvedValue({
      active: true,
      unit_amount: 3000,
      currency: 'usd',
      recurring: { interval: 'month' },
    });

    const result = await new GetAutoSyncPriceUseCase(
      stripe,
      'price_auto_sync'
    ).execute();

    expect(retrieve).toHaveBeenCalledWith('price_auto_sync');
    expect(result).toEqual({
      amount: 3000,
      currency: 'usd',
      interval: 'month',
      display: '$30',
    });
  });

  it('returns null with no price configured, which hides the card', async () => {
    const result = await new GetAutoSyncPriceUseCase(stripe, '').execute();

    expect(result).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('returns null for an archived price', async () => {
    retrieve.mockResolvedValue({
      active: false,
      unit_amount: 3000,
      currency: 'usd',
      recurring: { interval: 'month' },
    });

    const result = await new GetAutoSyncPriceUseCase(
      stripe,
      'price_auto_sync'
    ).execute();

    expect(result).toBeNull();
  });

  it('returns null when Stripe cannot be reached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    retrieve.mockRejectedValue(new Error('network'));

    const result = await new GetAutoSyncPriceUseCase(
      stripe,
      'price_auto_sync'
    ).execute();

    expect(result).toBeNull();
  });

  it('asks Stripe once per ten minutes', async () => {
    retrieve.mockResolvedValue({
      active: true,
      unit_amount: 3000,
      currency: 'usd',
      recurring: { interval: 'month' },
    });
    const useCase = new GetAutoSyncPriceUseCase(stripe, 'price_auto_sync');

    await useCase.execute();
    await useCase.execute();
    expect(retrieve).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await useCase.execute();
    expect(retrieve).toHaveBeenCalledTimes(2);
  });
});
