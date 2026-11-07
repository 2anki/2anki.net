import { vi } from 'vitest';

import { SendConfirmEmailNoticesUseCase } from './SendConfirmEmailNoticesUseCase';
import { InMemorySubscriptionRecoveryNotificationsRepository } from '../../data_layer/SubscriptionRecoveryNotificationsRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';

const build = (
  candidates: string[],
  lockedOut: string[],
  send = vi.fn().mockResolvedValue(undefined)
) => {
  const useCase = new SendConfirmEmailNoticesUseCase(
    { findCandidateEmails: async () => candidates },
    new InMemorySubscriptionRecoveryNotificationsRepository(),
    { sendConfirmEmailNotice: send } as unknown as IEmailService,
    async (email) => lockedOut.includes(email)
  );
  return { useCase, send };
};

describe('SendConfirmEmailNoticesUseCase', () => {
  it('counts only accounts the real check locks out, and sends nothing on a dry run', async () => {
    const { useCase, send } = build(['a@x.test', 'b@x.test'], ['a@x.test']);

    await expect(useCase.execute(true)).resolves.toEqual({
      count: 1,
      dryRun: true,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends to each locked-out account', async () => {
    const { useCase, send } = build(['a@x.test', 'b@x.test'], ['a@x.test']);

    await expect(useCase.execute(false)).resolves.toEqual({
      count: 1,
      dryRun: false,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('a@x.test');
  });

  it('never emails an address twice', async () => {
    const { useCase, send } = build(['a@x.test'], ['a@x.test']);

    await useCase.execute(false);
    const second = await useCase.execute(false);

    expect(second.count).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('leaves out of a later dry run the addresses already emailed', async () => {
    const { useCase } = build(['a@x.test'], ['a@x.test']);

    await useCase.execute(false);

    await expect(useCase.execute(true)).resolves.toEqual({
      count: 0,
      dryRun: true,
    });
  });

  it('retries an address whose send failed', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(undefined);
    const { useCase } = build(['a@x.test'], ['a@x.test'], send);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = await useCase.execute(false);
    const second = await useCase.execute(false);

    expect(first.count).toBe(0);
    expect(second.count).toBe(1);
    vi.restoreAllMocks();
  });

  it('stops after three failures in a row', async () => {
    const send = vi.fn().mockRejectedValue(new Error('down'));
    const { useCase } = build(
      ['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test'],
      ['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test'],
      send
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await useCase.execute(false);

    expect(result.count).toBe(0);
    expect(send).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });
});
