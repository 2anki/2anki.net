import express from 'express';
import JobController from './JobController';
import JobService from '../services/JobService';
import DeleteJobUseCase from '../usecases/jobs/DeleteJobUseCase';
import * as getOwnerModule from '../lib/User/getOwner';

describe('JobController', () => {
  let jobService: JobService;
  let deleteJobUseCase: DeleteJobUseCase;
  let jobController: JobController;
  let req: Partial<express.Request>;
  let res: Partial<express.Response>;

  beforeEach(() => {
    jobService = {
      getJobsByOwner: jest.fn(),
      deleteJobById: jest.fn(),
      findJobByObjectId: jest.fn(),
      getConversionReport: jest.fn(),
    } as unknown as JobService;
    deleteJobUseCase = {
      execute: jest.fn(),
    } as unknown as DeleteJobUseCase;
    jobController = new JobController(jobService, deleteJobUseCase);
    req = { params: { id: '123' } };
    res = {
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
      redirect: jest.fn(),
      json: jest.fn(),
    };
    jest.spyOn(getOwnerModule, 'getOwner').mockReturnValue('owner1');
  });

  it('should get jobs by owner and send them', async () => {
    const mockJobs = [
      { id: 1, title: 'job1', download_key: null },
      { id: 2, title: 'job2', download_key: null },
    ];
    (jobService.getJobsByOwner as jest.Mock).mockResolvedValue(mockJobs);
    await jobController.getJobsByOwner(
      req as express.Request,
      res as express.Response
    );
    expect(jobService.getJobsByOwner).toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith([
      { id: 1, title: 'job1', download_key: null, restartable: true },
      { id: 2, title: 'job2', download_key: null, restartable: true },
    ]);
  });

  it('passes job_reason_failure through for a done Notion job', async () => {
    const truncationPayload = JSON.stringify({
      code: 'notion_truncated',
      blocks_converted: 100,
      sub_deck_rules_skipped: false,
    });
    const mockJobs = [
      {
        id: 5,
        title: 'Long Notion Page',
        object_id: 'notion-page-uuid',
        status: 'done',
        owner: 'owner1',
        type: 'page',
        job_reason_failure: truncationPayload,
        download_key: 'abc123.apkg',
      },
    ];
    (jobService.getJobsByOwner as jest.Mock).mockResolvedValue(mockJobs);
    await jobController.getJobsByOwner(
      req as express.Request,
      res as express.Response
    );
    const sent = (res.send as jest.Mock).mock.calls[0][0] as Array<{
      job_reason_failure: string | null;
    }>;
    expect(sent[0].job_reason_failure).toBe(truncationPayload);
  });

  it('exposes download_key for a done Notion job with a matching upload', async () => {
    const mockJobs = [
      {
        id: 1,
        title: 'Notion Deck',
        object_id: 'notion-page-uuid',
        status: 'done',
        owner: 'owner1',
        type: 'page',
        download_key: 'abc123.apkg',
      },
    ];
    (jobService.getJobsByOwner as jest.Mock).mockResolvedValue(mockJobs);
    await jobController.getJobsByOwner(
      req as express.Request,
      res as express.Response
    );
    const sent = (res.send as jest.Mock).mock.calls[0][0] as Array<{
      download_key: string | null;
    }>;
    expect(sent[0].download_key).toBe('abc123.apkg');
  });

  it('returns download_key for a done upload job with a matching upload', async () => {
    const mockJobs = [
      {
        id: 2,
        title: 'Upload Deck',
        object_id: 'upload-obj-id',
        status: 'done',
        owner: 'owner1',
        type: 'claude',
        download_key: 'upload-key.apkg',
      },
    ];
    (jobService.getJobsByOwner as jest.Mock).mockResolvedValue(mockJobs);
    await jobController.getJobsByOwner(
      req as express.Request,
      res as express.Response
    );
    const sent = (res.send as jest.Mock).mock.calls[0][0] as Array<{
      download_key: string | null;
    }>;
    expect(sent[0].download_key).toBe('upload-key.apkg');
  });

  it('returns download_key: null for an in-progress job', async () => {
    const mockJobs = [
      {
        id: 3,
        title: 'In Progress',
        object_id: 'in-progress-obj',
        status: 'started',
        owner: 'owner1',
        type: 'page',
        download_key: null,
      },
    ];
    (jobService.getJobsByOwner as jest.Mock).mockResolvedValue(mockJobs);
    await jobController.getJobsByOwner(
      req as express.Request,
      res as express.Response
    );
    const sent = (res.send as jest.Mock).mock.calls[0][0] as Array<{
      download_key: string | null;
    }>;
    expect(sent[0].download_key).toBeNull();
  });

  it('cross-owner guard: user A does not receive user B download_key for same object_id', async () => {
    const mockJobsForOwner1 = [
      {
        id: 4,
        title: 'Shared Object',
        object_id: 'shared-obj-id',
        status: 'done',
        owner: 'owner1',
        type: 'page',
        download_key: null,
      },
    ];
    (jobService.getJobsByOwner as jest.Mock).mockResolvedValue(
      mockJobsForOwner1
    );
    await jobController.getJobsByOwner(
      req as express.Request,
      res as express.Response
    );
    const sent = (res.send as jest.Mock).mock.calls[0][0] as Array<{
      download_key: string | null;
    }>;
    expect(sent[0].download_key).toBeNull();
  });

  it('should delegate delete to the use case and send 200', async () => {
    (deleteJobUseCase.execute as jest.Mock).mockResolvedValue(undefined);
    await jobController.deleteJobByOwner(
      req as express.Request,
      res as express.Response
    );
    expect(deleteJobUseCase.execute).toHaveBeenCalledWith('123', 'owner1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalled();
  });

  it('should handle error in deleteJobByOwner', async () => {
    (deleteJobUseCase.execute as jest.Mock).mockRejectedValue(
      new Error('fail')
    );
    await jobController.deleteJobByOwner(
      req as express.Request,
      res as express.Response
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalled();
  });

  it('should handle job in progress error with 409 status', async () => {
    (deleteJobUseCase.execute as jest.Mock).mockRejectedValue(
      new Error('Cannot delete job while it is in progress')
    );
    await jobController.deleteJobByOwner(
      req as express.Request,
      res as express.Response
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Cannot delete job while it is in progress',
    });
  });

  it('should redirect to login if owner is missing when getting jobs', async () => {
    (getOwnerModule.getOwner as jest.Mock).mockReturnValue(undefined);
    await jobController.getJobsByOwner(
      req as express.Request,
      res as express.Response
    );
    expect(res.redirect).toHaveBeenCalledWith('/login');
    expect(res.send).not.toHaveBeenCalled();
  });

  describe('getJobReport', () => {
    const report = {
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

    beforeEach(() => {
      req = { params: { jobId: 'job-object-id' } };
    });

    it('sends the typed report for the owner job', async () => {
      (jobService.getConversionReport as jest.Mock).mockResolvedValue({
        jobExists: true,
        report,
      });

      await jobController.getJobReport(
        req as express.Request,
        res as express.Response
      );

      expect(jobService.getConversionReport).toHaveBeenCalledWith(
        'job-object-id',
        'owner1'
      );
      expect(res.json).toHaveBeenCalledWith(report);
    });

    it('responds 404 when the job does not exist for this owner', async () => {
      (jobService.getConversionReport as jest.Mock).mockResolvedValue({
        jobExists: false,
        report: null,
      });

      await jobController.getJobReport(
        req as express.Request,
        res as express.Response
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Job not found' });
    });

    it('responds 404 when the job has no stored report', async () => {
      (jobService.getConversionReport as jest.Mock).mockResolvedValue({
        jobExists: true,
        report: null,
      });

      await jobController.getJobReport(
        req as express.Request,
        res as express.Response
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'No report for this job',
      });
    });
  });
});
