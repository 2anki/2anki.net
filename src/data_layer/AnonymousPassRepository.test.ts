import { InMemoryAnonymousPassRepository } from './AnonymousPassRepository';
import type { PassKind } from './UserPassRepository';

describe('InMemoryAnonymousPassRepository', () => {
  let repo: InMemoryAnonymousPassRepository;
  const now = new Date('2026-06-01T12:00:00Z');

  beforeEach(() => {
    repo = new InMemoryAnonymousPassRepository();
  });

  it('findBySessionId returns null when no record exists', async () => {
    const result = await repo.findBySessionId('cs_nonexistent');
    expect(result).toBeNull();
  });

  it('insert stores a record retrievable by session id', async () => {
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await repo.insert({
      stripeSessionId: 'cs_test_123',
      kind: '24h',
      expiresAt,
      paymentIntentId: 'pi_test_456',
    });

    const found = await repo.findBySessionId('cs_test_123');
    expect(found).toMatchObject({
      stripe_session_id: 'cs_test_123',
      kind: '24h' as PassKind,
      payment_intent_id: 'pi_test_456',
    });
    expect(found?.expires_at).toEqual(expiresAt);
  });

  it('findActive returns the record when not expired', async () => {
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await repo.insert({
      stripeSessionId: 'cs_active',
      kind: '24h',
      expiresAt,
      paymentIntentId: 'pi_1',
    });

    const result = await repo.findActive('cs_active', now);
    expect(result).not.toBeNull();
    expect(result?.stripe_session_id).toBe('cs_active');
  });

  it('findActive returns null when record is expired', async () => {
    const expiresAt = new Date(now.getTime() - 1000);
    await repo.insert({
      stripeSessionId: 'cs_expired',
      kind: '24h',
      expiresAt,
      paymentIntentId: 'pi_2',
    });

    const result = await repo.findActive('cs_expired', now);
    expect(result).toBeNull();
  });

  it('findActive returns null when session id not found', async () => {
    const result = await repo.findActive('cs_missing', now);
    expect(result).toBeNull();
  });

  it('insert is idempotent on same payment_intent_id', async () => {
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await repo.insert({
      stripeSessionId: 'cs_idem',
      kind: '24h',
      expiresAt,
      paymentIntentId: 'pi_idem',
    });
    await repo.insert({
      stripeSessionId: 'cs_idem',
      kind: '24h',
      expiresAt,
      paymentIntentId: 'pi_idem',
    });

    const found = await repo.findBySessionId('cs_idem');
    expect(found).not.toBeNull();
  });

  describe('endByPaymentIntentId', () => {
    it('ends a running pass at now so it can no longer be validated', async () => {
      await repo.insert({
        stripeSessionId: 'cs_refund',
        kind: '24h',
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        paymentIntentId: 'pi_refund',
      });

      const ended = await repo.endByPaymentIntentId('pi_refund', now);

      expect(ended).toEqual([
        expect.objectContaining({
          stripe_session_id: 'cs_refund',
          kind: '24h',
          expires_at: now,
        }),
      ]);
      expect(await repo.findActive('cs_refund', now)).toBeNull();
    });

    it('returns nothing on a repeated call', async () => {
      await repo.insert({
        stripeSessionId: 'cs_refund',
        kind: '7d',
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        paymentIntentId: 'pi_refund',
      });

      await repo.endByPaymentIntentId('pi_refund', now);
      const second = await repo.endByPaymentIntentId(
        'pi_refund',
        new Date(now.getTime() + 60_000)
      );

      expect(second).toEqual([]);
      const [pass] = await repo.findByPaymentIntentId('pi_refund');
      expect(pass.expires_at).toEqual(now);
    });

    it('does not touch passes bought with a different payment intent', async () => {
      const otherExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      await repo.insert({
        stripeSessionId: 'cs_other',
        kind: '24h',
        expiresAt: otherExpiry,
        paymentIntentId: 'pi_other',
      });

      const ended = await repo.endByPaymentIntentId('pi_refund', now);

      expect(ended).toEqual([]);
      const other = await repo.findBySessionId('cs_other');
      expect(other?.expires_at).toEqual(otherExpiry);
    });
  });
});
