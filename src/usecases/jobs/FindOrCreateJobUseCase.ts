import JobRepository from '../../data_layer/JobRepository';
import Jobs from '../../data_layer/public/Jobs';

interface FindOrCreateJobUseCaseInput {
  id: string;
  owner: string;
  title: string;
  type: string;
}

export interface FindOrCreateJobResult {
  job: Jobs;
  created: boolean;
}

export class FindOrCreateJobUseCase {
  constructor(private readonly jobRepository: JobRepository) {}

  async execute(
    input: FindOrCreateJobUseCaseInput
  ): Promise<FindOrCreateJobResult> {
    const { id, owner, title, type } = input;

    const existingJob = await this.jobRepository.findJobById(id, owner);
    if (existingJob) {
      return { job: existingJob, created: false };
    }

    const inserted = await this.jobRepository.create(id, owner, title, type);
    if (inserted) {
      return { job: inserted, created: true };
    }

    const raced = await this.jobRepository.findJobById(id, owner);
    if (!raced) {
      throw new Error('Failed to find or create job after creation attempt');
    }
    return { job: raced, created: false };
  }
}
