import JobRepository from '../../data_layer/JobRepository';
import {
  ClaimJobForRestartUseCase,
  NOTION_JOB_STALE_MS,
} from './ClaimJobForRestartUseCase';

function makeRepo(claimResult: unknown) {
  return {
    claimStaleOrTerminalJob: jest.fn().mockResolvedValue(claimResult),
  } as unknown as JobRepository;
}

describe('ClaimJobForRestartUseCase', () => {
  it('returns true when the repository claims the job', async () => {
    const repo = makeRepo({ id: 1, status: 'started' });
    const useCase = new ClaimJobForRestartUseCase(repo);

    const claimed = await useCase.execute({ id: 'page-a', owner: 'u1' });

    expect(claimed).toBe(true);
  });

  it('returns false when the repository declines the claim (already in flight)', async () => {
    const repo = makeRepo(undefined);
    const useCase = new ClaimJobForRestartUseCase(repo);

    const claimed = await useCase.execute({ id: 'page-a', owner: 'u1' });

    expect(claimed).toBe(false);
  });

  it('passes the default staleness window to the repository', async () => {
    const repo = makeRepo({ id: 1, status: 'started' });
    const useCase = new ClaimJobForRestartUseCase(repo);

    await useCase.execute({ id: 'page-a', owner: 'u1' });

    expect(repo.claimStaleOrTerminalJob).toHaveBeenCalledWith(
      'page-a',
      'u1',
      NOTION_JOB_STALE_MS
    );
  });
});
