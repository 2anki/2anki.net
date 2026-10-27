import { vi } from 'vitest';

import { InMemoryEmojiFeedbackRepository } from '../../data_layer/EmojiFeedbackRepository';
import type {
  ILowRatingContextRepository,
  LowRatingAccountContext,
} from '../../data_layer/LowRatingContextRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import { InMemoryRateLimiter } from '../../lib/rateLimit/InMemoryRateLimiter';
import { NotifyLowRatingUseCase } from './NotifyLowRatingUseCase';

const HOUR = 60 * 60 * 1000;

const account: LowRatingAccountContext = {
  email: 'owner@example.com',
  userId: '21770',
  isLifetime: false,
  hasActiveSubscription: true,
  activePass: null,
  latestJobId: 918,
  latestJobStatus: 'failed',
  latestUploadId: 4410,
  latestUploadAt: new Date('2026-10-19T11:58:00.000Z'),
};

const semesterPassHolder: LowRatingAccountContext = {
  email: 'pass-holder@example.com',
  userId: '27940',
  isLifetime: false,
  hasActiveSubscription: false,
  activePass: {
    id: 41,
    user_id: 27940,
    kind: '120d',
    expires_at: new Date('2027-02-03T20:27:40.000Z'),
    stripe_payment_intent_id: 'pi_fixture_semester',
  },
  latestJobId: null,
  latestJobStatus: null,
  latestUploadId: 912,
  latestUploadAt: new Date('2026-10-26T22:04:11.000Z'),
};

function build(
  limiterOptions = { windowMs: HOUR, perKeyMax: 50, globalMax: 50 }
) {
  const feedbackRepository = new InMemoryEmojiFeedbackRepository();
  const getByOwner = vi.fn().mockResolvedValue(account);
  const contextRepository: ILowRatingContextRepository = { getByOwner };
  const sendLowRatingFeedbackEmail = vi.fn().mockResolvedValue(undefined);
  const emailService = {
    sendLowRatingFeedbackEmail,
  } as unknown as IEmailService;
  const rateLimiter = new InMemoryRateLimiter(limiterOptions);
  const useCase = new NotifyLowRatingUseCase(
    feedbackRepository,
    contextRepository,
    emailService,
    rateLimiter
  );
  return {
    feedbackRepository,
    getByOwner,
    sendLowRatingFeedbackEmail,
    useCase,
  };
}

const base = {
  rating: 1,
  comment: 'cards are wrong',
  page: '/upload',
  email: 'typed@example.com',
  owner: null as number | null,
  ip: '203.0.113.5',
  now: new Date('2026-10-19T12:00:00.000Z'),
};

