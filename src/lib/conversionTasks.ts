import type { Knex } from 'knex';
import performConversion, {
  conversionLogPrefix,
  trackConversionFailed,
} from './storage/jobs/helpers/performConversion';
import NotionAPIWrapper from '../services/NotionService/NotionAPIWrapper';
import NotionRepository from '../data_layer/NotionRespository';
import BlocksCacheRepository from '../data_layer/BlocksCacheRepository';
import JobRepository from '../data_layer/JobRepository';
import { SetJobFailedUseCase } from '../usecases/jobs/SetJobFailedUseCase';
import { NOTION_TOKEN_EXPIRED_REASON } from '../usecases/jobs/jobFailureReason';
import { getDatabase } from '../data_layer';
import type { ConversionWorkerRequest } from './conversionRequestTypes';

// The conversion runs inside a forked child process, which owns its own
// SINGLE_CONNECTION pool (sized min 0 / max 3 via DATABASE_POOL_* in the child
// env). The thread pool needed a separate small pool because a worker thread
// shared the main process; a child does not, so it reuses getDatabase() with no
// extra pool to leak connections.
function defaultKnexFactory(): Knex {
  return getDatabase();
}

export async function runConversionInWorker(
  request: ConversionWorkerRequest,
  knexFactory: () => Knex = defaultKnexFactory
): Promise<void> {
  const database = knexFactory();
  const notionRepo = new NotionRepository(database);
  const token = await notionRepo.getNotionToken(request.owner);
  if (token == null) {
    console.info(
      `${conversionLogPrefix({
        jobDbId: request.jobDbId,
        requestId: request.requestId,
      })} notion token expired — marking job failed`,
      { pageId: request.id }
    );
    const jobRepo = new JobRepository(database);
    const setJobFailed = new SetJobFailedUseCase(jobRepo);
    await setJobFailed.execute(
      request.id,
      request.owner,
      NOTION_TOKEN_EXPIRED_REASON
    );
    trackConversionFailed(
      request.owner,
      request.anonId,
      request.type,
      request.signupOrigin ?? null,
      { reason: 'notion_token_expired' }
    );
    return;
  }
  const blocksCache = new BlocksCacheRepository(database);
  const api = new NotionAPIWrapper(token, request.owner, blocksCache);
  await performConversion(database, { ...request, api });
}
