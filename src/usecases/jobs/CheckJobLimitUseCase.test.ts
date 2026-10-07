import { vi } from 'vitest';
import { CheckJobLimitUseCase } from './CheckJobLimitUseCase';
import JobRepository from '../../data_layer/JobRepository';

describe('CheckJobLimitUseCase', () => {
  it('counts only active jobs toward the limit', async () => {
    const jobRepository = {
      getJobsByOwner: vi
        .fn()
        .mockResolvedValue([
          { status: 'started' },
          { status: 'done' },
          { status: 'failed' },
        ]),
    } as unknown as JobRepository;

    const useCase = new CheckJobLimitUseCase(jobRepository);
    const result = await useCase.execute({ owner: 'user-a', maxJobs: 1 });

    expect(result).toBe(true);
  });

  it('blocks when active jobs exceed the limit', async () => {
    const jobRepository = {
      getJobsByOwner: vi
        .fn()
        .mockResolvedValue([{ status: 'started' }, { status: 'step1' }]),
    } as unknown as JobRepository;

    const useCase = new CheckJobLimitUseCase(jobRepository);
    const result = await useCase.execute({ owner: 'user-a', maxJobs: 1 });

    expect(result).toBe(false);
  });

  it('ignores all terminal statuses', async () => {
    const jobRepository = {
      getJobsByOwner: vi
        .fn()
        .mockResolvedValue([
          { status: 'done' },
          { status: 'failed' },
          { status: 'cancelled' },
          { status: 'interrupted' },
        ]),
    } as unknown as JobRepository;

    const useCase = new CheckJobLimitUseCase(jobRepository);
    const result = await useCase.execute({ owner: 'user-a', maxJobs: 1 });

    expect(result).toBe(true);
  });
});
