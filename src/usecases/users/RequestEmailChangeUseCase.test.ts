import { RequestEmailChangeUseCase } from './RequestEmailChangeUseCase';
import InMemoryEmailChangeTokenRepository from '../../data_layer/InMemoryEmailChangeTokenRepository';
import type UsersRepository from '../../data_layer/UsersRepository';
import type OauthIdentitiesRepository from '../../data_layer/OauthIdentitiesRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';

process.env.THE_HASHING_SECRET = 'test-secret-for-jest';

const STORED_HASH = 'stored-hash-value';
const TYPED_SECRET = 'typed-secret';

interface FakeUser {
  id: number;
  email: string;
  password: string;
}

const makeUsersRepo = (options: {
  current: FakeUser;
  collision?: FakeUser | null;
}) =>
  ({
    getById: jest.fn().mockResolvedValue(options.current),
    getByEmail: jest.fn().mockResolvedValue(options.collision ?? undefined),
  }) as unknown as UsersRepository;

const makeOauthRepo = (hasIdentity: boolean) =>
  ({
    hasIdentityForUser: jest.fn().mockResolvedValue(hasIdentity),
  }) as unknown as OauthIdentitiesRepository;

const makeEmailService = () =>
  ({
    sendEmailChangeConfirmationEmail: jest.fn().mockResolvedValue(undefined),
    sendEmailChangeNotificationEmail: jest.fn().mockResolvedValue(undefined),
  }) as unknown as IEmailService;

const currentUser: FakeUser = {
  id: 7,
  email: 'old@example.com',
  password: STORED_HASH,
};

