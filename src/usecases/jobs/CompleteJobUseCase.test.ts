import { CompleteJobUseCase } from './CompleteJobUseCase';
import JobRepository from '../../data_layer/JobRepository';
import UsersRepository from '../../data_layer/UsersRepository';

describe('CompleteJobUseCase', () => {
  it('marks the job as done instead of deleting it', async () => {
    const updatedJob = {
      id: 1,
      object_id: 'page-1',
      owner: 'user-a',
      status: 'done',
    };

    const jobRepository = {
      findJobById: jest.fn().mockResolvedValue({
        id: 1,
        object_id: 'page-1',
        owner: 'user-a',
        status: 'started',
      }),
      updateJobStatus: jest.fn().mockResolvedValue(updatedJob),
      deleteJob: jest.fn(),
    } as unknown as JobRepository;

    const useCase = new CompleteJobUseCase(jobRepository);
    const result = await useCase.execute('page-1', 'user-a');

    expect(jobRepository.updateJobStatus).toHaveBeenCalledWith(
      'page-1',
      'user-a',
      'done',
      undefined,
      0,
      undefined
    );
    expect(jobRepository.deleteJob).not.toHaveBeenCalled();
    expect(result).toEqual(updatedJob);
  });

  it('passes the conversion report through to the done write', async () => {
    const jobRepository = {
      findJobById: jest.fn().mockResolvedValue({
        id: 1,
        object_id: 'page-1',
        owner: 'user-a',
        status: 'started',
      }),
      updateJobStatus: jest.fn().mockResolvedValue({ status: 'done' }),
      deleteJob: jest.fn(),
    } as unknown as JobRepository;
    const report = {
      summary: { blocks_seen: 52, cards_created: 34, blocks_skipped: 3 },
      entries: [],
    };

    const useCase = new CompleteJobUseCase(jobRepository);
    await useCase.execute(
      'page-1',
      'user-a',
      34,
      undefined,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      0,
      report
    );

    const reportArg = (jobRepository.updateJobStatus as jest.Mock).mock
      .calls[0][5];
    expect(reportArg).toEqual(report);
  });

  it('persists a dropped-assets signal payload when images were dropped', async () => {
    const jobRepository = {
      findJobById: jest.fn().mockResolvedValue({
        id: 1,
        object_id: 'page-1',
        owner: 'user-a',
        status: 'started',
      }),
      updateJobStatus: jest.fn().mockResolvedValue({ status: 'done' }),
      deleteJob: jest.fn(),
    } as unknown as JobRepository;

    const useCase = new CompleteJobUseCase(jobRepository);
    await useCase.execute('page-1', 'user-a', 12, undefined, 3);

    const payload = (jobRepository.updateJobStatus as jest.Mock).mock
      .calls[0][3];
    expect(JSON.parse(payload)).toEqual({
      code: 'notion_assets_dropped',
      dropped_assets: 3,
    });
  });

  it('persists a guessed-columns signal payload when the mapping was inferred', async () => {
    const jobRepository = {
      findJobById: jest.fn().mockResolvedValue({
        id: 1,
        object_id: 'page-1',
        owner: 'user-a',
        status: 'started',
      }),
      updateJobStatus: jest.fn().mockResolvedValue({ status: 'done' }),
      deleteJob: jest.fn(),
    } as unknown as JobRepository;

    const useCase = new CompleteJobUseCase(jobRepository);
    await useCase.execute('page-1', 'user-a', 12, undefined, 0, {
      frontField: 'Notes',
      backField: 'Tags',
    });

    const payload = (jobRepository.updateJobStatus as jest.Mock).mock
      .calls[0][3];
    expect(JSON.parse(payload)).toEqual({
      code: 'notion_columns_guessed',
      front_field: 'Notes',
      back_field: 'Tags',
    });
  });

  it('increments the user card counter when usersRepository is provided', async () => {
    const jobRepository = {
      findJobById: jest.fn().mockResolvedValue({
        id: 1,
        object_id: 'page-1',
        owner: 'user-a',
        status: 'started',
      }),
      updateJobStatus: jest.fn().mockResolvedValue({ status: 'done' }),
    } as unknown as JobRepository;
    const usersRepository = {
      incrementCardUsage: jest.fn().mockResolvedValue(1),
    } as unknown as UsersRepository;

    const useCase = new CompleteJobUseCase(jobRepository, usersRepository);
    await useCase.execute('page-1', 'user-a', 42);

    expect(usersRepository.incrementCardUsage).toHaveBeenCalledWith(
      'user-a',
      42
    );
  });

  it('does not increment when card count is zero', async () => {
    const jobRepository = {
      findJobById: jest.fn().mockResolvedValue({
        id: 1,
        object_id: 'page-1',
        owner: 'user-a',
        status: 'started',
      }),
      updateJobStatus: jest.fn().mockResolvedValue({ status: 'done' }),
    } as unknown as JobRepository;
    const usersRepository = {
      incrementCardUsage: jest.fn(),
    } as unknown as UsersRepository;

    const useCase = new CompleteJobUseCase(jobRepository, usersRepository);
    await useCase.execute('page-1', 'user-a', 0);

    expect(usersRepository.incrementCardUsage).not.toHaveBeenCalled();
  });

  it('does not increment when the job was already cancelled', async () => {
    const cancelled = {
      id: 1,
      object_id: 'page-1',
      owner: 'user-a',
      status: 'cancelled',
    };
    const jobRepository = {
      findJobById: jest.fn().mockResolvedValue(cancelled),
      updateJobStatus: jest.fn(),
    } as unknown as JobRepository;
    const usersRepository = {
      incrementCardUsage: jest.fn(),
    } as unknown as UsersRepository;

    const useCase = new CompleteJobUseCase(jobRepository, usersRepository);
    await useCase.execute('page-1', 'user-a', 50);

    expect(usersRepository.incrementCardUsage).not.toHaveBeenCalled();
  });

  it('returns the job unchanged when already cancelled', async () => {
    const cancelledJob = {
      id: 1,
      object_id: 'page-1',
      owner: 'user-a',
      status: 'cancelled',
    };

    const jobRepository = {
      findJobById: jest.fn().mockResolvedValue(cancelledJob),
      updateJobStatus: jest.fn(),
    } as unknown as JobRepository;

    const useCase = new CompleteJobUseCase(jobRepository);
    const result = await useCase.execute('page-1', 'user-a');

    expect(jobRepository.updateJobStatus).not.toHaveBeenCalled();
    expect(result).toEqual(cancelledJob);
  });

  it('persists a namespaced truncation payload on done', async () => {
    const jobRepository = {
      findJobById: jest.fn().mockResolvedValue({
        id: 1,
        object_id: 'page-1',
        owner: 'user-a',
        status: 'started',
      }),
      updateJobStatus: jest.fn().mockResolvedValue({ status: 'done' }),
    } as unknown as JobRepository;

    const useCase = new CompleteJobUseCase(jobRepository);
    await useCase.execute('page-1', 'user-a', 42, {
      blocksConverted: 100,
      subDeckRulesSkipped: true,
    });

    const description = (jobRepository.updateJobStatus as jest.Mock).mock
      .calls[0][3];
    expect(JSON.parse(description)).toEqual({
      code: 'notion_truncated',
      blocks_converted: 100,
      sub_deck_rules_skipped: true,
    });
  });

  it('leaves the failure reason untouched when there is no truncation', async () => {
    const jobRepository = {
      findJobById: jest.fn().mockResolvedValue({
        id: 1,
        object_id: 'page-1',
        owner: 'user-a',
        status: 'started',
      }),
      updateJobStatus: jest.fn().mockResolvedValue({ status: 'done' }),
    } as unknown as JobRepository;

    const useCase = new CompleteJobUseCase(jobRepository);
    await useCase.execute('page-1', 'user-a', 42);

    expect(jobRepository.updateJobStatus).toHaveBeenCalledWith(
      'page-1',
      'user-a',
      'done',
      undefined,
      42,
      undefined
    );
  });

  it('persists a monthly_limit_partial payload that takes precedence over the notion signal', async () => {
    const jobRepository = {
      findJobById: jest.fn().mockResolvedValue({
        id: 1,
        object_id: 'page-1',
        owner: 'user-a',
        status: 'started',
      }),
      updateJobStatus: jest.fn().mockResolvedValue({ status: 'done' }),
    } as unknown as JobRepository;

    const useCase = new CompleteJobUseCase(jobRepository);
    await useCase.execute(
      'page-1',
      'user-a',
      100,
      { blocksConverted: 40, subDeckRulesSkipped: true },
      0,
      undefined,
      {
        cardsDelivered: 100,
        cardsHeldBack: 25,
        limit: 100,
        resetOn: '2026-08-01T00:00:00.000Z',
      }
    );

    const payload = (jobRepository.updateJobStatus as jest.Mock).mock
      .calls[0][3];
    expect(JSON.parse(payload)).toEqual({
      code: 'monthly_limit_partial',
      cards_delivered: 100,
      cards_held_back: 25,
      limit: 100,
      reset_on: '2026-08-01T00:00:00.000Z',
    });
  });

  it('persists a resolved-database-path signal payload when no other signal fires', async () => {
    const jobRepository = {
      findJobById: jest.fn().mockResolvedValue({
        id: 1,
        object_id: 'page-1',
        owner: 'user-a',
        status: 'started',
      }),
      updateJobStatus: jest.fn().mockResolvedValue({ status: 'done' }),
    } as unknown as JobRepository;

    const useCase = new CompleteJobUseCase(jobRepository);
    await useCase.execute(
      'page-1',
      'user-a',
      12,
      undefined,
      0,
      undefined,
      undefined,
      { viaPageLinkSelfHeal: true }
    );

    const payload = (jobRepository.updateJobStatus as jest.Mock).mock
      .calls[0][3];
    expect(JSON.parse(payload)).toEqual({
      code: 'notion_database_resolved',
      via_page_link_selfheal: true,
    });
  });

  it('persists an unsupported-blocks signal payload when block types were skipped', async () => {
    const jobRepository = {
      findJobById: jest.fn().mockResolvedValue({
        id: 1,
        object_id: 'page-1',
        owner: 'user-a',
        status: 'started',
      }),
      updateJobStatus: jest.fn().mockResolvedValue({ status: 'done' }),
    } as unknown as JobRepository;

    const useCase = new CompleteJobUseCase(jobRepository);
    await useCase.execute(
      'page-1',
      'user-a',
      12,
      undefined,
      0,
      undefined,
      undefined,
      undefined,
      { child_database: 2 }
    );

    const payload = (jobRepository.updateJobStatus as jest.Mock).mock
      .calls[0][3];
    expect(JSON.parse(payload)).toEqual({
      code: 'notion_unsupported_blocks',
      unsupported_blocks: { child_database: 2 },
    });
  });

  it('throws when the job does not exist', async () => {
    const jobRepository = {
      findJobById: jest.fn().mockResolvedValue(null),
    } as unknown as JobRepository;

    const useCase = new CompleteJobUseCase(jobRepository);
    await expect(useCase.execute('missing', 'user-a')).rejects.toThrow(
      'Job not found'
    );
  });
});