describe('NotifyLowRatingUseCase', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(base.now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not email a satisfied rating even with an email', async () => {
    const { useCase, sendLowRatingFeedbackEmail } = build();
    await useCase.notifyIfLowRating({ ...base, rating: 5 });
    expect(sendLowRatingFeedbackEmail).not.toHaveBeenCalled();
  });

  it('does not email a low rating that left no email', async () => {
    const { useCase, sendLowRatingFeedbackEmail } = build();
    await useCase.notifyIfLowRating({ ...base, email: null });
    expect(sendLowRatingFeedbackEmail).not.toHaveBeenCalled();
  });

  it('does not email when the page is not an in-app path', async () => {
    const { useCase, sendLowRatingFeedbackEmail } = build();
    await useCase.notifyIfLowRating({
      ...base,
      page: 'https://evil.example.com',
    });
    expect(sendLowRatingFeedbackEmail).not.toHaveBeenCalled();
  });

  it('emails an allowlisted Downloads prompt rating and links to the in-app path', async () => {
    const { useCase, sendLowRatingFeedbackEmail } = build();
    await useCase.notifyIfLowRating({
      ...base,
      comment: null,
      page: 'downloads/deck_done',
    });
    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledTimes(1);
    expect(sendLowRatingFeedbackEmail.mock.calls[0][0]).toMatchObject({
      rating: 1,
      page: '/downloads',
      replyTo: 'typed@example.com',
    });
  });

  it('does not email when the address is not a safe single address', async () => {
    const { useCase, sendLowRatingFeedbackEmail } = build();
    await useCase.notifyIfLowRating({
      ...base,
      email: 'a@b.com\nbcc: victim@example.com',
    });
    expect(sendLowRatingFeedbackEmail).not.toHaveBeenCalled();
  });

  it('emails anonymous feedback with no account details and an unverified address', async () => {
    const { useCase, getByOwner, sendLowRatingFeedbackEmail } = build();
    await useCase.notifyIfLowRating({ ...base, owner: null });
    expect(getByOwner).not.toHaveBeenCalled();
    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledTimes(1);
    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledWith({
      rating: 1,
      comment: 'cards are wrong',
      page: '/upload',
      replyTo: 'typed@example.com',
      emailVerified: false,
      userId: null,
      latestJobId: null,
      latestJobStatus: null,
      latestUploadId: null,
      latestUploadAt: null,
      plan: null,
    });
  });

  it('enriches when the signed-in user types their own email', async () => {
    const { useCase, getByOwner, sendLowRatingFeedbackEmail } = build();
    await useCase.notifyIfLowRating({
      ...base,
      owner: 21770,
      email: 'OWNER@example.com',
    });
    expect(getByOwner).toHaveBeenCalledWith(21770, base.now);
    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledWith({
      rating: 1,
      comment: 'cards are wrong',
      page: '/upload',
      replyTo: 'OWNER@example.com',
      emailVerified: true,
      userId: '21770',
      latestJobId: 918,
      latestJobStatus: 'failed',
      latestUploadId: 4410,
      latestUploadAt: new Date('2026-10-19T11:58:00.000Z'),
      plan: 'Stripe subscriber',
    });
  });

  it('names the pass and newest upload of a pass holder with no Notion jobs', async () => {
    const { useCase, getByOwner, sendLowRatingFeedbackEmail } = build();
    getByOwner.mockResolvedValue(semesterPassHolder);

    await useCase.notifyIfLowRating({
      ...base,
      owner: 27940,
      email: 'pass-holder@example.com',
    });

    expect(getByOwner).toHaveBeenCalledWith(27940, base.now);
    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledWith({
      rating: 1,
      comment: 'cards are wrong',
      page: '/upload',
      replyTo: 'pass-holder@example.com',
      emailVerified: true,
      userId: '27940',
      latestJobId: null,
      latestJobStatus: null,
      latestUploadId: 912,
      latestUploadAt: new Date('2026-10-26T22:04:11.000Z'),
      plan: 'Semester Pass (120d), active until 2027-02-03',
    });
  });

  it('includes no account details when the typed email differs from the session user', async () => {
    const { useCase, sendLowRatingFeedbackEmail } = build();
    await useCase.notifyIfLowRating({
      ...base,
      owner: 21770,
      email: 'someone-else@example.com',
    });
    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTo: 'someone-else@example.com',
        emailVerified: false,
        userId: null,
        latestUploadId: null,
        latestUploadAt: null,
        plan: null,
      })
    );
  });

  it('folds a second low rating from the same email on the same day', async () => {
    const { useCase, feedbackRepository, sendLowRatingFeedbackEmail } = build();
    await feedbackRepository.insert({
      rating: 1,
      comment: 'first',
      page: '/upload',
      email: 'typed@example.com',
    });
    await useCase.notifyIfLowRating(base);

    await feedbackRepository.insert({
      rating: 2,
      comment: 'second',
      page: '/upload',
      email: 'TYPED@example.com',
    });
    await useCase.notifyIfLowRating({ ...base, email: 'TYPED@example.com' });

    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledTimes(1);
  });

  it('stops sending past the per-IP limit', async () => {
    const { useCase, sendLowRatingFeedbackEmail } = build({
      windowMs: HOUR,
      perKeyMax: 5,
      globalMax: 100,
    });
    for (let i = 0; i < 6; i += 1) {
      await useCase.notifyIfLowRating({
        ...base,
        email: `person${i}@example.com`,
        ip: '198.51.100.9',
      });
    }
    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledTimes(5);
  });

  it('stops sending past the global hourly cap', async () => {
    const { useCase, sendLowRatingFeedbackEmail } = build({
      windowMs: HOUR,
      perKeyMax: 100,
      globalMax: 2,
    });
    for (let i = 0; i < 3; i += 1) {
      await useCase.notifyIfLowRating({
        ...base,
        email: `person${i}@example.com`,
        ip: `203.0.113.${i}`,
      });
    }
    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledTimes(2);
  });

  it('resolves without throwing when the support email fails', async () => {
    const { useCase, sendLowRatingFeedbackEmail } = build();
    sendLowRatingFeedbackEmail.mockRejectedValueOnce(
      new Error('sendgrid down')
    );
    await expect(useCase.notifyIfLowRating(base)).resolves.toBeUndefined();
    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledTimes(1);
  });
});
