import { vi } from 'vitest';
const send = vi.hoisted(() =>
  vi.fn().mockResolvedValue([{ statusCode: 202 }, {}])
);

vi.mock('@sendgrid/mail', () => {
  const sgMailMock = { setApiKey: vi.fn(), send };
  return { ...sgMailMock, default: sgMailMock };
});

import knex, { Knex } from 'knex';

import { InMemoryEmojiFeedbackRepository } from '../../data_layer/EmojiFeedbackRepository';
import {
  LowRatingContextRepository,
  type LowRatingAccountContext,
} from '../../data_layer/LowRatingContextRepository';
import type { PassKind, UserPass } from '../../data_layer/UserPassRepository';
import { InMemoryRateLimiter } from '../../lib/rateLimit/InMemoryRateLimiter';
import { EmailService } from '../../services/EmailService/EmailService';
import { DEFAULT_SENDER } from '../../services/EmailService/constants';
import { NotifyLowRatingUseCase } from './NotifyLowRatingUseCase';

const NOW = new Date('2026-11-02T10:00:00.000Z');

const pass = (kind: PassKind, key: string, expiresAt: string): UserPass => ({
  id: 41,
  user_id: 4242,
  kind,
  expires_at: new Date(expiresAt),
  stripe_payment_intent_id: key,
});

const uploadOnlyAccount: LowRatingAccountContext = {
  email: 'learner@example.com',
  userId: '4242',
  isLifetime: false,
  hasActiveSubscription: false,
  activePass: null,
  latestJobId: null,
  latestJobStatus: null,
  latestUploadId: 912,
  latestUploadAt: new Date('2026-11-02T09:30:00.000Z'),
};

async function renderSupportEmail(account: LowRatingAccountContext) {
  return renderWithContext({ getByOwner: async () => account }, account.email);
}

async function renderWithContext(
  contextRepository: ConstructorParameters<typeof NotifyLowRatingUseCase>[1],
  email: string
) {
  const useCase = new NotifyLowRatingUseCase(
    new InMemoryEmojiFeedbackRepository(),
    contextRepository,
    new EmailService('test-key', DEFAULT_SENDER),
    new InMemoryRateLimiter({
      windowMs: 60 * 60 * 1000,
      perKeyMax: 50,
      globalMax: 50,
    })
  );
  await useCase.notifyIfLowRating({
    rating: 1,
    comment: null,
    page: '/upload',
    email,
    owner: 4242,
    ip: '203.0.113.5',
    now: NOW,
  });
  expect(send).toHaveBeenCalledTimes(1);
  return send.mock.calls[0][0] as { text: string; html: string };
}

