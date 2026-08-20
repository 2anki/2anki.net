import JobRepository from '../../data_layer/JobRepository';

export const NOTION_JOB_STALE_MS = 15 * 60 * 1000;

interface ClaimJobForRestartUseCaseInput {
  id: string;
  owner: string;
}

export class ClaimJobForRestartUseCase {
  constructor(
    private readonly jobRepository: JobRepository,
    private readonly stalenessMs: number = NOTION_JOB_STALE_MS
  ) {}

  async execute(input: ClaimJobForRestartUseCaseInput): Promise<boolean> {
    const claimed = await this.jobRepository.claimStaleOrTerminalJob(
      input.id,
      input.owner,
      this.stalenessMs
    );
    return claimed != null;
  }
}
