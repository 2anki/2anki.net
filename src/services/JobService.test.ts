import JobService from './JobService';
import JobRepository, { JobWithDownloadKey } from '../data_layer/JobRepository';

function makeJob(
  overrides: Partial<JobWithDownloadKey> = {}
): JobWithDownloadKey {
  return {
    id: 42,
    owner: '1',
    object_id: 'obj',
    status: 'done',
    created_at: new Date(),
    last_edited_time: new Date(),
    title: 'Deck',
    type: 'page',
    job_reason_failure: '',
    card_count: 1,
    download_key: null,
    upload_id: null,
    ...overrides,
  } as unknown as JobWithDownloadKey;
}

describe('JobService.deleteJobById', () => {
  let repository: jest.Mocked<JobRepository>;
  let service: JobService;

  beforeEach(() => {
    repository = {
      getJobsByOwner: jest.fn(),
      deleteJob: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<JobRepository>;
    service = new JobService(repository);
  });

  it('returns the job (with download_key) after deleting it', async () => {
    const job = makeJob({ download_key: 'k.apkg' });
    repository.getJobsByOwner.mockResolvedValue([job]);

    const result = await service.deleteJobById('42', '1');

    expect(repository.deleteJob).toHaveBeenCalledWith('42', '1');
    expect(result).toBe(job);
  });

  it('returns null when no matching job is found', async () => {
    repository.getJobsByOwner.mockResolvedValue([]);

    const result = await service.deleteJobById('42', '1');

    expect(repository.deleteJob).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('throws when the job is still in progress', async () => {
    repository.getJobsByOwner.mockResolvedValue([
      makeJob({ status: 'started' }),
    ]);

    await expect(service.deleteJobById('42', '1')).rejects.toThrow(
      'Cannot delete job while it is in progress'
    );
    expect(repository.deleteJob).not.toHaveBeenCalled();
  });

  it('throws when the job is in a step status', async () => {
    repository.getJobsByOwner.mockResolvedValue([
      makeJob({ status: 'step2_extracting' }),
    ]);

    await expect(service.deleteJobById('42', '1')).rejects.toThrow(
      'Cannot delete job while it is in progress'
    );
    expect(repository.deleteJob).not.toHaveBeenCalled();
  });
});

describe('JobService.getConversionReport', () => {
  const storedReport = {
    summary: { blocks_seen: 52, cards_created: 34, blocks_skipped: 3 },
    entries: [
      {
        stage: 'card',
        reason_code: 'empty_back',
        human_reason: 'Cards whose back came out empty',
        count: 3,
      },
    ],
  };
  let repository: jest.Mocked<JobRepository>;
  let service: JobService;

  beforeEach(() => {
    repository = {
      findConversionReportRow: jest.fn(),
    } as unknown as jest.Mocked<JobRepository>;
    service = new JobService(repository);
  });

  it('reports a missing job', async () => {
    repository.findConversionReportRow.mockResolvedValue(undefined);

    const result = await service.getConversionReport('missing', '1');

    expect(result).toEqual({ jobExists: false, report: null });
    expect(repository.findConversionReportRow).toHaveBeenCalledWith(
      'missing',
      '1'
    );
  });

  it('maps the stored report to the typed shape', async () => {
    repository.findConversionReportRow.mockResolvedValue({
      conversion_report: storedReport,
    });

    const result = await service.getConversionReport('job-1', '1');

    expect(result).toEqual({ jobExists: true, report: storedReport });
  });

  it('returns a null report when the job has none stored', async () => {
    repository.findConversionReportRow.mockResolvedValue({
      conversion_report: null,
    });

    const result = await service.getConversionReport('job-1', '1');

    expect(result).toEqual({ jobExists: true, report: null });
  });

  it('returns a null report when the stored value is malformed', async () => {
    repository.findConversionReportRow.mockResolvedValue({
      conversion_report: '{not json',
    });

    const result = await service.getConversionReport('job-1', '1');

    expect(result).toEqual({ jobExists: true, report: null });
  });
});
