import { vi } from 'vitest';
import { ResumeAbandonedCheckoutUseCase } from './ResumeAbandonedCheckoutUseCase';
import { InMemoryAbandonedCheckoutRecoveryRepository } from '../../data_layer/AbandonedCheckoutRecoveryRepository';

const TOKEN = 'f4b3a070-1f2e-4c3d-9a8b-7c6d5e4f3a2b';
const STRIPE_URL = 'https://buy.stripe.com/r/live_abc123';
const NOW = new Date('2026-06-05T12:00:00Z');
const FUTURE = new Date('2026-07-05T12:00:00Z');
const PAST = new Date('2026-06-01T12:00:00Z');

describe('ResumeAbandonedCheckoutUseCase', () => {
  let repo: InMemoryAbandonedCheckoutRecoveryRepository;
  let useCase: ResumeAbandonedCheckoutUseCase;

  beforeEach(() => {
    repo = new InMemoryAbandonedCheckoutRecoveryRepository();
    useCase = new ResumeAbandonedCheckoutUseCase(repo);
  });

  it('returns the Stripe recovery URL for a valid unexpired token', async () => {
    await repo.claimSession('cs_1', 'alice@example.com', TOKEN, {
      url: STRIPE_URL,
      expiresAt: FUTURE,
    });

    const result = await useCase.execute(TOKEN, NOW);

    expect(result).toEqual({ url: STRIPE_URL, resumed: true });
  });

  it('falls back to pricing when the recovery URL has expired', async () => {
    await repo.claimSession('cs_1', 'alice@example.com', TOKEN, {
      url: STRIPE_URL,
      expiresAt: PAST,
    });

    const result = await useCase.execute(TOKEN, NOW);

    expect(result).toEqual({ url: '/pricing?from=recovery', resumed: false });
  });

  it('treats a missing expiry as still valid', async () => {
    await repo.claimSession('cs_1', 'alice@example.com', TOKEN, {
      url: STRIPE_URL,
      expiresAt: null,
    });

    const result = await useCase.execute(TOKEN, NOW);

    expect(result).toEqual({ url: STRIPE_URL, resumed: true });
  });

  it('falls back for an unknown token', async () => {
    const result = await useCase.execute(TOKEN, NOW);

    expect(result).toEqual({ url: '/pricing?from=recovery', resumed: false });
  });

  it('falls back when the token row has no recovery URL (bulk send)', async () => {
    await repo.recordEmailSend('alice@example.com', TOKEN);

    const result = await useCase.execute(TOKEN, NOW);

    expect(result).toEqual({ url: '/pricing?from=recovery', resumed: false });
  });

  it.each([
    ['non-string input', 42],
    ['array input', [TOKEN]],
    ['undefined input', undefined],
    ['malformed token', 'not-a-uuid'],
    ['sql-ish token', "' OR 1=1 --"],
  ])(
    'falls back without querying the repository on %s',
    async (_label, token) => {
      const spy = vi.spyOn(repo, 'getRecoveryByToken');

      const result = await useCase.execute(token, NOW);

      expect(result).toEqual({ url: '/pricing?from=recovery', resumed: false });
      expect(spy).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['http (not https)', 'http://buy.stripe.com/r/live_abc'],
    ['non-Stripe host', 'https://evil.example.com/r/live_abc'],
    ['stripe.com lookalike suffix', 'https://notstripe.com/r/live_abc'],
    ['stripe.com in path only', 'https://evil.example.com/stripe.com'],
    ['not a URL', 'javascript:alert(1)'],
  ])('falls back when the stored URL is %s', async (_label, url) => {
    await repo.claimSession('cs_1', 'alice@example.com', TOKEN, {
      url,
      expiresAt: FUTURE,
    });

    const result = await useCase.execute(TOKEN, NOW);

    expect(result).toEqual({ url: '/pricing?from=recovery', resumed: false });
  });

  it('accepts checkout.stripe.com as a recovery host', async () => {
    await repo.claimSession('cs_1', 'alice@example.com', TOKEN, {
      url: 'https://checkout.stripe.com/c/pay/recovered_abc',
      expiresAt: FUTURE,
    });

    const result = await useCase.execute(TOKEN, NOW);

    expect(result).toEqual({
      url: 'https://checkout.stripe.com/c/pay/recovered_abc',
      resumed: true,
    });
  });
});
