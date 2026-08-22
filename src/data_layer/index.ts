import process from 'process';
import path from 'path';

import knex, { Knex } from 'knex';
import MigratorConfig = Knex.MigratorConfig;

import { ScheduleCleanup } from '../lib/storage/jobs/ScheduleCleanup';
import { scheduleAnkifyReaper } from '../lib/ankify/jobs/scheduleAnkifyReaper';
import { scheduleImportJobReaper } from '../usecases/apkg/scheduleImportJobReaper';
import JobRepository from './JobRepository';
import { scheduleAnkifyPolling } from '../lib/ankify/jobs/scheduleAnkifyPolling';
import { RacService } from '../services/ankify/RacService';
import { AnkifyClientsRepository } from './ankify/AnkifyClientsRepository';
import { AnkifySessionTokensRepository } from './ankify/AnkifySessionTokensRepository';
import { AnkifyExportSchedulesRepository } from './ankify/AnkifyExportSchedulesRepository';
import { AnkifyExportScheduler } from '../services/ankify/AnkifyExportScheduler';
import { ExportReviewDataToNotionUseCase } from '../usecases/ankify/ExportReviewDataToNotionUseCase';
import { SyncNotionPageToRacUseCase } from '../usecases/ankify/SyncNotionPageToRacUseCase';
import { AnkifyNotionSubscriptionsRepository } from './ankify/AnkifyNotionSubscriptionsRepository';
import { AnkifySyncMappingsRepository } from './ankify/AnkifySyncMappingsRepository';
import { AnkifySyncConflictsRepository } from './ankify/AnkifySyncConflictsRepository';
import { AnkifySyncLogsRepository } from './ankify/AnkifySyncLogsRepository';
import { ankiConnectFactory } from '../services/ankify/buildAnkiConnectClient';
import { notionBlockChildrenFetcherFactory } from '../services/ankify/notionBlockChildrenFetcher';
import { buildNotionPageMetaFetcher } from '../services/ankify/buildNotionPageMetaFetcher';
import { makeAnkifyTemplateOverridesProvider } from '../services/ankify/templateOverrides';
import SettingsRepository from './SettingsRepository';
import { UnsupportedNotionBlockRepository } from './UnsupportedNotionBlockRepository';
import NotionRepository from './NotionRespository';
import NotionTopLevelPagesRepository from './NotionTopLevelPagesRepository';
import BlocksCacheRepository from './BlocksCacheRepository';
import {
  NotionService,
  TOP_LEVEL_PAGES_STALE_AFTER_MS,
} from '../services/NotionService/NotionService';
import { Client as NotionClient } from '@notionhq/client';
import { setAnkifyExportScheduler } from '../lib/ankify/scheduler/instance';
import Docker from 'dockerode';
import KnexConfig from '../KnexConfig';
import UsersRepository from './UsersRepository';
import { getDefaultEmailService } from '../services/EmailService/EmailService';
import { MarkNotionTokenInvalidUseCase } from '../usecases/notion/MarkNotionTokenInvalidUseCase';

/**
 * Performing this assignment here to prevent new connections from being created.
 */
const SINGLE_CONNECTION = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL,
});

export const getDatabase = () => SINGLE_CONNECTION;

export const setupDatabase = async (database: Knex) => {
  if (!process.env.DATABASE_URL) {
    console.info('DATABASE_URL is not set, skipping DB setup.');
    console.warn(
      "Things might not work as expected. If you're running this locally, you can ignore this warning if you are only interested in HTML uploads."
    );
    return;
  }

  try {
    await database.raw('SELECT 1');
    if (process.env.MIGRATIONS_DIR) {
      process.chdir(path.join(process.env.MIGRATIONS_DIR, '..'));
    }

    if (process.env.NODE_ENV === 'production' && !process.env.LOCAL_DEV) {
      console.info('DB is ready');

      // Only run cleanup jobs on main instance to avoid conflicts with Singapore instance
      if (process.env.INSTANCE_ID === 'singapore') {
        console.info(
          'Singapore instance: Cleanup jobs disabled to prevent conflicts'
        );
      } else {
        console.info('Main instance: Starting cleanup jobs');
        ScheduleCleanup(database);
      }
    }

    await database.migrate.latest(KnexConfig as MigratorConfig);

    if (process.env.INSTANCE_ID !== 'singapore') {
      const ankifyRepo = new AnkifyClientsRepository(database);
      const ankifySessionTokensRepo = new AnkifySessionTokensRepository(
        database
      );
      const ankifyRac = new RacService(
        ankifyRepo,
        new Docker(),
        ankifySessionTokensRepo
      );
      scheduleAnkifyReaper(ankifyRac);
      scheduleImportJobReaper(new JobRepository(database));

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
                    properties?: Record<
                      string,
                      { type: string; name?: string }
                    >;
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

      const subscriptionsRepo = new AnkifyNotionSubscriptionsRepository(
        database
      );
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
      scheduleAnkifyPolling(subscriptionsRepo, syncUseCase, {
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
      console.info('Ankify polling worker scheduled');
    }

    // Completed jobs become uploads. Any left during startup means they failed.
    // Claude AND Notion job types are excluded — their markInterrupted* methods
    // in server.ts own those rows so they surface as restartable 'interrupted',
    // not 'failed' with no reason (#4176).
    await new JobRepository(database).failStrandedLegacyJobs();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};
