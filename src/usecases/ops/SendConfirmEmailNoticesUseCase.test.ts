import { vi } from 'vitest';

import { SendConfirmEmailNoticesUseCase } from './SendConfirmEmailNoticesUseCase';
import { InMemorySubscriptionRecoveryNotificationsRepository } from '../../data_layer/SubscriptionRecoveryNotificationsRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import { emailHash } from '../../lib/emailHash';

const build = (
  candidates: string[],
  lockedOut: string[],
  send = vi.fn().mockResolvedValue(true),
  sent = new InMemorySubscriptionRecoveryNotificationsRepository(),
  runExclusively = async (_key: number, fn: () => Promise<void>) => {
    await fn();
    return true;
  }
) => {
  const useCase = new SendConfirmEmailNoticesUseCase(
    { findCandidateEmails: async () => candidates },
    sent,
    { sendConfirmEmailNotice: send } as unknown as IEmailService,
    async (email) => lockedOut.includes(email),
    { runExclusively }
  );
  return { useCase, send, sent };
};

describe('SendConfirmEmailNoticesUseCase', () => {
  it('counts only accounts the real check locks out, and sends nothing on a dry run', async () => {
    const { useCase, send } = build(['a@x.test', 'b@x.test'], ['a@x.test']);

    await expect(useCase.execute(true)).resolves.toMatchObject({
      count: 1,
      dryRun: true,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends to each locked-out account', async () => {
    const { useCase, send } = build(['a@x.test', 'b@x.test'], ['a@x.test']);

    await expect(useCase.execute(false)).resolves.toMatchObject({
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

    await expect(useCase.execute(true)).resolves.toMatchObject({
      count: 0,
      dryRun: true,
    });
  });

  it('retries an address whose send failed', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(true);
    const { useCase } = build(['a@x.test'], ['a@x.test'], send);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = await useCase.execute(false);
    const second = await useCase.execute(false);

    expect(first).toMatchObject({ count: 0, failed: 1 });
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

  it('gives a suppressed address back and does not count it as sent', async () => {
    const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { useCase } = build(['a@x.test'], ['a@x.test'], send);

    const first = await useCase.execute(false);
    const second = await useCase.execute(false);

    expect(first).toMatchObject({ count: 0, suppressed: 1 });
    expect(second.count).toBe(1);
  });

  it('claims an address before it sends', async () => {
    const sent = new InMemorySubscriptionRecoveryNotificationsRepository();
    const record = vi.spyOn(sent, 'recordNotified');
    const send = vi.fn(async () => {
      expect(record).toHaveBeenCalledTimes(1);
      return true;
    });
    const { useCase } = build(['a@x.test'], ['a@x.test'], send, sent);

    await useCase.execute(false);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the claim cannot be written', async () => {
    const sent = new InMemorySubscriptionRecoveryNotificationsRepository();
    vi.spyOn(sent, 'recordNotified').mockRejectedValue(new Error('db down'));
    const { useCase, send } = build(
      ['a@x.test'],
      ['a@x.test'],
      undefined,
      sent
    );

    await expect(useCase.execute(false)).rejects.toThrow('db down');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing while another run holds the lock', async () => {
    const { useCase, send } = build(
      ['a@x.test'],
      ['a@x.test'],
      undefined,
      undefined,
      async () => false
    );

    await expect(useCase.execute(false)).resolves.toMatchObject({
      count: 0,
      alreadyRunning: true,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('still emails an address that once got the recovery email', async () => {
    const sent = new InMemorySubscriptionRecoveryNotificationsRepository();
    await sent.recordNotified(emailHash('a@x.test'));
    const { useCase, send } = build(
      ['a@x.test'],
      ['a@x.test'],
      undefined,
      sent
    );

    await useCase.execute(false);

    expect(send).toHaveBeenCalledWith('a@x.test');
  });
});
