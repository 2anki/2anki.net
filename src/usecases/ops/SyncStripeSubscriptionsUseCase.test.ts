import { vi } from 'vitest';
import { SyncStripeSubscriptionsUseCase } from './SyncStripeSubscriptionsUseCase';

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

describe('SyncStripeSubscriptionsUseCase', () => {
  it('starts the sync and reports started on the first call', () => {
    const runSync = vi.fn().mockResolvedValue(undefined);
    const useCase = new SyncStripeSubscriptionsUseCase(runSync);

    const result = useCase.execute();

    expect(result).toEqual({ started: true, alreadyRunning: false });
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it('rejects a second call while a sync is still running', () => {
    let resolveSync: () => void = () => undefined;
    const runSync = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSync = resolve;
        })
    );
    const useCase = new SyncStripeSubscriptionsUseCase(runSync);

    const first = useCase.execute();
    const second = useCase.execute();

    expect(first).toEqual({ started: true, alreadyRunning: false });
    expect(second).toEqual({ started: false, alreadyRunning: true });
    expect(runSync).toHaveBeenCalledTimes(1);

    resolveSync();
  });

  it('allows a new sync once the previous run finishes', async () => {
    let resolveSync: () => void = () => undefined;
    const runSync = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSync = resolve;
        })
    );
    const useCase = new SyncStripeSubscriptionsUseCase(runSync);

    useCase.execute();
    resolveSync();
    await flushMicrotasks();

    const result = useCase.execute();

    expect(result).toEqual({ started: true, alreadyRunning: false });
    expect(runSync).toHaveBeenCalledTimes(2);
  });

  it('releases the lock even when the sync rejects', async () => {
    const runSync = vi
      .fn()
      .mockRejectedValueOnce(new Error('stripe down'))
      .mockResolvedValueOnce(undefined);
    const useCase = new SyncStripeSubscriptionsUseCase(runSync);

    useCase.execute();
    await flushMicrotasks();

    const result = useCase.execute();

    expect(result).toEqual({ started: true, alreadyRunning: false });
    expect(runSync).toHaveBeenCalledTimes(2);
  });
});
