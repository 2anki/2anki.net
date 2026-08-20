import {
  GrantUnclaimedPassUseCase,
  UsersByEmailRepository,
} from './GrantUnclaimedPassUseCase';
import { InMemoryAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import { InMemoryUserPassRepository as UserPassMem } from '../../data_layer/UserPassRepository';
import type { EventsSink } from '../../services/events/EventsSink';

function makeUsersRepo(id: number | null): UsersByEmailRepository {
  return {
    getByEmail: jest
      .fn()
      .mockResolvedValue(id == null ? undefined : { id }),
  };
}

function makeEventsSink(): Pick<EventsSink, 'record'> {
  return { record: jest.fn() };
}

const NOW = new Date('2026-08-20T12:00:00Z');

describe('GrantUnclaimedPassUseCase', () => {
  it('claims the pass to the user and grants a fresh window from now', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    const pass = await anonRepo.insert({
      stripeSessionId: 'cs_1',
      kind: '24h',
      expiresAt: new Date('2026-08-01T00:00:00Z'),
      paymentIntentId: 'pi_1',
    });
    const userPassRepo = new UserPassMem();
    const eventsSink = makeEventsSink();
    const useCase = new GrantUnclaimedPassUseCase(
      anonRepo,
      userPassRepo,
      makeUsersRepo(42),
      eventsSink
    );

    const outcome = await useCase.execute(
      { anonymousPassId: pass.id, email: 'buyer@example.com' },
      NOW
    );

    expect(outcome).toEqual({
      success: true,
      userId: 42,
      kind: '24h',
      expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    });
    const claimedPass = await anonRepo.findById(pass.id);
    expect(claimedPass?.claimed_by_user_id).toBe(42);
    const activeUserPass = await userPassRepo.findActive(42, NOW);
    expect(activeUserPass?.expires_at).toEqual(
      new Date(NOW.getTime() + 24 * 60 * 60 * 1000)
    );
    expect(eventsSink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'anonymous_pass_claimed',
        user_id: 42,
        props: { kind: '24h', method: 'ops' },
      })
    );
  });

  it('returns pass_not_found for a missing pass id', async () => {
    const useCase = new GrantUnclaimedPassUseCase(
      new InMemoryAnonymousPassRepository(),
      new UserPassMem(),
      makeUsersRepo(42)
    );

    const outcome = await useCase.execute(
      { anonymousPassId: 999, email: 'buyer@example.com' },
      NOW
    );

    expect(outcome).toEqual({ success: false, reason: 'pass_not_found' });
  });

  it('returns user_not_found when no account matches the email', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    const pass = await anonRepo.insert({
      stripeSessionId: 'cs_2',
      kind: '7d',
      expiresAt: new Date('2026-08-01T00:00:00Z'),
      paymentIntentId: 'pi_2',
    });
    const useCase = new GrantUnclaimedPassUseCase(
      anonRepo,
      new UserPassMem(),
      makeUsersRepo(null)
    );

    const outcome = await useCase.execute(
      { anonymousPassId: pass.id, email: 'nobody@example.com' },
      NOW
    );

    expect(outcome).toEqual({ success: false, reason: 'user_not_found' });
  });

  it('returns already_claimed when the pass belongs to a different user', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    const pass = await anonRepo.insert({
      stripeSessionId: 'cs_3',
      kind: '24h',
      expiresAt: new Date('2026-08-01T00:00:00Z'),
      paymentIntentId: 'pi_3',
    });
    await anonRepo.claim(pass.id, 7);
    const useCase = new GrantUnclaimedPassUseCase(
      anonRepo,
      new UserPassMem(),
      makeUsersRepo(42)
    );

    const outcome = await useCase.execute(
      { anonymousPassId: pass.id, email: 'buyer@example.com' },
      NOW
    );

    expect(outcome).toEqual({ success: false, reason: 'already_claimed' });
  });
});
