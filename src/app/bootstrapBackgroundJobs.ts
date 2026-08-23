import { Knex } from 'knex';
import { Client as NotionClient } from '@notionhq/client';
import Docker from 'dockerode';

import { scheduleAnkifyReaper } from '../lib/ankify/jobs/scheduleAnkifyReaper';
import { registerSchedulerTimer } from '../lib/scheduling/timerRegistry';
import { scheduleImportJobReaper } from '../usecases/apkg/scheduleImportJobReaper';
import JobRepository from '../data_layer/JobRepository';
import { scheduleAnkifyPolling } from '../lib/ankify/jobs/scheduleAnkifyPolling';
import { RacService } from '../services/ankify/RacService';
import { AnkifyClientsRepository } from '../data_layer/ankify/AnkifyClientsRepository';
import { AnkifySessionTokensRepository } from '../data_layer/ankify/AnkifySessionTokensRepository';
import { AnkifyExportSchedulesRepository } from '../data_layer/ankify/AnkifyExportSchedulesRepository';
import { AnkifyExportScheduler } from '../services/ankify/AnkifyExportScheduler';
import { ExportReviewDataToNotionUseCase } from '../usecases/ankify/ExportReviewDataToNotionUseCase';
import { SyncNotionPageToRacUseCase } from '../usecases/ankify/SyncNotionPageToRacUseCase';
import { AnkifyNotionSubscriptionsRepository } from '../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import { AnkifySyncMappingsRepository } from '../data_layer/ankify/AnkifySyncMappingsRepository';
import { AnkifySyncConflictsRepository } from '../data_layer/ankify/AnkifySyncConflictsRepository';
import { AnkifySyncLogsRepository } from '../data_layer/ankify/AnkifySyncLogsRepository';
import { ankiConnectFactory } from '../services/ankify/buildAnkiConnectClient';
import { notionBlockChildrenFetcherFactory } from '../services/ankify/notionBlockChildrenFetcher';
import { buildNotionPageMetaFetcher } from '../services/ankify/buildNotionPageMetaFetcher';
import { makeAnkifyTemplateOverridesProvider } from '../services/ankify/templateOverrides';
import SettingsRepository from '../data_layer/SettingsRepository';
import { UnsupportedNotionBlockRepository } from '../data_layer/UnsupportedNotionBlockRepository';
import NotionRepository from '../data_layer/NotionRespository';
import NotionTopLevelPagesRepository from '../data_layer/NotionTopLevelPagesRepository';
import BlocksCacheRepository from '../data_layer/BlocksCacheRepository';
import {
  NotionService,
  TOP_LEVEL_PAGES_STALE_AFTER_MS,
} from '../services/NotionService/NotionService';
import { setAnkifyExportScheduler } from '../lib/ankify/scheduler/instance';
import UsersRepository from '../data_layer/UsersRepository';
import { getDefaultEmailService } from '../services/EmailService/EmailService';
import { MarkNotionTokenInvalidUseCase } from '../usecases/notion/MarkNotionTokenInvalidUseCase';

