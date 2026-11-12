import { vi, type Mocked } from 'vitest';

import {
  InMemoryPassEndingRepository,
  passEmailCampaign,
  passEndingCampaign,
} from '../../data_layer/PassEndingRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import { SendPassEndingEmailsUseCase } from './SendPassEndingEmailsUseCase';

function makeEmailService(): Mocked<
  Pick<IEmailService, 'sendPassEndingEmail' | 'sendSemesterRenewalEmail'>
> {
  return {
    sendPassEndingEmail: vi.fn().mockResolvedValue(undefined),
    sendSemesterRenewalEmail: vi.fn().mockResolvedValue(undefined),
  };
}

const weekPass = {
  passId: 11,
  userId: 7,
  email: 'ada@example.com',
  kind: '7d' as const,
  expiresAt: new Date('2027-01-11T00:00:00.000Z'),
};
const semesterPass = {
  passId: 12,
  userId: 8,
  email: 'bo@example.com',
  kind: '120d' as const,
  expiresAt: new Date('2027-01-11T06:00:00.000Z'),
};
const renewingSemesterPass = {
  passId: 13,
  userId: 9,
  email: 'cy@example.com',
  kind: '120d' as const,
  expiresAt: new Date('2027-01-16T00:00:00.000Z'),
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

    expect(result).toEqual({ count: 2, renewalCount: 0, dryRun: true });
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

    expect(result).toEqual({ count: 2, renewalCount: 0, dryRun: false });
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

    expect(second).toEqual({ count: 0, renewalCount: 0, dryRun: false });
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

    expect(result).toEqual({ count: 1, renewalCount: 0, dryRun: false });
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

    expect(result).toEqual({ count: 1, renewalCount: 0, dryRun: false });
    expect(repo.getClaims()).toHaveLength(2);
    errorSpy.mockRestore();
  });

  describe('week-before Semester Pass renewal email', () => {
    it('counts renewal candidates on a dry run without sending', async () => {
      const repo = new InMemoryPassEndingRepository();
      repo.seedRenewalPasses([renewingSemesterPass]);
      const emailService = makeEmailService();
      const useCase = new SendPassEndingEmailsUseCase(
        repo,
        emailService as unknown as IEmailService
      );

      const result = await useCase.execute(true);

      expect(result).toEqual({ count: 0, renewalCount: 1, dryRun: true });
      expect(emailService.sendSemesterRenewalEmail).not.toHaveBeenCalled();
      expect(repo.getClaims()).toHaveLength(0);
    });

    it('emails the renewal note with the end date and claims it under its own campaign', async () => {
      const repo = new InMemoryPassEndingRepository();
      repo.seedPasses([weekPass]);
      repo.seedRenewalPasses([renewingSemesterPass]);
      const emailService = makeEmailService();
      const useCase = new SendPassEndingEmailsUseCase(
        repo,
        emailService as unknown as IEmailService
      );

      const result = await useCase.execute(false);

      expect(result).toEqual({ count: 1, renewalCount: 1, dryRun: false });
      expect(emailService.sendSemesterRenewalEmail).toHaveBeenCalledWith(
        'cy@example.com',
        expect.any(String),
        renewingSemesterPass.expiresAt
      );
      expect(repo.getClaims()).toEqual([
        { userId: 7, campaign: passEndingCampaign(11) },
        { userId: 9, campaign: passEmailCampaign('pass_renewal', 13) },
      ]);
    });

    it('does not send the renewal note twice across runs', async () => {
      const repo = new InMemoryPassEndingRepository();
      repo.seedRenewalPasses([renewingSemesterPass]);
      const emailService = makeEmailService();
      const useCase = new SendPassEndingEmailsUseCase(
        repo,
        emailService as unknown as IEmailService
      );

      await useCase.execute(false);
      const second = await useCase.execute(false);

      expect(second).toEqual({ count: 0, renewalCount: 0, dryRun: false });
      expect(emailService.sendSemesterRenewalEmail).toHaveBeenCalledTimes(1);
    });

    it('skips a hard-suppressed address for the renewal note', async () => {
      const repo = new InMemoryPassEndingRepository();
      repo.seedRenewalPasses([renewingSemesterPass]);
      const emailService = makeEmailService();
      const useCase = new SendPassEndingEmailsUseCase(
        repo,
        emailService as unknown as IEmailService,
        async () => true
      );

      const result = await useCase.execute(false);

      expect(result.renewalCount).toBe(0);
      expect(emailService.sendSemesterRenewalEmail).not.toHaveBeenCalled();
      expect(repo.getClaims()).toHaveLength(0);
    });
  });
});
