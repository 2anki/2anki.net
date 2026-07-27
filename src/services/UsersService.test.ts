import UsersService, {
  MagicLinkRateLimitError,
  MagicLinkSuppressedError,
} from './UsersService';
import type UsersRepository from '../data_layer/UsersRepository';
import type { IEmailService } from './EmailService/EmailService';
import type AuthenticationService from './AuthenticationService';
import { InMemoryMagicTokenRepository } from '../data_layer/MagicTokenRepository';

jest.mock('../lib/misc/hashToken', () => (s: string) => `hashed:${s}`);

function buildEmailService(
  overrides: Partial<IEmailService> = {}
): jest.Mocked<IEmailService> {
  return {
    sendResetEmail: jest.fn(),
    sendConversionEmail: jest.fn(),
    sendConversionLinkEmail: jest.fn(),
    sendContactEmail: jest.fn(),
    sendSubscriptionCancelledEmail: jest.fn(),
    sendSubscriptionScheduledCancellationEmail: jest.fn(),
    sendHostedAnkiAccessRequestEmail: jest
      .fn()
      .mockResolvedValue({ didSend: true }),
    sendApiUsageWarningEmail: jest.fn().mockResolvedValue(undefined),
    sendMagicLinkEmail: jest.fn().mockResolvedValue({ suppressed: false }),
    sendReEngagementEmail: jest.fn().mockResolvedValue(undefined),
    sendInactivityWarningEmail: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<IEmailService>;
}

function buildRegisterRepository() {
  return {
    createUserAndSeedFromTombstone: jest.fn().mockResolvedValue([{ id: 1 }]),
  } as unknown as UsersRepository & {
    createUserAndSeedFromTombstone: jest.Mock;
  };
}

interface AccessRepoStubs {
  getById: jest.Mock;
  markHostedAnkiRequested?: jest.Mock;
}

function buildAccessRepository(stubs: AccessRepoStubs): UsersRepository {
  return {
    markHostedAnkiRequested: jest.fn().mockResolvedValue(1),
    ...stubs,
  } as unknown as UsersRepository;
}

describe('UsersService.register', () => {
  it('passes the supplied name through to the repository unchanged', async () => {
    const repository = buildRegisterRepository();
    const service = new UsersService(repository, buildEmailService());

    await service.register('Alex', 'hashed', 'Alex@Example.com');

    expect(repository.createUserAndSeedFromTombstone).toHaveBeenCalledWith(
      'Alex',
      'hashed',
      'alex@example.com',
      null
    );
  });

  it('defaults the name to the local part of the email when no name is supplied', async () => {
    const repository = buildRegisterRepository();
    const service = new UsersService(repository, buildEmailService());

    await service.register('', 'hashed', 'jane.doe@example.com');

    expect(repository.createUserAndSeedFromTombstone).toHaveBeenCalledWith(
      'jane.doe',
      'hashed',
      'jane.doe@example.com',
      null
    );
  });

  it('uses the email local part when the name is whitespace only', async () => {
    const repository = buildRegisterRepository();
    const service = new UsersService(repository, buildEmailService());

    await service.register('   ', 'hashed', 'student@uni.edu');

    expect(repository.createUserAndSeedFromTombstone).toHaveBeenCalledWith(
      'student',
      'hashed',
      'student@uni.edu',
      null
    );
  });

  it('forwards a validated signup_origin to the repository', async () => {
    const repository = buildRegisterRepository();
    const service = new UsersService(repository, buildEmailService());

    await service.register(
      'Alex',
      'hashed',
      'al@example.com',
      '/notion-to-anki'
    );

    expect(repository.createUserAndSeedFromTombstone).toHaveBeenCalledWith(
      'Alex',
      'hashed',
      'al@example.com',
      '/notion-to-anki'
    );
  });
});

describe('UsersService.sendResetEmail', () => {
  it('awaits the email send so failures propagate to the caller', async () => {
    const sendError = new Error('SendGrid unavailable');
    const sendResetEmail = jest.fn().mockRejectedValue(sendError);
    const emailService = buildEmailService({ sendResetEmail });
    const getByEmail = jest.fn().mockResolvedValue({
      id: 1,
      email: 'al@example.com',
      reset_token: 'existing-token',
      // Still inside its window, so it is reused rather than reminted and
      // this test stays focused on the email send.
      reset_token_expires_at: new Date(Date.now() + 10 * 60 * 1000),
      reset_token_used_at: null,
    });
    const repository = { getByEmail } as unknown as UsersRepository;
    const service = new UsersService(repository, emailService);
    const authService = {} as AuthenticationService;

    await expect(
      service.sendResetEmail('al@example.com', authService)
    ).rejects.toThrow('SendGrid unavailable');

    expect(sendResetEmail).toHaveBeenCalledWith(
      'al@example.com',
      'existing-token'
    );
  });

  it('silently returns when no user matches the email', async () => {
    const sendResetEmail = jest.fn();
    const emailService = buildEmailService({ sendResetEmail });
    const getByEmail = jest.fn().mockResolvedValue(null);
    const repository = { getByEmail } as unknown as UsersRepository;
    const service = new UsersService(repository, emailService);
    const authService = {} as AuthenticationService;

    await service.sendResetEmail('nobody@example.com', authService);

    expect(sendResetEmail).not.toHaveBeenCalled();
  });
});

describe('UsersService.requestHostedAnkiAccess', () => {
  it('emails support and persists the request when the user has not asked before', async () => {
    const sendHostedAnkiAccessRequestEmail = jest
      .fn()
      .mockResolvedValue({ didSend: true });
    const markHostedAnkiRequested = jest.fn().mockResolvedValue(1);
    const emailService = buildEmailService({
      sendHostedAnkiAccessRequestEmail,
    });
    const getById = jest.fn().mockResolvedValue({
      id: 42,
      email: 'al@example.com',
      hosted_anki_requested_at: null,
    });
    const service = new UsersService(
      buildAccessRepository({ getById, markHostedAnkiRequested }),
      emailService
    );

    const result = await service.requestHostedAnkiAccess('owner-uuid');

    expect(getById).toHaveBeenCalledWith('owner-uuid');
    expect(sendHostedAnkiAccessRequestEmail).toHaveBeenCalledWith(
      '42',
      'al@example.com'
    );
    expect(markHostedAnkiRequested).toHaveBeenCalledWith('owner-uuid');
    expect(result).toEqual({ ok: true });
  });

  it('skips the email when the user already requested access', async () => {
    const sendHostedAnkiAccessRequestEmail = jest.fn();
    const markHostedAnkiRequested = jest.fn();
    const emailService = buildEmailService({
      sendHostedAnkiAccessRequestEmail,
    });
    const getById = jest.fn().mockResolvedValue({
      id: 1,
      email: 'al@example.com',
      hosted_anki_requested_at: new Date('2026-05-01T12:00:00Z'),
    });
    const service = new UsersService(
      buildAccessRepository({ getById, markHostedAnkiRequested }),
      emailService
    );

    const result = await service.requestHostedAnkiAccess('owner-uuid');

    expect(sendHostedAnkiAccessRequestEmail).not.toHaveBeenCalled();
    expect(markHostedAnkiRequested).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, alreadyRequested: true });
  });

  it('returns ok:false when the user has no email on file', async () => {
    const sendHostedAnkiAccessRequestEmail = jest.fn();
    const emailService = buildEmailService({
      sendHostedAnkiAccessRequestEmail,
    });
    const getById = jest.fn().mockResolvedValue({
      id: 7,
      email: null,
      hosted_anki_requested_at: null,
    });
    const service = new UsersService(
      buildAccessRepository({ getById }),
      emailService
    );

    const result = await service.requestHostedAnkiAccess('owner-uuid');

    expect(sendHostedAnkiAccessRequestEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false });
  });

  it('returns ok:false and does not persist when SendGrid reports the email did not send', async () => {
    const markHostedAnkiRequested = jest.fn();
    const emailService = buildEmailService({
      sendHostedAnkiAccessRequestEmail: jest
        .fn()
        .mockResolvedValue({ didSend: false }),
    });
    const getById = jest.fn().mockResolvedValue({
      id: 1,
      email: 'al@example.com',
      hosted_anki_requested_at: null,
    });
    const service = new UsersService(
      buildAccessRepository({ getById, markHostedAnkiRequested }),
      emailService
    );

    const result = await service.requestHostedAnkiAccess('owner-uuid');

    expect(markHostedAnkiRequested).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false });
  });
});

