import JobRepository from '../../data_layer/JobRepository';

export class SetJobFailedUseCase {
  constructor(private readonly jobRepository: JobRepository) {}

  async execute(id: string, owner: string, reason: string): Promise<void> {
    const job = await this.jobRepository.findJobById(id, owner);

    if (!job) {
      console.warn('[SetJobFailed] job missing, skipping failure mark', { id });
      return;
    }

    if (job.status === 'failed') {
      return;
    }

    await this.jobRepository.updateJobStatus(id, owner, 'failed', reason);
  }
}
