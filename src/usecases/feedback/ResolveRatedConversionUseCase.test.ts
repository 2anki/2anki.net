import { vi } from 'vitest';

import {
  ResolveRatedConversionUseCase,
  type IJobOwnershipChecker,
  type IUploadOwnershipChecker,
} from './ResolveRatedConversionUseCase';

function build() {
  const jobs: IJobOwnershipChecker = {
    existsByIdAndOwner: vi.fn().mockResolvedValue(false),
  };
  const uploads: IUploadOwnershipChecker = {
    findByIdAndOwner: vi.fn().mockResolvedValue(null),
  };
  const useCase = new ResolveRatedConversionUseCase(jobs, uploads);
  return { jobs, uploads, useCase };
}

describe('ResolveRatedConversionUseCase', () => {
  it('drops both ids when there is no authenticated owner', async () => {
    const { useCase, jobs, uploads } = build();
    const result = await useCase.resolve({
      owner: null,
      jobId: 10,
      uploadId: 20,
    });
    expect(result).toEqual({ jobId: null, uploadId: null });
    expect(jobs.existsByIdAndOwner).not.toHaveBeenCalled();
    expect(uploads.findByIdAndOwner).not.toHaveBeenCalled();
  });

  it('keeps a job id owned by the session user', async () => {
    const { useCase, jobs } = build();
    (jobs.existsByIdAndOwner as ReturnType<typeof vi.fn>).mockResolvedValue(
      true
    );
    const result = await useCase.resolve({
      owner: 42,
      jobId: 10,
      uploadId: null,
    });
    expect(jobs.existsByIdAndOwner).toHaveBeenCalledWith(10, '42');
    expect(result).toEqual({ jobId: 10, uploadId: null });
  });

  it('drops a job id that belongs to another user', async () => {
    const { useCase } = build();
    const result = await useCase.resolve({
      owner: 42,
      jobId: 99,
      uploadId: null,
    });
    expect(result).toEqual({ jobId: null, uploadId: null });
  });

  it('keeps an upload id owned by the session user', async () => {
    const { useCase, uploads } = build();
    (uploads.findByIdAndOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 20,
    });
    const result = await useCase.resolve({
      owner: 42,
      jobId: null,
      uploadId: 20,
    });
    expect(uploads.findByIdAndOwner).toHaveBeenCalledWith(20, 42);
    expect(result).toEqual({ jobId: null, uploadId: 20 });
  });

  it('drops an upload id that belongs to another user', async () => {
    const { useCase } = build();
    const result = await useCase.resolve({
      owner: 42,
      jobId: null,
      uploadId: 20,
    });
    expect(result).toEqual({ jobId: null, uploadId: null });
  });

  it('leaves null ids untouched without querying', async () => {
    const { useCase, jobs, uploads } = build();
    const result = await useCase.resolve({
      owner: 42,
      jobId: null,
      uploadId: null,
    });
    expect(result).toEqual({ jobId: null, uploadId: null });
    expect(jobs.existsByIdAndOwner).not.toHaveBeenCalled();
    expect(uploads.findByIdAndOwner).not.toHaveBeenCalled();
  });
});