describe('UsersService.requestMagicLink', () => {
  it('generates a token and sends an email for a known user', async () => {
    const getByEmail = jest
      .fn()
      .mockResolvedValue({ id: 7, email: 'al@example.com' });
    const repository = { getByEmail } as unknown as UsersRepository;
    const emailService = buildEmailService();
    const magicTokenRepo = new InMemoryMagicTokenRepository();
    const service = new UsersService(repository, emailService, magicTokenRepo);

    await service.requestMagicLink('al@example.com', 'login');

    expect(emailService.sendMagicLinkEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendMagicLinkEmail).toHaveBeenCalledWith(
      'al@example.com',
      expect.any(String),
      'login'
    );
    const sentToken = (emailService.sendMagicLinkEmail as jest.Mock).mock
      .calls[0][1];
    expect(sentToken).toHaveLength(128);
  });

  it('silently returns when the user is not found', async () => {
    const getByEmail = jest.fn().mockResolvedValue(null);
    const repository = { getByEmail } as unknown as UsersRepository;
    const emailService = buildEmailService();
    const magicTokenRepo = new InMemoryMagicTokenRepository();
    const service = new UsersService(repository, emailService, magicTokenRepo);

    await service.requestMagicLink('nobody@example.com', 'login');

    expect(emailService.sendMagicLinkEmail).not.toHaveBeenCalled();
  });

  it('throws MagicLinkSuppressedError when the recipient is suppressed', async () => {
    const getByEmail = jest
      .fn()
      .mockResolvedValue({ id: 9, email: 'blocked@example.com' });
    const repository = { getByEmail } as unknown as UsersRepository;
    const emailService = buildEmailService({
      sendMagicLinkEmail: jest.fn().mockResolvedValue({ suppressed: true }),
    });
    const magicTokenRepo = new InMemoryMagicTokenRepository();
    const service = new UsersService(repository, emailService, magicTokenRepo);

    await expect(
      service.requestMagicLink('blocked@example.com', 'login')
    ).rejects.toThrow(MagicLinkSuppressedError);
  });

  it('throws MagicLinkRateLimitError after 5 requests in an hour', async () => {
    const getByEmail = jest
      .fn()
      .mockResolvedValue({ id: 3, email: 'rate@example.com' });
    const repository = { getByEmail } as unknown as UsersRepository;
    const emailService = buildEmailService();
    const magicTokenRepo = new InMemoryMagicTokenRepository();
    const service = new UsersService(repository, emailService, magicTokenRepo);

    for (let i = 0; i < 5; i++) {
      await service.requestMagicLink('rate@example.com', 'login');
    }

    await expect(
      service.requestMagicLink('rate@example.com', 'login')
    ).rejects.toThrow(MagicLinkRateLimitError);
  });
});

