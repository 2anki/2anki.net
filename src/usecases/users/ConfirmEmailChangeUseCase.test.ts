import { ConfirmEmailChangeUseCase } from './ConfirmEmailChangeUseCase';
import InMemoryEmailChangeTokenRepository from '../../data_layer/InMemoryEmailChangeTokenRepository';
import type UsersRepository from '../../data_layer/UsersRepository';
import type { EmailChangeResult } from '../../data_layer/UsersRepository';

process.env.THE_HASHING_SECRET = 'test-secret-for-jest';

import hmacToken from '../../lib/misc/hmacToken';

const RAW_TOKEN = 'raw-confirm-token';

const seedToken = async (
  repo: InMemoryEmailChangeTokenRepository,
  overrides: { expiresAt?: Date; consumed?: boolean } = {}
) => {
  const row = await repo.insert({
    user_id: 7 as never,
    new_email: 'new@example.com',
    token_hash: hmacToken(RAW_TOKEN),
    expires_at: overrides.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000),
  });
  if (overrides.consumed) {
    await repo.markConsumed(Number(row.id));
  }
  return row;
};

const makeUsersRepo = (options: {
  collision?: { id: number } | null;
  applyResult?: EmailChangeResult;
}) =>
  ({
    getByEmail: jest.fn().mockResolvedValue(options.collision ?? undefined),
    applyEmailChange: jest
      .fn()
      .mockResolvedValue(options.applyResult ?? { ok: true }),
  }) as unknown as UsersRepository;

describe('ConfirmEmailChangeUseCase', () => {
  it('returns invalid_token when the token is unknown', async () => {
    const useCase = new ConfirmEmailChangeUseCase(
      new InMemoryEmailChangeTokenRepository(),
      makeUsersRepo({}),
      jest.fn()
    );

    expect(await useCase.execute('missing')).toEqual({
      ok: false,
      reason: 'invalid_token',
    });
  });

  it('returns invalid_token for an expired token', async () => {
    const repo = new InMemoryEmailChangeTokenRepository();
    await seedToken(repo, { expiresAt: new Date(Date.now() - 1000) });

    const useCase = new ConfirmEmailChangeUseCase(
      repo,
      makeUsersRepo({}),
      jest.fn()
    );

    expect(await useCase.execute(RAW_TOKEN)).toEqual({
      ok: false,
      reason: 'invalid_token',
    });
  });

  it('returns invalid_token for an already-consumed token', async () => {
    const repo = new InMemoryEmailChangeTokenRepository();
    await seedToken(repo, { consumed: true });

    const useCase = new ConfirmEmailChangeUseCase(
      repo,
      makeUsersRepo({}),
      jest.fn()
    );

    expect(await useCase.execute(RAW_TOKEN)).toEqual({
      ok: false,
      reason: 'invalid_token',
    });
  });

  it('fails cleanly when a colliding account exists at confirm time', async () => {
    const repo = new InMemoryEmailChangeTokenRepository();
    await seedToken(repo);
    const revokeSessions = jest.fn();

    const useCase = new ConfirmEmailChangeUseCase(
      repo,
      makeUsersRepo({ collision: { id: 99 } }),
      revokeSessions
    );

    expect(await useCase.execute(RAW_TOKEN)).toEqual({
      ok: false,
      reason: 'email_taken',
    });
    expect(revokeSessions).not.toHaveBeenCalled();
  });

  it('applies the change and revokes every session on success', async () => {
    const repo = new InMemoryEmailChangeTokenRepository();
    const token = await seedToken(repo);
    const usersRepo = makeUsersRepo({});
    const revokeSessions = jest.fn().mockResolvedValue(undefined);

    const useCase = new ConfirmEmailChangeUseCase(
      repo,
      usersRepo,
      revokeSessions
    );

    expect(await useCase.execute(RAW_TOKEN)).toEqual({ ok: true, userId: 7 });
    expect(usersRepo.applyEmailChange).toHaveBeenCalledWith({
      userId: 7,
      newEmail: 'new@example.com',
      tokenId: Number(token.id),
    });
    expect(revokeSessions).toHaveBeenCalledWith(7);
  });

  it('returns email_taken and keeps sessions when the transaction loses the race', async () => {
    const repo = new InMemoryEmailChangeTokenRepository();
    await seedToken(repo);
    const revokeSessions = jest.fn();

    const useCase = new ConfirmEmailChangeUseCase(
      repo,
      makeUsersRepo({ applyResult: { ok: false, reason: 'email_taken' } }),
      revokeSessions
    );

    expect(await useCase.execute(RAW_TOKEN)).toEqual({
      ok: false,
      reason: 'email_taken',
    });
    expect(revokeSessions).not.toHaveBeenCalled();
  });
});