describe('NotifyLowRatingUseCase support email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const plans: Array<[string, Partial<LowRatingAccountContext>, string]> = [
    [
      'a lifetime member, ahead of a subscription and a pass',
      {
        isLifetime: true,
        hasActiveSubscription: true,
        activePass: pass(
          'unlimited',
          'apple:2000000000000001',
          '2026-11-20T08:00:00.000Z'
        ),
      },
      'lifetime',
    ],
    [
      'a Stripe subscriber, ahead of a pass',
      {
        hasActiveSubscription: true,
        activePass: pass('120d', 'pi_fixture', '2027-03-01T12:00:00.000Z'),
      },
      'Stripe subscriber',
    ],
    [
      'an Apple Pro subscriber',
      {
        activePass: pass(
          'unlimited',
          'apple:2000000000000001',
          '2026-11-20T08:00:00.000Z'
        ),
      },
      'Pro (Apple)',
    ],
    [
      'a Semester Pass holder',
      { activePass: pass('120d', 'pi_fixture', '2027-03-01T12:00:00.000Z') },
      'Semester Pass (120d), active until 2027-03-01 12:00 UTC',
    ],
    [
      'a Semester Pass bought in the iOS app',
      {
        activePass: pass(
          '120d',
          'apple:2000000000000002',
          '2027-03-01T12:00:00.000Z'
        ),
      },
      'Semester Pass (120d, Apple), active until 2027-03-01 12:00 UTC',
    ],
    [
      'a Week Pass holder',
      { activePass: pass('7d', 'pi_fixture', '2026-11-05T10:00:00.000Z') },
      'Week Pass (7d), active until 2026-11-05 10:00 UTC',
    ],
    [
      'a Day Pass holder',
      { activePass: pass('24h', 'pi_fixture', '2026-11-03T09:00:00.000Z') },
      'Day Pass (24h), active until 2026-11-03 09:00 UTC',
    ],
    ['a free account', {}, 'free'],
  ];

  it.each(plans)('prints the plan of %s', async (_who, overrides, plan) => {
    const msg = await renderSupportEmail({
      ...uploadOnlyAccount,
      ...overrides,
    });

    expect(msg.text.split('\n')).toContain(`Plan: ${plan}`);
    expect(msg.html).toContain(`<li>Plan: ${plan}</li>`);
    expect(msg.text).not.toMatch(/pi_fixture|apple:\d/);
    expect(msg.html).not.toMatch(/pi_fixture|apple:\d/);
  });

  it('prints the newest saved deck beside an empty job line', async () => {
    const msg = await renderSupportEmail(uploadOnlyAccount);

    expect(msg.text.split('\n')).toEqual(
      expect.arrayContaining([
        'Latest job: (none)',
        'Latest deck (My Decks): 912, built 2026-11-02T09:30:00.000Z',
      ])
    );
    expect(msg.html).toContain(
      '<li>Latest deck (My Decks): 912, built 2026-11-02T09:30:00.000Z</li>'
    );
  });

  it('says no deck is stored when My Decks is empty', async () => {
    const msg = await renderSupportEmail({
      ...uploadOnlyAccount,
      latestUploadId: null,
      latestUploadAt: null,
    });

    expect(msg.text.split('\n')).toContain(
      'Latest deck (My Decks): (none stored)'
    );
    expect(msg.html).toContain(
      '<li>Latest deck (My Decks): (none stored)</li>'
    );
  });

  it('says the build time is unknown when the stored deck has none', async () => {
    const msg = await renderSupportEmail({
      ...uploadOnlyAccount,
      latestUploadAt: null,
    });

    expect(msg.text.split('\n')).toContain(
      'Latest deck (My Decks): 912, built at an unknown time'
    );
  });

  describe('with the real context repository', () => {
    let db: Knex;

    beforeEach(async () => {
      db = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });
      await db.schema.createTable('users', (t) => {
        t.integer('id').primary();
        t.text('email').notNullable();
        t.boolean('patreon').defaultTo(false);
      });
      await db.schema.createTable('subscriptions', (t) => {
        t.increments('id').primary();
        t.text('email');
        t.text('linked_email');
        t.boolean('active').defaultTo(false);
      });
      await db.schema.createTable('jobs', (t) => {
        t.increments('id').primary();
        t.text('owner').notNullable();
        t.text('status');
      });
      await db.schema.createTable('user_passes', (t) => {
        t.increments('id').primary();
        t.integer('user_id').notNullable();
        t.text('kind').notNullable();
        t.timestamp('expires_at').notNullable();
        t.text('stripe_payment_intent_id').notNullable();
      });
      await db.schema.createTable('uploads', (t) => {
        t.increments('id').primary();
        t.integer('owner').notNullable();
        t.text('key').notNullable();
        t.text('filename');
        t.timestamp('created_at');
      });
    });

    afterEach(async () => {
      await db.destroy();
    });

    it('names the pass and newest saved deck of a pass holder with no Notion jobs', async () => {
      await db('users').insert({
        id: 4242,
        email: 'learner@example.com',
        patreon: false,
      });
      await db('user_passes').insert({
        user_id: 4242,
        kind: '120d',
        expires_at: new Date('2027-03-01T12:00:00.000Z'),
        stripe_payment_intent_id: 'pi_fixture',
      });
      await db('uploads').insert([
        {
          id: 911,
          owner: 4242,
          key: 'older.apkg',
          filename: 'Lecture 4.apkg',
          created_at: new Date('2026-11-02T09:00:00.000Z'),
        },
        {
          id: 912,
          owner: 4242,
          key: 'newer.apkg',
          filename: 'Lecture 5.apkg',
          created_at: new Date('2026-11-02T09:30:00.000Z'),
        },
      ]);

      const msg = await renderWithContext(
        new LowRatingContextRepository(db),
        'learner@example.com'
      );

      expect(msg.text.split('\n')).toEqual(
        expect.arrayContaining([
          'Plan: Semester Pass (120d), active until 2027-03-01 12:00 UTC',
          'Latest job: (none)',
          'Latest deck (My Decks): 912, built 2026-11-02T09:30:00.000Z',
        ])
      );
      expect(msg.text).not.toContain('Lecture');
      expect(msg.html).not.toContain('Lecture');
    });
  });
});
