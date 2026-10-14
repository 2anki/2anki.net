import { vi, type Mocked } from 'vitest';

import {
  InMemoryPassEndingRepository,
  passEndingCampaign,
} from '../../data_layer/PassEndingRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import { SendPassEndingEmailsUseCase } from './SendPassEndingEmailsUseCase';

function makeEmailService(): Mocked<
  Pick<IEmailService, 'sendPassEndingEmail'>
> {
  return { sendPassEndingEmail: vi.fn().mockResolvedValue(undefined) };
}

const weekPass = {
  passId: 11,
  userId: 7,
  email: 'ada@example.com',
  kind: '7d' as const,
};
const semesterPass = {
  passId: 12,
  userId: 8,
  email: 'bo@example.com',
  kind: '120d' as const,
};

describe('SendPassEndingEmailsUseCase', () => {
  it('counts candidates without sending or claiming on a dry run', async () => {
    const repo = new InMemoryPassEndingRepository();
    repo.seedPasses([weekPass, semesterPass]);
    const emailService = makeEmailService();
    const useCase = new SendPassEndingEmailsUseCase(
      repo,
      emailService as unknown as IEmailService
    );

    const result = await useCase.execute(true);

    expect(result).toEqual({ count: 2, dryRun: true });
    expect(emailService.sendPassEndingEmail).not.toHaveBeenCalled();
    expect(repo.getClaims()).toHaveLength(0);
  });

  it('emails each ending pass with its label and claims the send', async () => {
    const repo = new InMemoryPassEndingRepository();
    repo.seedPasses([weekPass, semesterPass]);
    const emailService = makeEmailService();
    const useCase = new SendPassEndingEmailsUseCase(
      repo,
      emailService as unknown as IEmailService
    );

    const result = await useCase.execute(false);

    expect(result).toEqual({ count: 2, dryRun: false });
    expect(emailService.sendPassEndingEmail).toHaveBeenCalledWith(
      'ada@example.com',
      expect.any(String),
      'Week Pass'
    );
    expect(emailService.sendPassEndingEmail).toHaveBeenCalledWith(
      'bo@example.com',
      expect.any(String),
      'Semester Pass'
    );
    expect(repo.getClaims()).toEqual([
      { userId: 7, campaign: passEndingCampaign(11) },
      { userId: 8, campaign: passEndingCampaign(12) },
    ]);
  });

  it('does not email the same pass twice across runs', async () => {
    const repo = new InMemoryPassEndingRepository();
    repo.seedPasses([weekPass]);
    const emailService = makeEmailService();
    const useCase = new SendPassEndingEmailsUseCase(
      repo,
      emailService as unknown as IEmailService
    );

    await useCase.execute(false);
    const second = await useCase.execute(false);

    expect(second).toEqual({ count: 0, dryRun: false });
    expect(emailService.sendPassEndingEmail).toHaveBeenCalledTimes(1);
  });

  it('skips a hard-suppressed address without claiming it', async () => {
    const repo = new InMemoryPassEndingRepository();
    repo.seedPasses([weekPass, semesterPass]);
    const emailService = makeEmailService();
    const useCase = new SendPassEndingEmailsUseCase(
      repo,
      emailService as unknown as IEmailService,
      async (email) => email === 'ada@example.com'
    );

    const result = await useCase.execute(false);

    expect(result).toEqual({ count: 1, dryRun: false });
    expect(emailService.sendPassEndingEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendPassEndingEmail).toHaveBeenCalledWith(
      'bo@example.com',
      expect.any(String),
      'Semester Pass'
    );
    expect(repo.getClaims()).toEqual([
      { userId: 8, campaign: passEndingCampaign(12) },
    ]);
  });

  it('keeps the claim and moves on when a send fails', async () => {
    const repo = new InMemoryPassEndingRepository();
    repo.seedPasses([weekPass, semesterPass]);
    const emailService = makeEmailService();
    emailService.sendPassEndingEmail
      .mockRejectedValueOnce(new Error('sendgrid down'))
      .mockResolvedValueOnce(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const useCase = new SendPassEndingEmailsUseCase(
      repo,
      emailService as unknown as IEmailService
    );

    const result = await useCase.execute(false);

    expect(result).toEqual({ count: 1, dryRun: false });
    expect(repo.getClaims()).toHaveLength(2);
    errorSpy.mockRestore();
  });
});
