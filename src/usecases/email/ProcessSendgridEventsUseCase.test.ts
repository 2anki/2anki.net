import {
  InMemorySuppressionEventsRepository,
  ISuppressionEventsRepository,
  RecordSuppressionEvent,
} from '../../data_layer/SuppressionEventsRepository';
import { emailHash } from '../../lib/emailHash';
import {
  ProcessSendgridEventsUseCase,
  SendgridEventProcessingError,
} from './ProcessSendgridEventsUseCase';

describe('ProcessSendgridEventsUseCase', () => {
  const address = 'bounced@example.com';

  it('persists a hard-suppression event and suppresses the address', async () => {
    const repo = new InMemorySuppressionEventsRepository();
    const useCase = new ProcessSendgridEventsUseCase(repo);

    const result = await useCase.execute([
      {
        email: address,
        event: 'bounce',
        sg_event_id: 'evt-1',
        timestamp: 1_780_000_000,
      },
    ]);

    expect(result).toEqual({
      recorded: 1,
      skipped: 0,
      duplicates: 0,
      categories: { uncategorized: { bounce: 1 } },
    });
    expect(await repo.isSuppressed(emailHash(address))).toBe(true);
  });

  it('records all four hard event types', async () => {
    const repo = new InMemorySuppressionEventsRepository();
    const useCase = new ProcessSendgridEventsUseCase(repo);

    const result = await useCase.execute([
      { email: 'a@x.com', event: 'bounce', sg_event_id: 'e1', timestamp: 1 },
      { email: 'b@x.com', event: 'dropped', sg_event_id: 'e2', timestamp: 2 },
      {
        email: 'c@x.com',
        event: 'spamreport',
        sg_event_id: 'e3',
        timestamp: 3,
      },
      { email: 'd@x.com', event: 'blocked', sg_event_id: 'e4', timestamp: 4 },
    ]);

    expect(result.recorded).toBe(4);
    expect(await repo.isSuppressed(emailHash('a@x.com'))).toBe(true);
    expect(await repo.isSuppressed(emailHash('d@x.com'))).toBe(true);
  });

  it('records a deferred event without suppressing the address', async () => {
    const repo = new InMemorySuppressionEventsRepository();
    const useCase = new ProcessSendgridEventsUseCase(repo);

    await useCase.execute([
      {
        email: address,
        event: 'deferred',
        sg_event_id: 'evt-deferred',
        timestamp: 1_780_000_000,
      },
    ]);

    expect(await repo.isSuppressed(emailHash(address))).toBe(false);
  });

  it('clears suppression when a later delivered event arrives', async () => {
    const repo = new InMemorySuppressionEventsRepository();
    const useCase = new ProcessSendgridEventsUseCase(repo);

    await useCase.execute([
      {
        email: address,
        event: 'bounce',
        sg_event_id: 'evt-bounce',
        timestamp: 1_780_000_000,
      },
      {
        email: address,
        event: 'delivered',
        sg_event_id: 'evt-delivered',
        timestamp: 1_780_000_100,
      },
    ]);

    expect(await repo.isSuppressed(emailHash(address))).toBe(false);
  });

  it('skips events we do not track', async () => {
    const repo = new InMemorySuppressionEventsRepository();
    const useCase = new ProcessSendgridEventsUseCase(repo);

    const result = await useCase.execute([
      { email: address, event: 'open', sg_event_id: 'evt-open', timestamp: 1 },
      {
        email: address,
        event: 'click',
        sg_event_id: 'evt-click',
        timestamp: 2,
      },
    ]);

    expect(result).toEqual({
      recorded: 0,
      skipped: 2,
      duplicates: 0,
      categories: {},
    });
    expect(await repo.isSuppressed(emailHash(address))).toBe(false);
  });

  it('skips an event missing an email or sg_event_id', async () => {
    const repo = new InMemorySuppressionEventsRepository();
    const useCase = new ProcessSendgridEventsUseCase(repo);

    const result = await useCase.execute([
      { event: 'bounce', sg_event_id: 'evt-no-email', timestamp: 1 },
      { email: address, event: 'bounce', timestamp: 2 },
    ]);

    expect(result).toEqual({
      recorded: 0,
      skipped: 2,
      duplicates: 0,
      categories: {},
    });
  });

  it('counts a duplicate SendGrid event id without double-recording', async () => {
    const repo = new InMemorySuppressionEventsRepository();
    const useCase = new ProcessSendgridEventsUseCase(repo);

    await useCase.execute([
      { email: address, event: 'bounce', sg_event_id: 'evt-1', timestamp: 1 },
    ]);
    const result = await useCase.execute([
      { email: address, event: 'bounce', sg_event_id: 'evt-1', timestamp: 1 },
    ]);

    expect(result).toEqual({
      recorded: 0,
      skipped: 0,
      duplicates: 1,
      categories: {},
    });
  });

  it('attributes a recorded event to its category (array form)', async () => {
    const repo = new InMemorySuppressionEventsRepository();
    const useCase = new ProcessSendgridEventsUseCase(repo);

    const result = await useCase.execute([
      {
        email: address,
        event: 'delivered',
        sg_event_id: 'evt-cat-array',
        timestamp: 1,
        category: ['magic-link'],
      },
    ]);

    expect(result.categories).toEqual({ 'magic-link': { delivered: 1 } });
  });

  it('attributes a recorded event to its category (string form)', async () => {
    const repo = new InMemorySuppressionEventsRepository();
    const useCase = new ProcessSendgridEventsUseCase(repo);

    const result = await useCase.execute([
      {
        email: address,
        event: 'delivered',
        sg_event_id: 'evt-cat-string',
        timestamp: 1,
        category: 'password-reset',
      },
    ]);

    expect(result.categories).toEqual({ 'password-reset': { delivered: 1 } });
  });

  it('buckets a recorded event with no category as uncategorized', async () => {
    const repo = new InMemorySuppressionEventsRepository();
    const useCase = new ProcessSendgridEventsUseCase(repo);

    const result = await useCase.execute([
      {
        email: address,
        event: 'delivered',
        sg_event_id: 'evt-no-cat',
        timestamp: 1,
      },
      {
        email: 'other@example.com',
        event: 'delivered',
        sg_event_id: 'evt-empty-cat',
        timestamp: 2,
        category: [],
      },
    ]);

    expect(result.categories).toEqual({ uncategorized: { delivered: 2 } });
  });

  it('aggregates per-category and per-event-type counts for the log summary', async () => {
    const repo = new InMemorySuppressionEventsRepository();
    const useCase = new ProcessSendgridEventsUseCase(repo);

    const result = await useCase.execute([
      {
        email: 'a@x.com',
        event: 'delivered',
        sg_event_id: 'e1',
        timestamp: 1,
        category: 'magic-link',
      },
      {
        email: 'b@x.com',
        event: 'bounce',
        sg_event_id: 'e2',
        timestamp: 2,
        category: ['magic-link'],
      },
      {
        email: 'c@x.com',
        event: 'delivered',
        sg_event_id: 'e3',
        timestamp: 3,
        category: 'password-reset',
      },
    ]);

    expect(result.categories).toEqual({
      'magic-link': { delivered: 1, bounce: 1 },
      'password-reset': { delivered: 1 },
    });
    const categoryTotal = Object.values(result.categories)
      .flatMap((byEventType) => Object.values(byEventType))
      .reduce((sum, count) => sum + count, 0);
    expect(categoryTotal).toBe(result.recorded);
  });

  it('throws with the partial result when recording fails mid-batch', async () => {
    const failure = new Error('database unavailable');
    const repo: ISuppressionEventsRepository = {
      record: jest
        .fn<Promise<void>, [RecordSuppressionEvent]>()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(failure),
      isSuppressed: jest
        .fn<Promise<boolean>, [string]>()
        .mockResolvedValue(false),
    };
    const useCase = new ProcessSendgridEventsUseCase(repo);

    const events = [
      {
        email: 'a@x.com',
        event: 'delivered',
        sg_event_id: 'e1',
        timestamp: 1,
        category: 'magic-link-login',
      },
      {
        email: 'b@x.com',
        event: 'bounce',
        sg_event_id: 'e2',
        timestamp: 2,
        category: 'magic-link-login',
      },
    ];

    const caught = await useCase.execute(events).catch((err) => err);

    expect(caught).toBeInstanceOf(SendgridEventProcessingError);
    const error = caught as SendgridEventProcessingError;
    expect(error.cause).toBe(failure);
    expect(error.partial).toEqual({
      recorded: 1,
      skipped: 0,
      duplicates: 0,
      categories: { 'magic-link-login': { delivered: 1 } },
    });
    expect(repo.record).toHaveBeenCalledTimes(2);
  });
});
