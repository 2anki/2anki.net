import JobRepository from '../../data_layer/JobRepository';
import Jobs from '../../data_layer/public/Jobs';
import UsersRepository from '../../data_layer/UsersRepository';
import type { ConversionReport } from '../../services/NotionService/helpers/buildConversionReport';
import {
  buildMonthlyLimitPartialPayload,
  buildNotionConversionSignalPayload,
  ConversionTruncation,
  GuessedColumnMapping,
  MonthlyLimitPartial,
  ResolvedDatabasePath,
} from '../../services/NotionService/helpers/conversionTruncation';

export class CompleteJobUseCase {
  constructor(
    private readonly jobRepository: JobRepository,
    private readonly usersRepository?: UsersRepository
  ) {}

  async execute(
    jobId: string,
    owner: string,
    cardCount = 0,
    truncation?: ConversionTruncation,
    droppedAssetCount = 0,
    guessedColumns?: GuessedColumnMapping,
    monthlyLimitPartial?: MonthlyLimitPartial,
    resolvedDatabasePath?: ResolvedDatabasePath,
    unsupportedBlocks?: Record<string, number>,
    structureRescuedRule?: string,
    forbiddenBlockCount = 0,
    conversionReport?: ConversionReport
  ): Promise<Jobs | undefined> {
    const job = await this.jobRepository.findJobById(jobId, owner);

    if (!job) {
      throw new Error('Job not found');
    }

    if (job.status === 'cancelled') {
      return job;
    }

    const signalPayload =
      monthlyLimitPartial != null
        ? buildMonthlyLimitPartialPayload(monthlyLimitPartial)
        : buildNotionConversionSignalPayload(
            truncation,
            droppedAssetCount,
            guessedColumns,
            resolvedDatabasePath,
            unsupportedBlocks,
            structureRescuedRule,
            forbiddenBlockCount
          );

    const updated = await this.jobRepository.updateJobStatus(
      jobId,
      owner,
      'done',
      signalPayload,
      cardCount,
      conversionReport
    );

    if (this.usersRepository && cardCount > 0) {
      await this.usersRepository.incrementCardUsage(owner, cardCount);
    }

    return updated;
  }
}
