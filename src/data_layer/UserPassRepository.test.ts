import { InMemoryUserPassRepository } from './UserPassRepository';

const NOW = new Date('2026-05-16T12:00:00Z');
const DURATION_24H = 24 * 60 * 60 * 1000;
const DURATION_7D = 7 * 24 * 60 * 60 * 1000;

describe('InMemoryUserPassRepository', () => {
  let repo: InMemoryUserPassRepository;

  beforeEach(() => {
    repo = new InMemoryUserPassRepository();
  });

  describe('findActive', () => {
    it('returns null when no passes exist', async () => {
      const result = await repo.findActive(1, NOW);
      expect(result).toBeNull();
    });

    it('returns null when the only pass is expired', async () => {
      const expiredAt = new Date(NOW.getTime() - 1000);
      repo.seed({
        user_id: 1,
        kind: '24h',
        expires_at: expiredAt,
        stripe_payment_intent_id: 'pi_1',
      });
      const result = await repo.findActive(1, NOW);
      expect(result).toBeNull();
    });

    it('returns the active pass with the latest expiry', async () => {
      const soon = new Date(NOW.getTime() + DURATION_24H);
      const later = new Date(NOW.getTime() + DURATION_7D);
      repo.seed({
        user_id: 1,
        kind: '24h',
        expires_at: soon,
        stripe_payment_intent_id: 'pi_1',
      });
      repo.seed({
        user_id: 1,
        kind: '7d',
        expires_at: later,
        stripe_payment_intent_id: 'pi_2',
      });
      const result = await repo.findActive(1, NOW);
      expect(result?.stripe_payment_intent_id).toBe('pi_2');
      expect(result?.kind).toBe('7d');
    });

    it('does not return passes belonging to a different user', async () => {
      const future = new Date(NOW.getTime() + DURATION_24H);
      repo.seed({
        user_id: 2,
        kind: '24h',
        expires_at: future,
        stripe_payment_intent_id: 'pi_1',
      });
      const result = await repo.findActive(1, NOW);
      expect(result).toBeNull();
    });
  });

  describe('findActivePasses', () => {
    it('returns every active pass as a kind/expiry row, skipping expired ones', async () => {
      const soon = new Date(NOW.getTime() + DURATION_24H);
      const later = new Date(NOW.getTime() + DURATION_7D);
      const expiredAt = new Date(NOW.getTime() - 1000);
      repo.seed({
        user_id: 1,
        kind: '24h',
        expires_at: soon,
        stripe_payment_intent_id: 'pi_1',
      });
      repo.seed({
        user_id: 1,
        kind: '7d',
        expires_at: later,
        stripe_payment_intent_id: 'pi_2',
      });
      repo.seed({
        user_id: 1,
        kind: '24h',
        expires_at: expiredAt,
        stripe_payment_intent_id: 'pi_expired',
      });

      const rows = await repo.findActivePasses(1, NOW);

      expect(rows).toEqual([
        { kind: '24h', expiresAt: soon },
        { kind: '7d', expiresAt: later },
      ]);
    });

    it('does not return passes belonging to a different user', async () => {
      repo.seed({
        user_id: 2,
        kind: '24h',
        expires_at: new Date(NOW.getTime() + DURATION_24H),
        stripe_payment_intent_id: 'pi_1',
      });

      const rows = await repo.findActivePasses(1, NOW);

      expect(rows).toEqual([]);
    });
  });

  describe('existsByPaymentIntentId', () => {
    it('returns false when no pass matches the payment intent', async () => {
      const exists = await repo.existsByPaymentIntentId('pi_absent');
      expect(exists).toBe(false);
    });

    it('returns true when a pass matches the payment intent', async () => {
      repo.seed({
        user_id: 1,
        kind: '24h',
        expires_at: new Date(NOW.getTime() + DURATION_24H),
        stripe_payment_intent_id: 'pi_present',
      });
      const exists = await repo.existsByPaymentIntentId('pi_present');
      expect(exists).toBe(true);
    });
  });

  describe('upsertWithExtension', () => {
    it('inserts a fresh pass when no active pass exists', async () => {
      const pass = await repo.upsertWithExtension(
        1,
        '24h',
        DURATION_24H,
        'pi_1',
        NOW
      );
      expect(pass.user_id).toBe(1);
      expect(pass.kind).toBe('24h');
      expect(pass.expires_at.getTime()).toBe(NOW.getTime() + DURATION_24H);
      expect(pass.stripe_payment_intent_id).toBe('pi_1');
    });

    it('extends from the current active expiry when a pass is already active', async () => {
      const firstExpiry = new Date(NOW.getTime() + DURATION_24H);
      repo.seed({
        user_id: 1,
        kind: '24h',
        expires_at: firstExpiry,
        stripe_payment_intent_id: 'pi_1',
      });

      const extended = await repo.upsertWithExtension(
        1,
        '7d',
        DURATION_7D,
        'pi_2',
        NOW
      );
      expect(extended.expires_at.getTime()).toBe(
        firstExpiry.getTime() + DURATION_7D
      );
    });

    it('returns the existing row on duplicate payment_intent (idempotency)', async () => {
      const first = await repo.upsertWithExtension(
        1,
        '24h',
        DURATION_24H,
        'pi_dup',
        NOW
      );
      const second = await repo.upsertWithExtension(
        1,
        '24h',
        DURATION_24H,
        'pi_dup',
        NOW
      );
      expect(second.id).toBe(first.id);
      expect(second.expires_at.getTime()).toBe(first.expires_at.getTime());
    });

    it('does not create a second row on idempotent call', async () => {
      await repo.upsertWithExtension(1, '24h', DURATION_24H, 'pi_dup', NOW);
      await repo.upsertWithExtension(1, '24h', DURATION_24H, 'pi_dup', NOW);
      const active = await repo.findActive(1, NOW);
      expect(active?.stripe_payment_intent_id).toBe('pi_dup');
    });
  });

  describe('upsertWithAbsoluteExpiry', () => {
    const EXPIRES = new Date('2026-06-15T00:00:00Z');

    it('sets the expiry to the absolute date, not an accumulated duration', async () => {
      const seeded = new Date(NOW.getTime() + DURATION_7D);
      repo.seed({
        user_id: 1,
        kind: '24h',
        expires_at: seeded,
        stripe_payment_intent_id: 'pi_1',
      });

      const pass = await repo.upsertWithAbsoluteExpiry(
        1,
        'unlimited',
        EXPIRES,
        'apple:sub-1'
      );
      expect(pass.kind).toBe('unlimited');
      expect(pass.expires_at).toEqual(EXPIRES);
    });

    it('returns the existing row on a duplicate idempotency key', async () => {
      const first = await repo.upsertWithAbsoluteExpiry(
        1,
        'unlimited',
        EXPIRES,
        'apple:sub-1'
      );
      const second = await repo.upsertWithAbsoluteExpiry(
        1,
        'unlimited',
        EXPIRES,
        'apple:sub-1'
      );
      expect(second.id).toBe(first.id);
    });
  });
});
