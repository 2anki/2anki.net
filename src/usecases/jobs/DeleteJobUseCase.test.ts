import { vi, type Mocked } from 'vitest';
import DeleteJobUseCase from './DeleteJobUseCase';
import JobService from '../../services/JobService';
import UploadService from '../../services/UploadService';
import { JobWithDownloadKey } from '../../data_layer/JobRepository';

describe('DeleteJobUseCase', () => {
  let jobService: Mocked<JobService>;
  let uploadService: Mocked<UploadService>;
  let useCase: DeleteJobUseCase;

  beforeEach(() => {
    jobService = {
      deleteJobById: vi.fn(),
    } as unknown as Mocked<JobService>;
    uploadService = {
      deleteUpload: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<UploadService>;
    useCase = new DeleteJobUseCase(jobService, uploadService);
  });

  it('deletes the job and its linked upload when download_key is present', async () => {
    const job = {
      id: 99,
      owner: '1',
      download_key: 'abc.apkg',
    } as unknown as JobWithDownloadKey;
    jobService.deleteJobById.mockResolvedValue(job);

    await useCase.execute('99', '1');

    expect(jobService.deleteJobById).toHaveBeenCalledWith('99', '1');
    expect(uploadService.deleteUpload).toHaveBeenCalledWith(1, 'abc.apkg');
  });

  it('skips upload deletion when the job has no download_key', async () => {
    const job = {
      id: 99,
      owner: '1',
      download_key: null,
    } as unknown as JobWithDownloadKey;
    jobService.deleteJobById.mockResolvedValue(job);

    await useCase.execute('99', '1');

    expect(jobService.deleteJobById).toHaveBeenCalledWith('99', '1');
    expect(uploadService.deleteUpload).not.toHaveBeenCalled();
  });

  it('does nothing extra when the job does not exist', async () => {
    jobService.deleteJobById.mockResolvedValue(null);

    await useCase.execute('99', '1');

    expect(uploadService.deleteUpload).not.toHaveBeenCalled();
  });

  it('propagates the in-progress error and does not touch uploads', async () => {
    jobService.deleteJobById.mockRejectedValue(
      new Error('Cannot delete job while it is in progress')
    );

    await expect(useCase.execute('99', '1')).rejects.toThrow(
      'Cannot delete job while it is in progress'
    );
    expect(uploadService.deleteUpload).not.toHaveBeenCalled();
  });
});
