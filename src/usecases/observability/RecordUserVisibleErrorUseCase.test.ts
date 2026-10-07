import { vi } from 'vitest';
import { RecordUserVisibleErrorUseCase } from './RecordUserVisibleErrorUseCase';
import { InMemoryUserVisibleErrorsRepository } from '../../data_layer/UserVisibleErrorsRepository';
import type { IUserVisibleErrorsRepository } from '../../data_layer/UserVisibleErrorsRepository';

describe('RecordUserVisibleErrorUseCase', () => {
  it('records the error via the repository', async () => {
    const repo = new InMemoryUserVisibleErrorsRepository();
    const useCase = new RecordUserVisibleErrorUseCase(repo);

    await useCase.execute({
      userId: null,
      surface: 'oauth_google',
      code: 'oauth_cancelled',
    });

    const counts = await repo.countBySurfaceAndCode(1);
    expect(counts).toEqual([
      { surface: 'oauth_google', code: 'oauth_cancelled', count: 1 },
    ]);
  });

  it('swallows repository errors without re-throwing', async () => {
    const brokenRepo: IUserVisibleErrorsRepository = {
      record: vi.fn().mockRejectedValue(new Error('DB connection lost')),
      countBySurfaceAndCode: vi.fn().mockResolvedValue([]),
    };
    const useCase = new RecordUserVisibleErrorUseCase(brokenRepo);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      useCase.execute({
        userId: null,
        surface: 'stripe_webhook',
        code: 'stripe_webhook_signature_invalid',
      })
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      'RecordUserVisibleErrorUseCase: failed to persist error record',
      expect.any(Error)
    );

    errorSpy.mockRestore();
  });

  it('passes context through to the repository', async () => {
    const repo = new InMemoryUserVisibleErrorsRepository();
    const recordSpy = vi.spyOn(repo, 'record');
    const useCase = new RecordUserVisibleErrorUseCase(repo);

    await useCase.execute({
      userId: 42,
      surface: 'stripe_webhook',
      code: 'stripe_webhook_signature_invalid',
      context: { message: 'No signatures found' },
    });

    expect(recordSpy).toHaveBeenCalledWith({
      userId: 42,
      surface: 'stripe_webhook',
      code: 'stripe_webhook_signature_invalid',
      context: { message: 'No signatures found' },
    });
  });
});
