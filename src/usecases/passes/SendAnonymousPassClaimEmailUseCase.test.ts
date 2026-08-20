import { SendAnonymousPassClaimEmailUseCase } from './SendAnonymousPassClaimEmailUseCase';
import type { IPassClaimTokensRepository } from '../../data_layer/PassClaimTokensRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import type { EventsSink } from '../../services/events/EventsSink';

process.env.THE_HASHING_SECRET = 'test-secret-for-jest';

function makeTokensRepo(): IPassClaimTokensRepository {
  return {
    insert: jest.fn().mockResolvedValue({ id: 1 }),
    findByTokenHash: jest.fn().mockResolvedValue(null),
    markConsumed: jest.fn().mockResolvedValue(undefined),
    countRecentByUser: jest.fn().mockResolvedValue(0),
  };
}

function makeEmailService(): IEmailService {
  return {
    sendAnonymousPassClaimEmail: jest.fn().mockResolvedValue(undefined),
  } as unknown as IEmailService;
}

function makeEventsSink(): Pick<EventsSink, 'record'> {
  return { record: jest.fn() };
}

describe('SendAnonymousPassClaimEmailUseCase', () => {
  it('issues an unbound claim token and emails the buyer a claim link', async () => {
    const tokensRepo = makeTokensRepo();
    const emailService = makeEmailService();
    const eventsSink = makeEventsSink();
    const useCase = new SendAnonymousPassClaimEmailUseCase(
      tokensRepo,
      emailService,
      eventsSink,
      'https://2anki.net'
    );

    await useCase.execute({
      anonymousPassId: 7,
      kind: '24h',
      buyerEmail: 'buyer@example.com',
    });

    expect(tokensRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: null, anonymous_pass_id: 7 })
    );
    const tokenArg = (tokensRepo.insert as jest.Mock).mock.calls[0][0];
    expect(typeof tokenArg.token_hash).toBe('string');
    expect(tokenArg.token_hash.length).toBeGreaterThan(0);
    expect(tokenArg.expires_at.getTime()).toBeGreaterThan(
      Date.now() + 20 * 24 * 60 * 60 * 1000
    );

    expect(emailService.sendAnonymousPassClaimEmail).toHaveBeenCalledWith(
      'buyer@example.com',
      expect.stringContaining('/account/claim?token='),
      'Day Pass'
    );
    const url = (emailService.sendAnonymousPassClaimEmail as jest.Mock).mock
      .calls[0][1] as string;
    expect(url).toContain('kind=pass');
  });

  it('records a pass_claim_email_sent event with the pass kind', async () => {
    const eventsSink = makeEventsSink();
    const useCase = new SendAnonymousPassClaimEmailUseCase(
      makeTokensRepo(),
      makeEmailService(),
      eventsSink,
      'https://2anki.net'
    );

    await useCase.execute({
      anonymousPassId: 3,
      kind: '7d',
      buyerEmail: 'buyer@example.com',
    });

    expect(eventsSink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'pass_claim_email_sent',
        props: { kind: '7d' },
      })
    );
  });

  it('does nothing when the buyer email is not a valid address', async () => {
    const tokensRepo = makeTokensRepo();
    const emailService = makeEmailService();
    const useCase = new SendAnonymousPassClaimEmailUseCase(
      tokensRepo,
      emailService,
      makeEventsSink(),
      'https://2anki.net'
    );

    await useCase.execute({
      anonymousPassId: 9,
      kind: '24h',
      buyerEmail: '',
    });

    expect(tokensRepo.insert).not.toHaveBeenCalled();
    expect(emailService.sendAnonymousPassClaimEmail).not.toHaveBeenCalled();
  });
});