export const bootstrapBackgroundJobs = async (database: Knex) => {
  if (process.env.INSTANCE_ID === 'singapore') {
    return;
  }

  const ankifyRepo = new AnkifyClientsRepository(database);
  const ankifySessionTokensRepo = new AnkifySessionTokensRepository(database);
  const ankifyRac = new RacService(
    ankifyRepo,
    new Docker(),
    ankifySessionTokensRepo
  );
  registerSchedulerTimer(scheduleAnkifyReaper(ankifyRac));
  registerSchedulerTimer(scheduleImportJobReaper(new JobRepository(database)));

  const schedulesRepo = new AnkifyExportSchedulesRepository(database);
  const notionRepo = new NotionRepository(database);
  const exportUseCase = new ExportReviewDataToNotionUseCase(
    ankifyRepo,
    notionRepo,
    ankiConnectFactory,
    (token) => {
      const notion = new NotionClient({ auth: token });
      const findFirstDataSourceId = async (
        databaseId: string
      ): Promise<string | null> => {
        const dbResp = await notion.databases.retrieve({
          database_id: databaseId,
        });
        const dataSources =
          'data_sources' in dbResp
            ? (dbResp as { data_sources: { id: string }[] }).data_sources
            : [];
        return dataSources[0]?.id ?? null;
      };
      return {
        databases: {
          query: async (params) => {
            const dataSourceId = await findFirstDataSourceId(
              params.database_id
            );
            if (dataSourceId == null) {
              return { results: [] };
            }
            const res = await notion.dataSources.query({
              data_source_id: dataSourceId,
              filter: params.filter as never,
            });
            return { results: res.results };
          },
        },
        pages: {
          create: async (params) => {
            const dataSourceId = await findFirstDataSourceId(
              params.parent.database_id
            );
            if (dataSourceId == null) {
              throw new Error(
                'No data source found for the selected Notion database'
              );
            }
            return notion.pages.create({
              parent: {
                type: 'data_source_id',
                data_source_id: dataSourceId,
              },
              properties: params.properties as Parameters<
                typeof notion.pages.create
              >[0]['properties'],
            });
          },
        },
        getSchema: async (databaseId) => {
          const dataSourceId = await findFirstDataSourceId(databaseId);
          if (dataSourceId == null) {
            return { properties: {} };
          }
          const dataSource = await notion.dataSources.retrieve({
            data_source_id: dataSourceId,
          });
          const properties =
            (
              dataSource as {
                properties?: Record<string, { type: string; name?: string }>;
              }
            ).properties ?? {};
          return { properties };
        },
      };
    }
  );
  const scheduler = new AnkifyExportScheduler(schedulesRepo, exportUseCase);
  setAnkifyExportScheduler(scheduler);
  const recovered = await scheduler.recoverAll();
  console.info(`Ankify scheduler recovered ${recovered} schedule(s)`);

  const subscriptionsRepo = new AnkifyNotionSubscriptionsRepository(database);
  const mappingsRepo = new AnkifySyncMappingsRepository(database);
  const conflictsRepo = new AnkifySyncConflictsRepository(database);
  const logsRepo = new AnkifySyncLogsRepository(database);
  const syncUseCase = new SyncNotionPageToRacUseCase(
    ankifyRepo,
    mappingsRepo,
    conflictsRepo,
    subscriptionsRepo,
    logsRepo,
    notionRepo,
    ankiConnectFactory,
    notionBlockChildrenFetcherFactory,
    (token) => buildNotionPageMetaFetcher(token),
    undefined,
    (owner: number) =>
      new MarkNotionTokenInvalidUseCase(
        notionRepo,
        new UsersRepository(database),
        getDefaultEmailService()
      ).execute(owner),
    makeAnkifyTemplateOverridesProvider(new SettingsRepository(database)),
    undefined,
    new UnsupportedNotionBlockRepository(database)
  );
  const topLevelPagesRepo = new NotionTopLevelPagesRepository(database);
  const blocksCacheRepo = new BlocksCacheRepository(database);
  const notionServiceForRefresh = new NotionService(
    notionRepo,
    topLevelPagesRepo,
    blocksCacheRepo
  );
  const pollingHandle = scheduleAnkifyPolling(subscriptionsRepo, syncUseCase, {
    refreshTopLevelPagesForOwner: async (owner) => {
      const newest = await topLevelPagesRepo.newestCachedAt(owner);
      if (
        newest &&
        Date.now() - newest.getTime() < TOP_LEVEL_PAGES_STALE_AFTER_MS
      ) {
        return;
      }
      await notionServiceForRefresh.refreshTopLevelPagesCache(owner);
    },
  });
  registerSchedulerTimer(pollingHandle);
  console.info('Ankify polling worker scheduled');
};