describe('UsersService.requestMagicLink observability', () => {
  let consoleInfoSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
  });

  it('emits a sent event with hashed user id on the happy path', async () => {
    const getByEmail = jest
      .fn()
      .mockResolvedValue({ id: 7, email: 'al@example.com' });
    const repository = { getByEmail } as unknown as UsersRepository;
    const emailService = buildEmailService();
    const magicTokenRepo = new InMemoryMagicTokenRepository();
    const service = new UsersService(repository, emailService, magicTokenRepo);

    await service.requestMagicLink('al@example.com', 'password_reset');

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      'password_reset.magic_link',
      expect.objectContaining({
        outcome: 'sent',
        purpose: 'password_reset',
        user_id_hash: expect.any(String),
      })
    );
    const [, payload] = consoleInfoSpy.mock.calls[0];
    expect(payload).not.toHaveProperty('email');
  });

  it('emits a rate_limited event before throwing MagicLinkRateLimitError', async () => {
    const getByEmail = jest
      .fn()
      .mockResolvedValue({ id: 3, email: 'rate@example.com' });
    const repository = { getByEmail } as unknown as UsersRepository;
    const emailService = buildEmailService();
    const magicTokenRepo = new InMemoryMagicTokenRepository();
    const service = new UsersService(repository, emailService, magicTokenRepo);

    for (let i = 0; i < 5; i++) {
      await service.requestMagicLink('rate@example.com', 'password_reset');
    }
    consoleInfoSpy.mockClear();

    await expect(
      service.requestMagicLink('rate@example.com', 'password_reset')
    ).rejects.toThrow(MagicLinkRateLimitError);

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      'password_reset.magic_link',
      expect.objectContaining({
        outcome: 'rate_limited',
        purpose: 'password_reset',
        user_id_hash: expect.any(String),
      })
    );
  });

  it('emits an unknown_email event when no user matches the email', async () => {
    const getByEmail = jest.fn().mockResolvedValue(null);
    const repository = { getByEmail } as unknown as UsersRepository;
    const emailService = buildEmailService();
    const magicTokenRepo = new InMemoryMagicTokenRepository();
    const service = new UsersService(repository, emailService, magicTokenRepo);

    await service.requestMagicLink('nobody@example.com', 'password_reset');

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      'password_reset.magic_link',
      expect.objectContaining({
        outcome: 'unknown_email',
        purpose: 'password_reset',
      })
    );
    const [, payload] = consoleInfoSpy.mock.calls[0];
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('user_id_hash');
  });

  it('emits a send_failed event with error class name when sgMail throws', async () => {
    const getByEmail = jest
      .fn()
      .mockResolvedValue({ id: 7, email: 'al@example.com' });
    const repository = { getByEmail } as unknown as UsersRepository;
    const sendError = new TypeError('network failure');
    const emailService = buildEmailService({
      sendMagicLinkEmail: jest.fn().mockRejectedValue(sendError),
    });
    const magicTokenRepo = new InMemoryMagicTokenRepository();
    const service = new UsersService(repository, emailService, magicTokenRepo);

    await expect(
      service.requestMagicLink('al@example.com', 'password_reset')
    ).rejects.toThrow(sendError);

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      'password_reset.magic_link',
      expect.objectContaining({
        outcome: 'send_failed',
        purpose: 'password_reset',
        error: 'TypeError',
      })
    );
    const [, payload] = consoleInfoSpy.mock.calls[0];
    expect(payload).not.toHaveProperty('email');
  });
});

