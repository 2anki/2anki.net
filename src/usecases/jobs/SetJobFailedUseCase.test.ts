import JobRepository from '../../data_layer/JobRepository';
import { SetJobFailedUseCase } from './SetJobFailedUseCase';

const makeRepo = (job: { status: string } | undefined) =>
  ({
    findJobById: jest.fn().mockResolvedValue(job),
    updateJobStatus: jest.fn().mockResolvedValue(undefined),
  }) as unknown as JobRepository;

describe('SetJobFailedUseCase', () => {
  it('marks an existing job failed with the reason', async () => {
    const repo = makeRepo({ status: 'started' });
    await new SetJobFailedUseCase(repo).execute('job-1', '42', 'boom');
    expect(repo.updateJobStatus).toHaveBeenCalledWith(
      'job-1',
      '42',
      'failed',
      'boom'
    );
  });

  it('is a no-op when the job is already failed', async () => {
    const repo = makeRepo({ status: 'failed' });
    await new SetJobFailedUseCase(repo).execute('job-1', '42', 'boom');
    expect(repo.updateJobStatus).not.toHaveBeenCalled();
  });

  it('returns without throwing when the job no longer exists (deleted mid-conversion)', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const repo = makeRepo(undefined);
      await expect(
        new SetJobFailedUseCase(repo).execute('job-1', '42', 'boom')
      ).resolves.toBeUndefined();
      expect(repo.updateJobStatus).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[SetJobFailed] job missing, skipping failure mark',
        { id: 'job-1' }
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