describe('RequestEmailChangeUseCase', () => {
  it('inserts a token and mails the new and old addresses on success', async () => {
    const tokensRepo = new InMemoryEmailChangeTokenRepository();
    const emailService = makeEmailService();
    const useCase = new RequestEmailChangeUseCase(
      tokensRepo,
      makeUsersRepo({ current: currentUser }),
      makeOauthRepo(false),
      emailService,
      () => true,
      'https://2anki.net'
    );

    const outcome = await useCase.execute({
      userId: 7,
      newEmail: 'New@Example.com',
      password: TYPED_SECRET,
    });

    expect(outcome).toEqual({ ok: true });
    const count = await tokensRepo.countRecentByUser(
      7,
      new Date(Date.now() - 60 * 60 * 1000)
    );
    expect(count).toBe(1);
    expect(emailService.sendEmailChangeConfirmationEmail).toHaveBeenCalledWith(
      'new@example.com',
      expect.stringContaining('https://2anki.net/account/email-change?token=')
    );
    expect(emailService.sendEmailChangeNotificationEmail).toHaveBeenCalledWith(
      'old@example.com',
      'new@example.com'
    );
  });

  it('rejects a malformed new email', async () => {
    const useCase = new RequestEmailChangeUseCase(
      new InMemoryEmailChangeTokenRepository(),
      makeUsersRepo({ current: currentUser }),
      makeOauthRepo(false),
      makeEmailService(),
      () => true
    );

    const outcome = await useCase.execute({
      userId: 7,
      newEmail: 'not-an-email',
      password: TYPED_SECRET,
    });

    expect(outcome).toEqual({ ok: false, reason: 'invalid_email' });
  });

  it('rejects a new email identical to the current one', async () => {
    const useCase = new RequestEmailChangeUseCase(
      new InMemoryEmailChangeTokenRepository(),
      makeUsersRepo({ current: currentUser }),
      makeOauthRepo(false),
      makeEmailService(),
      () => true
    );

    const outcome = await useCase.execute({
      userId: 7,
      newEmail: 'OLD@example.com',
      password: TYPED_SECRET,
    });

    expect(outcome).toEqual({ ok: false, reason: 'same_as_current' });
  });

  it('returns wrong_password for a bad password on a password account', async () => {
    const emailService = makeEmailService();
    const useCase = new RequestEmailChangeUseCase(
      new InMemoryEmailChangeTokenRepository(),
      makeUsersRepo({ current: currentUser }),
      makeOauthRepo(false),
      emailService,
      () => false
    );

    const outcome = await useCase.execute({
      userId: 7,
      newEmail: 'new@example.com',
      password: TYPED_SECRET,
    });

    expect(outcome).toEqual({ ok: false, reason: 'wrong_password' });
    expect(
      emailService.sendEmailChangeConfirmationEmail
    ).not.toHaveBeenCalled();
  });

  it('directs an OAuth-only account to set a password first', async () => {
    const useCase = new RequestEmailChangeUseCase(
      new InMemoryEmailChangeTokenRepository(),
      makeUsersRepo({ current: currentUser }),
      makeOauthRepo(true),
      makeEmailService(),
      () => false
    );

    const outcome = await useCase.execute({
      userId: 7,
      newEmail: 'new@example.com',
      password: TYPED_SECRET,
    });

    expect(outcome).toEqual({ ok: false, reason: 'set_password_first' });
  });

  it('answers a taken email like a fresh one but never mails or mints a live token', async () => {
    const tokensRepo = new InMemoryEmailChangeTokenRepository();
    const emailService = makeEmailService();
    const useCase = new RequestEmailChangeUseCase(
      tokensRepo,
      makeUsersRepo({
        current: currentUser,
        collision: { id: 99, email: 'new@example.com', password: STORED_HASH },
      }),
      makeOauthRepo(false),
      emailService,
      () => true
    );

    const outcome = await useCase.execute({
      userId: 7,
      newEmail: 'new@example.com',
      password: TYPED_SECRET,
    });

    expect(outcome).toEqual({ ok: true });
    expect(
      (emailService.sendEmailChangeConfirmationEmail as jest.Mock).mock.calls
    ).toHaveLength(0);
    expect(
      (emailService.sendEmailChangeNotificationEmail as jest.Mock).mock.calls
    ).toHaveLength(0);
    expect(await tokensRepo.findLivePendingByUser(7, new Date())).toBeNull();
    expect(
      await tokensRepo.countRecentByUser(7, new Date(Date.now() - 60_000))
    ).toBe(1);
  });

  it('keeps counting cancelled requests against the hourly cap', async () => {
    const tokensRepo = new InMemoryEmailChangeTokenRepository();
    for (let i = 0; i < 5; i++) {
      await tokensRepo.insert({
        user_id: 7 as never,
        new_email: `n${i}@example.com`,
        token_hash: `h${i}`,
        expires_at: new Date(Date.now() + 60_000),
      });
    }
    await tokensRepo.expireLivePendingByUser(7, new Date());
    const useCase = new RequestEmailChangeUseCase(
      tokensRepo,
      makeUsersRepo({ current: currentUser }),
      makeOauthRepo(false),
      makeEmailService(),
      () => true
    );

    const outcome = await useCase.execute({
      userId: 7,
      newEmail: 'another@example.com',
      password: TYPED_SECRET,
    });

    expect(outcome).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('rate-limits after too many recent requests', async () => {
    const tokensRepo = new InMemoryEmailChangeTokenRepository();
    for (let i = 0; i < 5; i++) {
      await tokensRepo.insert({
        user_id: 7 as never,
        new_email: `n${i}@example.com`,
        token_hash: `h${i}`,
        expires_at: new Date(Date.now() + 60_000),
      });
    }
    const useCase = new RequestEmailChangeUseCase(
      tokensRepo,
      makeUsersRepo({ current: currentUser }),
      makeOauthRepo(false),
      makeEmailService(),
      () => true
    );

    const outcome = await useCase.execute({
      userId: 7,
      newEmail: 'new@example.com',
      password: TYPED_SECRET,
    });

    expect(outcome).toEqual({ ok: false, reason: 'rate_limited' });
  });
});