describe('UsersService.verifyMagicToken', () => {
  it('returns userId and purpose for a valid token', async () => {
    const getByEmail = jest
      .fn()
      .mockResolvedValue({ id: 10, email: 'al@example.com' });
    const repository = { getByEmail } as unknown as UsersRepository;
    const emailService = buildEmailService();
    const magicTokenRepo = new InMemoryMagicTokenRepository();
    const service = new UsersService(repository, emailService, magicTokenRepo);

    await service.requestMagicLink('al@example.com', 'login');
    const sentToken = (emailService.sendMagicLinkEmail as jest.Mock).mock
      .calls[0][1];

    const result = await service.verifyMagicToken(sentToken);

    expect(result).toEqual({ userId: 10, purpose: 'login' });
  });

  it('returns null for a non-existent token', async () => {
    const repository = {} as unknown as UsersRepository;
    const emailService = buildEmailService();
    const magicTokenRepo = new InMemoryMagicTokenRepository();
    const service = new UsersService(repository, emailService, magicTokenRepo);

    const result = await service.verifyMagicToken('does-not-exist');

    expect(result).toBeNull();
  });

  it('returns null for a token that has already been used', async () => {
    const getByEmail = jest
      .fn()
      .mockResolvedValue({ id: 10, email: 'al@example.com' });
    const repository = { getByEmail } as unknown as UsersRepository;
    const emailService = buildEmailService();
    const magicTokenRepo = new InMemoryMagicTokenRepository();
    const service = new UsersService(repository, emailService, magicTokenRepo);

    await service.requestMagicLink('al@example.com', 'password_reset');
    const sentToken = (emailService.sendMagicLinkEmail as jest.Mock).mock
      .calls[0][1];
    await service.verifyMagicToken(sentToken);

    const secondAttempt = await service.verifyMagicToken(sentToken);

    expect(secondAttempt).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const getByEmail = jest
      .fn()
      .mockResolvedValue({ id: 10, email: 'al@example.com' });
    const repository = { getByEmail } as unknown as UsersRepository;
    const emailService = buildEmailService();
    const magicTokenRepo = new InMemoryMagicTokenRepository();
    const service = new UsersService(repository, emailService, magicTokenRepo);

    await service.requestMagicLink('al@example.com', 'login');
    const sentToken = (emailService.sendMagicLinkEmail as jest.Mock).mock
      .calls[0][1];

    magicTokenRepo.setNow(new Date(Date.now() + 20 * 60 * 1000));

    const result = await service.verifyMagicToken(sentToken);

    expect(result).toBeNull();
  });
});
