import { InMemoryUserPassRepository } from '../../data_layer/UserPassRepository';
import { InMemoryAppleTransactionsRepository } from '../../data_layer/AppleTransactionsRepository';
import {
  AppleUnavailableError,
  AppleVerificationError,
  type DecodedAppleTransaction,
  type IAppleStoreKitService,
} from '../../services/AppleStoreKitService';
jest.mock('../../services/events/eventsSinkInstance', () => {
  const recorded: unknown[] = [];
  return {
    getEventsSink: () => ({
      record: jest.fn((row: unknown) => recorded.push(row)),
    }),
    resetEventsSinkForTesting: jest.fn(),
    __recorded: recorded,
  };
});

import { RedeemAppleTransactionUseCase } from './RedeemAppleTransactionUseCase';
import { IapRedeemError } from './IapRedeemError';

function recordedEvents(): Array<Record<string, unknown>> {
  return (
    jest.requireMock('../../services/events/eventsSinkInstance') as {
      __recorded: Array<Record<string, unknown>>;
    }
  ).__recorded;
}

const NOW = new Date('2026-06-01T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const USER_ID = 42;

function decoded(
  overrides: Partial<DecodedAppleTransaction> = {}
): DecodedAppleTransaction {
  return {
    transactionId: 'txn-1',
    productId: 'daypass.24h',
    bundleId: 'net.2anki.app',
    environment: 'Sandbox',
    ...overrides,
  };
}

function serviceReturning(
  value: DecodedAppleTransaction
): IAppleStoreKitService {
  return { verifyTransaction: jest.fn().mockResolvedValue(value) };
}

function serviceThrowing(error: Error): IAppleStoreKitService {
  return { verifyTransaction: jest.fn().mockRejectedValue(error) };
}

function build(service: IAppleStoreKitService) {
  const passes = new InMemoryUserPassRepository();
  const ledger = new InMemoryAppleTransactionsRepository();
  const useCase = new RedeemAppleTransactionUseCase(
    service,
    passes,
    ledger,
    () => NOW
  );
  return { useCase, passes, ledger };
}

describe('RedeemAppleTransactionUseCase', () => {
  beforeAll(() => {
    process.env.THE_HASHING_SECRET = 'test-hashing-secret';
  });

  beforeEach(() => {
    recordedEvents().length = 0;
  });

  it.each([
    {
      productId: 'daypass.24h',
      kind: '24h',
      message: 'Day Pass active — unlimited cards for the next 24 hours',
      durationMs: DAY_MS,
    },
    {
      productId: 'weekpass.7d',
      kind: '7d',
      message: 'Week Pass active — unlimited cards for the next 7 days',
      durationMs: 7 * DAY_MS,
    },
    {
      productId: 'semesterpass.120d',
      kind: '120d',
      message: 'Semester Pass active — unlimited cards for the next 120 days',
      durationMs: 120 * DAY_MS,
    },
  ])(
    'grants $kind for a valid $productId transaction',
    async ({ productId, kind, message, durationMs }) => {
      const { useCase, passes } = build(
        serviceReturning(decoded({ productId, transactionId: 't' }))
      );

      const result = await useCase.execute({
        userId: USER_ID,
        jws: 'signed',
        productId,
      });

      expect(result.message).toBe(message);
      expect(result.pass.kind).toBe(kind);
      const active = await passes.findActive(USER_ID, NOW);
      expect(active?.expires_at).toEqual(new Date(NOW.getTime() + durationMs));
    }
  );

  it('accumulates onto an existing active pass window', async () => {
    const { useCase, passes } = build(
      serviceReturning(
        decoded({ productId: 'daypass.24h', transactionId: 't2' })
      )
    );
    passes.seed({
      user_id: USER_ID,
      kind: '24h',
      expires_at: new Date(NOW.getTime() + DAY_MS),
      stripe_payment_intent_id: 'apple:earlier',
    });

    const result = await useCase.execute({
      userId: USER_ID,
      jws: 'signed',
      productId: 'daypass.24h',
    });

    expect(result.pass.expiresAt).toEqual(new Date(NOW.getTime() + 2 * DAY_MS));
  });

  it('returns 409 for an already-credited transaction and grants nothing new', async () => {
    const { useCase, ledger } = build(
      serviceReturning(decoded({ transactionId: 'dupe' }))
    );
    await ledger.record(
      {
        userId: USER_ID,
        transactionId: 'dupe',
        productId: 'daypass.24h',
        environment: 'Sandbox',
      },
      NOW
    );

    await expect(
      useCase.execute({
        userId: USER_ID,
        jws: 'signed',
        productId: 'daypass.24h',
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('returns 400 and credits nothing when verification fails', async () => {
    const { useCase, passes, ledger } = build(
      serviceThrowing(new AppleVerificationError())
    );

    await expect(
      useCase.execute({ userId: USER_ID, jws: 'bad', productId: 'daypass.24h' })
    ).rejects.toMatchObject({ status: 400 });

    expect(await passes.findActive(USER_ID, NOW)).toBeNull();
    await expect(
      ledger.record(
        {
          userId: USER_ID,
          transactionId: 'txn-1',
          productId: 'daypass.24h',
          environment: 'Sandbox',
        },
        NOW
      )
    ).resolves.toBeDefined();
  });

  it('returns 502 when Apple is unavailable', async () => {
    const { useCase } = build(serviceThrowing(new AppleUnavailableError()));

    await expect(
      useCase.execute({
        userId: USER_ID,
        jws: 'signed',
        productId: 'daypass.24h',
      })
    ).rejects.toMatchObject({ status: 502 });
  });

  it('returns 400 when the decoded product id does not match the body', async () => {
    const { useCase } = build(
      serviceReturning(decoded({ productId: 'weekpass.7d' }))
    );

    await expect(
      useCase.execute({
        userId: USER_ID,
        jws: 'signed',
        productId: 'daypass.24h',
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 for an unmapped product', async () => {
    const { useCase } = build(
      serviceReturning(decoded({ productId: 'lifetime.forever' }))
    );

    await expect(
      useCase.execute({
        userId: USER_ID,
        jws: 'signed',
        productId: 'lifetime.forever',
      })
    ).rejects.toBeInstanceOf(IapRedeemError);
  });

  describe('native_app_activated telemetry', () => {
    it('emits native_app_activated with attribution props on a consumable grant', async () => {
      const { useCase } = build(
        serviceReturning(
          decoded({ productId: 'daypass.24h', transactionId: 't' })
        )
      );

      await useCase.execute({
        userId: USER_ID,
        jws: 'signed',
        productId: 'daypass.24h',
      });

      expect(recordedEvents()).toHaveLength(1);
      expect(recordedEvents()[0]).toMatchObject({
        name: 'native_app_activated',
        user_id: USER_ID,
        props: {
          platform: 'apple',
          product_kind: 'consumable',
          pass_kind: '24h',
          environment: 'Sandbox',
        },
      });
    });

    it('emits native_app_activated for a subscription grant', async () => {
      const { useCase } = build(
        serviceReturning(
          decoded({
            productId: 'unlimited.monthly',
            transactionId: 'sub-1',
            environment: 'Production',
            expiresDateMs: new Date('2026-07-01T00:00:00.000Z').getTime(),
          })
        )
      );

      await useCase.execute({
        userId: USER_ID,
        jws: 'signed',
        productId: 'unlimited.monthly',
      });

      expect(recordedEvents()[0]).toMatchObject({
        name: 'native_app_activated',
        props: {
          product_kind: 'subscription',
          pass_kind: 'unlimited',
          environment: 'Production',
        },
      });
    });

    it('does not emit native_app_activated when verification fails', async () => {
      const { useCase } = build(serviceThrowing(new AppleVerificationError()));

      await expect(
        useCase.execute({
          userId: USER_ID,
          jws: 'bad',
          productId: 'daypass.24h',
        })
      ).rejects.toMatchObject({ status: 400 });

      expect(recordedEvents()).toHaveLength(0);
    });

    it('does not emit native_app_activated for an already-credited transaction', async () => {
      const { useCase, ledger } = build(
        serviceReturning(decoded({ transactionId: 'dupe' }))
      );
      await ledger.record(
        {
          userId: USER_ID,
          transactionId: 'dupe',
          productId: 'daypass.24h',
          environment: 'Sandbox',
        },
        NOW
      );

      await expect(
        useCase.execute({
          userId: USER_ID,
          jws: 'signed',
          productId: 'daypass.24h',
        })
      ).rejects.toMatchObject({ status: 409 });

      expect(recordedEvents()).toHaveLength(0);
    });
  });

  describe('unlimited.monthly subscription', () => {
    const EXPIRES = new Date('2026-07-01T00:00:00.000Z');

    function subscriptionDecoded(
      transactionId: string,
      expiresDateMs: number = EXPIRES.getTime()
    ): DecodedAppleTransaction {
      return decoded({
        transactionId,
        productId: 'unlimited.monthly',
        environment: 'Production',
        expiresDateMs,
      });
    }

    it('grants an unlimited pass that expires exactly at the decoded expiresDate', async () => {
      const { useCase, passes, ledger } = build(
        serviceReturning(subscriptionDecoded('sub-1'))
      );

      const result = await useCase.execute({
        userId: USER_ID,
        jws: 'signed',
        productId: 'unlimited.monthly',
      });

      expect(result.message).toBe(
        'Unlimited active — no card limit, PDF uploads, and several conversions at once'
      );
      expect(result.pass.kind).toBe('unlimited');
      const active = await passes.findActive(USER_ID, NOW);
      expect(active?.kind).toBe('unlimited');
      expect(active?.expires_at).toEqual(EXPIRES);
      await expect(
        ledger.record(
          {
            userId: USER_ID,
            transactionId: 'sub-1',
            productId: 'unlimited.monthly',
            environment: 'Production',
          },
          NOW
        )
      ).rejects.toMatchObject({ name: 'DuplicateAppleTransactionError' });
    });

    it('sets the window to the renewal expiry rather than accumulating', async () => {
      const RENEWAL = new Date('2026-08-01T00:00:00.000Z');
      const { useCase, passes } = build(
        serviceReturning(subscriptionDecoded('sub-1'))
      );
      await useCase.execute({
        userId: USER_ID,
        jws: 'signed',
        productId: 'unlimited.monthly',
      });

      const renewalCase = new RedeemAppleTransactionUseCase(
        serviceReturning(subscriptionDecoded('sub-2', RENEWAL.getTime())),
        passes,
        new InMemoryAppleTransactionsRepository(),
        () => NOW
      );
      const result = await renewalCase.execute({
        userId: USER_ID,
        jws: 'signed',
        productId: 'unlimited.monthly',
      });

      expect(result.pass.expiresAt).toEqual(RENEWAL);
      const active = await passes.findActive(USER_ID, NOW);
      expect(active?.expires_at).toEqual(RENEWAL);
    });

    it('returns 400 when a subscription JWS carries no expiresDate', async () => {
      const { useCase, passes } = build(
        serviceReturning(
          decoded({
            transactionId: 'sub-1',
            productId: 'unlimited.monthly',
            environment: 'Production',
          })
        )
      );

      await expect(
        useCase.execute({
          userId: USER_ID,
          jws: 'signed',
          productId: 'unlimited.monthly',
        })
      ).rejects.toMatchObject({ status: 400 });
      expect(await passes.findActive(USER_ID, NOW)).toBeNull();
    });
  });
});
