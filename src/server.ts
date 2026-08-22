import { existsSync } from 'fs';
import path from 'path';
import http from 'http';

import express, { RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import morgan from 'morgan';
import type { Knex } from 'knex';

const localEnvFile = path.join(__dirname, '../.env');
if (existsSync(localEnvFile)) {
  dotenv.config({ path: localEnvFile });
}

import { BUILD_DIR } from './lib/constants';
import { mountWebBuild } from './lib/mountWebBuild';
import ErrorHandler from './routes/middleware/ErrorHandler';
import { makeErrorCaptureMiddleware } from './routes/middleware/ErrorCaptureMiddleware';
import { ErrorEventRepository } from './data_layer/ErrorEventRepository';
import { writeFallbackError, drainFallbackFile } from './lib/errorFallback';
import { getRelease } from './lib/release';

// Server Endpoints
import settingsRouter from './routes/SettingsRouter';
import checksRouter from './routes/ChecksRouter';
import versionRouter from './routes/VersionRouter';
import appStoreLinksRouter from './routes/AppStoreLinksRouter';
import uploadRouter from './routes/UploadRouter';
import usersRouter from './routes/UserRouter';
import notionRouter from './routes/NotionRouter';
import rulesRouter from './routes/ParserRulesRouter';
import downloadRouter from './routes/DownloadRouter';
import apkgRouter from './routes/ApkgRouter';
import favoriteRouter from './routes/FavoriteRouter';
import ankifyRouter from './routes/AnkifyRouter';
import {
  attachAnkifySessionProxy,
  buildAnkifySessionProxyDeps,
} from './routes/AnkifySessionProxyRouter';
import templatesRouter from './routes/TemplatesRouter';
import defaultRouter from './routes/DefaultRouter';
import rejectScannerProbes from './routes/middleware/rejectScannerProbes';
import { denyFraming } from './routes/middleware/denyFraming';
import { securityHeaders } from './routes/middleware/securityHeaders';
import { noindexNonCanonicalHosts } from './routes/middleware/noindexNonCanonicalHosts';
import { redirectNonCanonicalHosts } from './routes/middleware/redirectNonCanonicalHosts';
import { redirectConvertDuplicates } from './routes/middleware/redirectConvertDuplicates';
import webhookRouter from './routes/WebhookRouter';
import ankifyWebhookRouter from './routes/AnkifyWebhookRouter';
import sendgridWebhookRouter from './routes/SendgridWebhookRouter';
import swaggerRouter from './routes/SwaggerRouter';
import opsRouter from './routes/OpsRouter';
import opsErrorsRouter from './routes/OpsErrorsRouter';
import contactMessagesRouter from './routes/ContactMessagesRouter';
import showcaseRouter from './routes/ShowcaseRouter';
import emojiFeedbackRouter from './routes/EmojiFeedbackRouter';
import featureInterestRouter from './routes/FeatureInterestRouter';
import reEngagementRouter from './routes/ReEngagementRouter';
import emailRedirectRouter from './routes/EmailRedirectRouter';
import imageOcclusionRouter from './routes/ImageOcclusionRouter';
import chatRouter from './routes/ChatRouter';
import eventsRouter from './routes/EventsRouter';
import checkoutRouter from './routes/CheckoutRouter';
import shareRouter from './routes/ShareRouter';
import subscriptionClaimRouter from './routes/SubscriptionClaimRouter';
import mindmapRouter from './routes/MindmapRouter';
import pitchRouter from './routes/PitchRouter';
import iapRouter from './routes/IapRouter';
import mcpRouter from './routes/McpRouter';
import mcpDeckDownloadRouter from './routes/McpDeckDownloadRouter';
import wellKnownRouter from './routes/WellKnownRouter';
import healthRouter from './routes/HealthRouter';
import requestLoggingMiddleware from './routes/middleware/requestLoggingMiddleware';
import { anonIdMiddleware } from './routes/middleware/anonIdMiddleware';
import { requestIdMiddleware } from './routes/middleware/requestIdMiddleware';
import { getEventsSink } from './services/events/eventsSinkInstance';

import { getDatabase, setupDatabase } from './data_layer';
import { bootstrapBackgroundJobs } from './app/bootstrapBackgroundJobs';
import JobRepository from './data_layer/JobRepository';
import { MagicTokenRepository } from './data_layer/MagicTokenRepository';
import TokenRepository from './data_layer/TokenRepository';
import ReEngagementRepository from './data_layer/ReEngagementRepository';
import InactivityEmailRepository from './data_layer/InactivityEmailRepository';
import UploadRepository from './data_layer/UploadRespository';
import { updateStripeSubscriptions } from './lib/storage/jobs/helpers/updateStripeSubscriptions';
import { ScheduleCleanup } from './lib/storage/jobs/ScheduleCleanup';
import { scheduleReEngagementEmails } from './lib/reengagement/jobs/scheduleReEngagementEmails';
import { scheduleInactivityWarnings } from './lib/inactivity/jobs/scheduleInactivityWarnings';
import { schedulePauseResumeWarnings } from './lib/subscriptions/jobs/schedulePauseResumeWarnings';
import PauseResumeWarningRepository from './data_layer/PauseResumeWarningRepository';
import { SendPauseResumeWarningsUseCase } from './usecases/ops/SendPauseResumeWarningsUseCase';
import { scheduleInactiveUserDeletions } from './lib/inactivity/jobs/scheduleInactiveUserDeletions';
import { EventsRepository } from './data_layer/EventsRepository';
import { scheduleParserCanary } from './lib/parser/canary/scheduleParserCanary';
import { scheduleExportDriftCanary } from './lib/parser/canary/scheduleExportDriftCanary';
import { scheduleObservabilityCleanup } from './lib/observability/jobs/scheduleObservabilityCleanup';
import { scheduleMcpOAuthReaper } from './lib/mcp/jobs/scheduleMcpOAuthReaper';
import { McpAuthorizationCodeRepository } from './data_layer/McpAuthorizationCodeRepository';
import { McpTokenRepository } from './data_layer/McpTokenRepository';
import { McpOAuthClientRepository } from './data_layer/McpOAuthClientRepository';
import { ObservabilityRepository } from './data_layer/ObservabilityRepository';
import { getDefaultEmailService } from './services/EmailService/EmailService';
import { SendInactivityWarningsUseCase } from './usecases/ops/SendInactivityWarningsUseCase';
import { DeleteInactiveUsersUseCase } from './usecases/ops/DeleteInactiveUsersUseCase';
import UsersRepository from './data_layer/UsersRepository';
import { ChatAttachmentsRepository } from './data_layer/ChatAttachmentsRepository';
import { chatAttachmentRetentionCutoff } from './lib/storage/chatAttachmentKeys';
import StorageHandler from './lib/storage/StorageHandler';
import { UserDeletionService } from './services/UserDeletionService';
import SuppressionEventsRepository from './data_layer/SuppressionEventsRepository';
import { initConversionPool } from './lib/conversionPool';
import { assertBootConfig } from './lib/config';
import { registerSchedulerTimer } from './lib/scheduling/timerRegistry';
import { gracefulShutdown } from './lib/gracefulShutdown';

function registerSignalHandlers(server: http.Server, database: Knex) {
  process.on('uncaughtException', (error) => {
    writeFallbackError({
      source: 'server',
      message: error?.message ?? String(error),
      stack: error?.stack,
      capturedAt: new Date().toISOString(),
      phase: 'uncaught',
    });
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    writeFallbackError({
      source: 'server',
      message: error.message,
      stack: error.stack,
      capturedAt: new Date().toISOString(),
      phase: 'unhandled-rejection',
    });
    console.error('Unhandled Rejection:', reason);
    process.exit(1);
  });

  const handle = (signal: 'SIGTERM' | 'SIGINT') => {
    gracefulShutdown(signal, server, database).catch((err) => {
      console.error('gracefulShutdown threw, forcing exit:', err);
      process.exit(1);
    });
  };
  process.on('SIGTERM', () => handle('SIGTERM'));
  process.on('SIGINT', () => handle('SIGINT'));
}

const serve = async () => {
  const templateDir = path.join(__dirname, 'templates');
  const app = express();
  // nginx on the same box terminates SSL and forwards over loopback; trust exactly one hop.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  const server = http.createServer(app);

  app.use(webhookRouter());
  app.use(ankifyWebhookRouter());
  app.use(sendgridWebhookRouter());
  app.use(redirectNonCanonicalHosts);
  app.use(express.json({ limit: '50mb' }) as RequestHandler);
  app.use(cookieParser());
  app.use(denyFraming);
  app.use(securityHeaders);
  app.use(requestIdMiddleware);
  app.use(anonIdMiddleware);
  app.use(noindexNonCanonicalHosts);
  app.use(redirectConvertDuplicates);

  app.use(rejectScannerProbes);
  app.use(morgan('combined') as RequestHandler);
  app.use(requestLoggingMiddleware);

  const ankifySessionValidate = buildAnkifySessionProxyDeps();
  attachAnkifySessionProxy(app, server, ankifySessionValidate);

  app.use('/templates', express.static(templateDir));
  mountWebBuild(app, BUILD_DIR);

  // API Documentation
  app.use(swaggerRouter());

  app.use(checksRouter());
  app.use(versionRouter());
  app.use(appStoreLinksRouter());
  app.use(uploadRouter());
  app.use(usersRouter());
  app.use(notionRouter());
  app.use(rulesRouter());
  app.use(settingsRouter());
  app.use(downloadRouter());
  app.use(apkgRouter());
  app.use(favoriteRouter());
  app.use(ankifyRouter());
  app.use(templatesRouter());
  app.use(showcaseRouter());
  app.use(opsRouter());
  app.use(opsErrorsRouter());
  app.use(contactMessagesRouter());
  app.use(emojiFeedbackRouter());
  app.use(featureInterestRouter());
  app.use(reEngagementRouter());
  app.use(emailRedirectRouter());
  app.use(imageOcclusionRouter());
  app.use(chatRouter());
  app.use(eventsRouter());
  app.use(checkoutRouter());
  app.use(shareRouter());
  app.use(subscriptionClaimRouter());
  app.use(mindmapRouter());
  app.use(pitchRouter());
  app.use(iapRouter());
  app.use(mcpRouter());
  app.use(mcpDeckDownloadRouter());

  const database = getDatabase();
  app.use(healthRouter(database));
  app.use(wellKnownRouter());
  app.use(defaultRouter());
  const errorEventRepo = new ErrorEventRepository(database);
  app.use(
    makeErrorCaptureMiddleware(errorEventRepo, writeFallbackError, getRelease())
  );
  app.use(
    (
      err: Error,
      req: express.Request,
      res: express.Response,
      next: () => void
    ) => {
      if (!err) {
        next();
      } else {
        ErrorHandler(res, req, err);
      }
    }
  );

  const cwd = process.cwd();
  process.chdir(cwd);
  assertBootConfig();
  initConversionPool();
  const port = process.env.PORT || 2020;
  server.listen(port, () => {
    console.info(`Running on http://localhost:${port}`);
  });
  registerSignalHandlers(server, database);

  await setupDatabase(database);
  await bootstrapBackgroundJobs(database);

  const drainedCount = await drainFallbackFile(errorEventRepo);
  if (drainedCount > 0) {
    console.info(
      `[startup] Drained ${drainedCount} error(s) from fallback file into error_events`
    );
  }

  const jobRepo = new JobRepository(database);
  const interruptedClaudeCount = await jobRepo.markInterruptedClaudeJobs();
  if (interruptedClaudeCount > 0) {
    console.info(
      `[startup] Marked ${interruptedClaudeCount} Claude job(s) as interrupted`
    );
  }
  const interruptedNotionCount = await jobRepo.markInterruptedNotionJobs();
  if (interruptedNotionCount > 0) {
    console.info(
      `[startup] Marked ${interruptedNotionCount} Notion job(s) as interrupted`
    );
  }

  const expiredAttachmentRows = await new ChatAttachmentsRepository(
    database
  ).deleteOlderThan(chatAttachmentRetentionCutoff());
  if (expiredAttachmentRows > 0) {
    console.info(
      `[startup] Removed ${expiredAttachmentRows} expired chat attachment record(s)`
    );
  }

  new MagicTokenRepository(database).deleteExpired().then((count) => {
    if (count > 0) {
      console.info(`Cleaned up ${count} expired magic token(s)`);
    }
  });

  new TokenRepository(database).deleteExpired().then((count) => {
    if (count > 0) {
      console.info(`Cleaned up ${count} expired access token(s)`);
    }
  });

  if (process.env.STRIPE_SYNC_ON_STARTUP === 'true') {
    console.info('[startup] Running Stripe subscription sync in background');
    updateStripeSubscriptions().catch((error) => {
      console.error('[startup] Stripe subscription sync failed:', error);
    });
  }

  const eventsSink = getEventsSink();
  const eventsRepo = new EventsRepository(database);
  const reEngagementRepo = new ReEngagementRepository(database);
  const emailService = getDefaultEmailService();
  scheduleReEngagementEmails(reEngagementRepo, emailService, eventsSink, {
    lastRunAt: () => eventsRepo.lastEventAt('email_batch_sent', 'reengagement'),
  })
    .then(registerSchedulerTimer)
    .catch((error) => {
      console.error('[re-engagement] failed to schedule:', error);
    });

  const inactivityEmailRepo = new InactivityEmailRepository(database);
  const uploadRepo = new UploadRepository(database);
  const sendInactivityWarningsUseCase = new SendInactivityWarningsUseCase(
    inactivityEmailRepo,
    emailService,
    uploadRepo
  );
  scheduleInactivityWarnings(sendInactivityWarningsUseCase, {
    eventsSink,
    lastRunAt: () => eventsRepo.lastEventAt('email_batch_sent', 'inactivity'),
  })
    .then(registerSchedulerTimer)
    .catch((error) => {
      console.error('[inactivity-warnings] failed to schedule:', error);
    });

  const pauseResumeWarningRepo = new PauseResumeWarningRepository(database);
  const sendPauseResumeWarningsUseCase = new SendPauseResumeWarningsUseCase(
    pauseResumeWarningRepo,
    emailService
  );
  schedulePauseResumeWarnings(sendPauseResumeWarningsUseCase, {
    eventsSink,
    lastRunAt: () => eventsRepo.lastEventAt('email_batch_sent', 'pause_resume'),
  })
    .then(registerSchedulerTimer)
    .catch((error) => {
      console.error('[pause-resume-warnings] failed to schedule:', error);
    });

  const deleteInactiveUsersUseCase = new DeleteInactiveUsersUseCase(
    inactivityEmailRepo,
    new UserDeletionService(
      new UsersRepository(database),
      new StorageHandler()
    ),
    new SuppressionEventsRepository(database)
  );
  scheduleInactiveUserDeletions(deleteInactiveUsersUseCase, {
    eventsSink,
    lastRunAt: () => eventsRepo.lastEventAt('inactive_users_deleted'),
  })
    .then(registerSchedulerTimer)
    .catch((error) => {
      console.error('[inactivity-deletions] failed to schedule:', error);
    });

  registerSchedulerTimer(scheduleParserCanary(emailService));

  registerSchedulerTimer(scheduleExportDriftCanary(emailService));

  registerSchedulerTimer(
    scheduleObservabilityCleanup(new ObservabilityRepository(database))
  );

  registerSchedulerTimer(
    scheduleMcpOAuthReaper({
      authorizationCodes: new McpAuthorizationCodeRepository(database),
      tokens: new McpTokenRepository(database),
      clients: new McpOAuthClientRepository(database),
    })
  );

  if (process.env.INSTANCE_ID === 'singapore') {
    console.info(
      'Singapore instance: Cleanup jobs disabled to prevent conflicts'
    );
  } else {
    try {
      ScheduleCleanup(database).forEach(registerSchedulerTimer);
    } catch (error) {
      console.error('[fs-cleanup] failed to schedule:', error);
    }
  }
};

serve().catch((error) => {
  writeFallbackError({
    source: 'server',
    message: error?.message ?? String(error),
    stack: error?.stack,
    capturedAt: new Date().toISOString(),
    phase: 'startup',
  });
  console.error('[startup] Fatal error during boot:', error);
  process.exit(1);
});
