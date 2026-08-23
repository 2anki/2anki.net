import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

import JobService from '../services/JobService';
import { JobWithDownloadKey } from '../data_layer/JobRepository';
import { getOwner } from '../lib/User/getOwner';
import DeleteJobUseCase from '../usecases/jobs/DeleteJobUseCase';

// conversion_report stays out of the polled jobs list on purpose — the
// report is fetched lazily per job when the user opens it (#4211).
interface JobListItem extends Omit<JobWithDownloadKey, 'conversion_report'> {
  restartable: boolean;
}

function toJobListItem(job: JobWithDownloadKey): JobListItem {
  return {
    id: job.id,
    owner: job.owner,
    object_id: job.object_id,
    status: job.status,
    created_at: job.created_at,
    last_edited_time: job.last_edited_time,
    title: job.title,
    type: job.type,
    job_reason_failure: job.job_reason_failure,
    card_count: job.card_count,
    download_key: job.download_key,
    upload_id: job.upload_id,
    restartable: true,
  };
}

class JobController {
  constructor(
    private readonly service: JobService,
    private readonly deleteJobUseCase: DeleteJobUseCase
  ) {}

  async getJobsByOwner(_req: express.Request, res: express.Response) {
    const owner = getOwner(res);
    if (!owner) {
      res.redirect('/login');
      return;
    }
    const jobs = await this.service.getJobsByOwner(owner);
    res.send(jobs.map(toJobListItem));
  }

  async downloadJobResult(req: express.Request, res: express.Response) {
    const owner = getOwner(res);
    const jobId = req.params.jobId;
    const job = await this.service.findJobByObjectId(jobId, owner);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    if (job.status !== 'done') {
      res.status(409).json({ error: 'Job not done yet', status: job.status });
      return;
    }
    const workspaceBase = process.env.WORKSPACE_BASE!;
    const dir = path.join(workspaceBase, job.object_id);
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    const apkgFile = files.find((f) => f.endsWith('.apkg'));
    if (!apkgFile) {
      res.status(404).json({ error: 'APKG file not found' });
      return;
    }
    const filePath = path.join(dir, apkgFile);
    res.set('Content-Type', 'application/apkg');
    res.download(filePath, apkgFile);
  }

  async deleteJobByOwner(req: express.Request, res: express.Response) {
    try {
      const id = req.params.id;
      await this.deleteJobUseCase.execute(id, getOwner(res));

      res.status(200).send();
    } catch (error) {
      // Check if it's a job in progress error
      if (
        error instanceof Error &&
        error.message === 'Cannot delete job while it is in progress'
      ) {
        res
          .status(409)
          .json({ error: 'Cannot delete job while it is in progress' });
        return;
      }

      res.status(500).send();
      console.info('Delete job failed');
      console.error(error);
    }
  }
}

export default JobController;
