import { ValidateAnonymousPassUseCase } from './ValidateAnonymousPassUseCase';
import { InMemoryAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';

describe('ValidateAnonymousPassUseCase', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  let repo: InMemoryAnonymousPassRepository;
  let useCase: ValidateAnonymousPassUseCase;

  beforeEach(() => {
    repo = new InMemoryAnonymousPassRepository();
    useCase = new ValidateAnonymousPassUseCase(repo);
  });

  it('returns valid=true and the pass for a valid unexpired token', async () => {
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await repo.insert({
      stripeSessionId: 'cs_valid',
      kind: '24h',
      expiresAt,
      paymentIntentId: 'pi_1',
    });

    const result = await useCase.execute('cs_valid', now);
    expect(result.valid).toBe(true);
    expect(result.pass).toMatchObject({
      stripe_session_id: 'cs_valid',
      kind: '24h',
    });
  });

  it('returns valid=false for an expired token', async () => {
    const expiresAt = new Date(now.getTime() - 1000);
    await repo.insert({
      stripeSessionId: 'cs_expired',
      kind: '24h',
      expiresAt,
      paymentIntentId: 'pi_2',
    });

    const result = await useCase.execute('cs_expired', now);
    expect(result.valid).toBe(false);
    expect(result.pass).toBeUndefined();
  });

  it('returns valid=false for a claimed pass without calling Stripe', async () => {
    const retrieve = jest.fn();
    const withStripe = new ValidateAnonymousPassUseCase(repo, {
      checkout: { sessions: { retrieve } },
    } as never);
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const pass = await repo.insert({
      stripeSessionId: 'cs_claimed',
      kind: '7d',
      expiresAt,
      paymentIntentId: 'pi_c',
    });
    await repo.claim(pass.id, 42);

    const result = await withStripe.execute('cs_claimed', now);
    expect(result.valid).toBe(false);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('returns valid=false when no record exists', async () => {
    const result = await useCase.execute('cs_nonexistent', now);
    expect(result.valid).toBe(false);
  });

  it('returns valid=false for an empty session id', async () => {
    const result = await useCase.execute('', now);
    expect(result.valid).toBe(false);
  });

  it('activates an unused pass on first validation, starting the clock from now', async () => {
    const claimDeadline = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await repo.insert({
      stripeSessionId: 'cs_fresh',
      kind: '24h',
      expiresAt: claimDeadline,
      paymentIntentId: 'pi_f',
    });

    const result = await useCase.execute('cs_fresh', now);

    expect(result.valid).toBe(true);
    const stored = await repo.findBySessionId('cs_fresh');
    expect(stored?.activated_at).toEqual(now);
    expect(stored?.expires_at).toEqual(
      new Date(now.getTime() + 24 * 60 * 60 * 1000)
    );
  });

  it('does not restart the window for an already-activated pass', async () => {
    const pass = await repo.insert({
      stripeSessionId: 'cs_used',
      kind: '24h',
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      paymentIntentId: 'pi_u',
    });
    const activatedExpiry = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    await repo.activate(
      pass.id,
      new Date(now.getTime() - 22 * 60 * 60 * 1000),
      activatedExpiry
    );

    const result = await useCase.execute('cs_used', now);

    expect(result.valid).toBe(true);
    expect(result.pass?.expires_at).toEqual(activatedExpiry);
    const stored = await repo.findBySessionId('cs_used');
    expect(stored?.expires_at).toEqual(activatedExpiry);
  });

  describe('Stripe reconciliation when the webhook has not landed yet', () => {
    const paidSession = {
      payment_status: 'paid',
      payment_intent: 'pi_live',
      created: Math.floor(now.getTime() / 1000),
      metadata: { pass_kind: '24h', pass_anonymous: '1' },
    };

    function useCaseWith(retrieve: jest.Mock) {
      return new ValidateAnonymousPassUseCase(repo, {
        checkout: { sessions: { retrieve } },
      } as never);
    }

    it('reconciles a paid anonymous session and persists the pass when no record exists', async () => {
      const retrieve = jest.fn().mockResolvedValue(paidSession);
      const result = await useCaseWith(retrieve).execute('cs_new', now);

      expect(retrieve).toHaveBeenCalledWith('cs_new');
      expect(result.valid).toBe(true);
      expect(result.pass).toMatchObject({
        stripe_session_id: 'cs_new',
        kind: '24h',
      });
      expect(await repo.findBySessionId('cs_new')).not.toBeNull();
    });

    it('activates a reconciled pass to the duration window, not the 30-day deadline', async () => {
      const retrieve = jest.fn().mockResolvedValue(paidSession);

      const result = await useCaseWith(retrieve).execute('cs_new2', now);

      expect(result.valid).toBe(true);
      const stored = await repo.findBySessionId('cs_new2');
      expect(stored?.activated_at).toEqual(now);
      expect(stored?.expires_at).toEqual(
        new Date(now.getTime() + 24 * 60 * 60 * 1000)
      );
    });

    it('returns valid=false for an unpaid session', async () => {
      const retrieve = jest
        .fn()
        .mockResolvedValue({ ...paidSession, payment_status: 'unpaid' });
      const result = await useCaseWith(retrieve).execute('cs_unpaid', now);

      expect(result.valid).toBe(false);
      expect(await repo.findBySessionId('cs_unpaid')).toBeNull();
    });

    it('returns valid=false when the session is not an anonymous pass', async () => {
      const retrieve = jest
        .fn()
        .mockResolvedValue({ ...paidSession, metadata: { pass_kind: '24h' } });
      const result = await useCaseWith(retrieve).execute('cs_notanon', now);

      expect(result.valid).toBe(false);
    });

    it('does not call Stripe for tokens without the cs_ prefix', async () => {
      const retrieve = jest.fn();
      const result = await useCaseWith(retrieve).execute('not-a-session', now);

      expect(retrieve).not.toHaveBeenCalled();
      expect(result.valid).toBe(false);
    });

    it('returns valid=false when Stripe retrieval throws', async () => {
      const retrieve = jest
        .fn()
        .mockRejectedValue(new Error('no such session'));
      const result = await useCaseWith(retrieve).execute('cs_boom', now);

      expect(result.valid).toBe(false);
    });
  });
});
