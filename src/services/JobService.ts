import JobRepository, { JobWithDownloadKey } from '../data_layer/JobRepository';
import type { ConversionReport } from './NotionService/helpers/buildConversionReport';
import { toConversionReport } from './NotionService/helpers/toConversionReport';

export interface ConversionReportLookup {
  jobExists: boolean;
  report: ConversionReport | null;
}

class JobService {
  constructor(private readonly repository: JobRepository) {}

  getJobsByOwner(owner: string): Promise<JobWithDownloadKey[]> {
    return this.repository.getJobsByOwner(owner);
  }

  async deleteJobById(
    id: string,
    owner: string
  ): Promise<JobWithDownloadKey | null> {
    const jobs = await this.repository.getJobsByOwner(owner);
    const job = jobs.find((j) => j.id.toString() === id);

    if (!job) {
      return null;
    }

    if (job.status === 'started' || job.status.startsWith('step')) {
      throw new Error('Cannot delete job while it is in progress');
    }

    await this.repository.deleteJob(id, owner);
    return job;
  }

  findJobByObjectId(objectId: string, owner: string) {
    return this.repository.findJobById(objectId, owner);
  }

  async getConversionReport(
    objectId: string,
    owner: string
  ): Promise<ConversionReportLookup> {
    const row = await this.repository.findConversionReportRow(objectId, owner);
    if (!row) {
      return { jobExists: false, report: null };
    }
    return {
      jobExists: true,
      report: toConversionReport(row.conversion_report),
    };
  }

  async getAllStartedJobs(owner: string) {
    const jobs = await this.repository.getJobsByOwner(owner);
    return jobs.filter((job) => job.status === 'started');
  }
}

export default JobService;
