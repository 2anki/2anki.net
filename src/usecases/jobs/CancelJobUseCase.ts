import JobRepository from '../../data_layer/JobRepository';
import Jobs from '../../data_layer/public/Jobs';

interface CancelJobUseCaseInput {
  id: string;
  owner: string;
  reason: string;
}

export class CancelJobUseCase {
  constructor(private readonly jobRepository: JobRepository) {}

  async execute(input: CancelJobUseCaseInput): Promise<Jobs | undefined> {
    const { id, owner, reason } = input;
    const job = await this.jobRepository.findJobById(id, owner);

    if (!job) {
      throw new Error('Job not found');
    }

    if (job.status === 'cancelled') {
      return job;
    }

    return this.jobRepository.updateJobStatus(id, owner, 'cancelled', reason);
  }
}
