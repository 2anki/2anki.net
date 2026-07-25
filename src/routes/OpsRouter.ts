import express from 'express';

import OpsController from '../controllers/OpsController';
import { GetOpsMetricsUseCase } from '../usecases/ops/GetOpsMetricsUseCase';
import { GetBusinessMetricsUseCase } from '../usecases/ops/GetBusinessMetricsUseCase';
import { GetConversionMetricsUseCase } from '../usecases/ops/GetConversionMetricsUseCase';
import { GetPerformanceMetricsUseCase } from '../usecases/ops/GetPerformanceMetricsUseCase';
import { GetReturnRateMetricsUseCase } from '../usecases/ops/GetReturnRateMetricsUseCase';
import { GetMindmapStorageMetricsUseCase } from '../usecases/ops/GetMindmapStorageMetricsUseCase';
import { MindmapStorageMetricsService } from '../services/ops/MindmapStorageMetricsService';
import StorageHandler from '../lib/storage/StorageHandler';
import { PopulateShowcaseUseCase } from '../usecases/ops/PopulateShowcaseUseCase';
import { ObservabilityRepository } from '../data_layer/ObservabilityRepository';
import { UnsupportedNotionBlockRepository } from '../data_layer/UnsupportedNotionBlockRepository';
import { ConversionOutputStatsRepository } from '../data_layer/ConversionOutputStatsRepository';
import { ParsePathSignatureRepository } from '../data_layer/ParsePathSignatureRepository';
import { ObservabilityQueryService } from '../services/observability/ObservabilityQueryService';
import { BusinessMetricsService } from '../services/ops/BusinessMetricsService';
import { ConversionMetricsService } from '../services/ops/ConversionMetricsService';
import { PerformanceMetricsService } from '../services/ops/PerformanceMetricsService';
import { ReturnRateMetricsService } from '../services/ops/ReturnRateMetricsService';
import { BusinessMetricsCacheRepository } from '../data_layer/BusinessMetricsCacheRepository';
import { CancellationFeedbackRepository } from '../data_layer/CancellationFeedbackRepository';
import { EmojiFeedbackRepository } from '../data_layer/EmojiFeedbackRepository';
import { ReEngagementFeedbackRepository } from '../data_layer/ReEngagementFeedbackRepository';
import UsersRepository from '../data_layer/UsersRepository';
import { SubscriptionsSourceRepository } from '../data_layer/SubscriptionsSourceRepository';
import SuppressionEventsRepository from '../data_layer/SuppressionEventsRepository';
import { ShowcaseRepository } from '../data_layer/ShowcaseRepository';
import DownloadRepository from '../data_layer/DownloadRepository';
import NotionRepository from '../data_layer/NotionRespository';
import BlocksCacheRepository from '../data_layer/BlocksCacheRepository';
import DownloadService from '../services/DownloadService';
import ApkgPreviewService from '../services/ApkgPreviewService/ApkgPreviewService';
import { NotionService } from '../services/NotionService/NotionService';
import { getDatabase } from '../data_layer';
import RequireOpsAccess from './middleware/RequireOpsAccess';
import InactivityEmailRepository from '../data_layer/InactivityEmailRepository';
import { SendInactivityWarningsUseCase } from '../usecases/ops/SendInactivityWarningsUseCase';
import { SendPassWinbackUseCase } from '../usecases/ops/SendPassWinbackUseCase';
import GrantDeveloperAccessUseCase from '../usecases/developer/GrantDeveloperAccessUseCase';
import PassWinbackRepository from '../data_layer/PassWinbackRepository';
import { emailHash } from '../lib/emailHash';
import { getEventsSink } from '../services/events/eventsSinkInstance';
import { DeleteInactiveUsersUseCase } from '../usecases/ops/DeleteInactiveUsersUseCase';
import { getDefaultEmailService } from '../services/EmailService/EmailService';
import { UserVisibleErrorsRepository } from '../data_layer/UserVisibleErrorsRepository';
import { JobsMetricsRepository } from '../data_layer/JobsMetricsRepository';
import { EventsMetricsRepository } from '../data_layer/EventsMetricsRepository';
import { SyncStripeSubscriptionsUseCase } from '../usecases/ops/SyncStripeSubscriptionsUseCase';
import { GetUploadFunnelUseCase } from '../usecases/ops/GetUploadFunnelUseCase';
import { UploadFunnelService } from '../services/ops/UploadFunnelService';
import { GetCancelFunnelUseCase } from '../usecases/ops/GetCancelFunnelUseCase';
import { CancelFunnelService } from '../services/ops/CancelFunnelService';
import { GetLandingPageYieldUseCase } from '../usecases/ops/GetLandingPageYieldUseCase';
import { LandingPageYieldService } from '../services/ops/LandingPageYieldService';
import { LandingPageYieldRepository } from '../data_layer/LandingPageYieldRepository';
import { GetCustomerSignalsUseCase } from '../usecases/ops/GetCustomerSignalsUseCase';
import { CustomerSignalsService } from '../services/ops/CustomerSignalsService';
import { BehavioralDropoffRepository } from '../data_layer/BehavioralDropoffRepository';
import { GetPassUnlockMonitorUseCase } from '../usecases/ops/GetPassUnlockMonitorUseCase';
import { PassUnlockMonitorService } from '../services/ops/PassUnlockMonitorService';
import UserPassRepository from '../data_layer/UserPassRepository';
import AnonymousPassRepository from '../data_layer/AnonymousPassRepository';
import { updateStripeSubscriptions } from '../lib/storage/jobs/helpers/updateStripeSubscriptions';
import EventsRepository from '../data_layer/EventsRepository';
import { FeatureFlagsRepository } from '../data_layer/FeatureFlagsRepository';
import { ListFeatureFlagsUseCase } from '../usecases/ops/ListFeatureFlagsUseCase';
import { SetFeatureFlagUseCase } from '../usecases/ops/SetFeatureFlagUseCase';
import { getStripe } from '../lib/integrations/stripe';
import { OrphanedSubscriptionsRepository } from '../data_layer/OrphanedSubscriptionsRepository';
import { SubscriptionRecoveryNotificationsRepository } from '../data_layer/SubscriptionRecoveryNotificationsRepository';
import { GetOrphanedSubscriptionsUseCase } from '../usecases/ops/GetOrphanedSubscriptionsUseCase';
import { ReconcileOrphanedSubscriptionsUseCase } from '../usecases/ops/ReconcileOrphanedSubscriptionsUseCase';

const OpsRouter = () => {
  const router = express.Router();
  router.use('/api/ops', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const database = getDatabase();
  const repo = new ObservabilityRepository(database);
  const queryService = new ObservabilityQueryService(
    repo,
    new UnsupportedNotionBlockRepository(database),
    new ConversionOutputStatsRepository(database),
    new ParsePathSignatureRepository(database)
  );

  const businessMetricsService = new BusinessMetricsService({
    cacheRepository: new BusinessMetricsCacheRepository(database),
    cancellationRepository: new CancellationFeedbackRepository(database),
    emojiFeedbackRepository: new EmojiFeedbackRepository(database),
    reengagementRepository: new ReEngagementFeedbackRepository(database),
    signupCountryRepository: new UsersRepository(database),
    signupCountsRepository: new UsersRepository(database),
    subscriptionsRepository: new SubscriptionsSourceRepository(database),
    passSalesRepository: new EventsMetricsRepository(database),
  });

  const conversionMetricsService = new ConversionMetricsService(
    new JobsMetricsRepository(database),
    new EventsMetricsRepository(database)
  );
  const performanceMetricsService = new PerformanceMetricsService(
    database,
    new UserVisibleErrorsRepository(database)
  );

  const showcaseRepo = new ShowcaseRepository(database);
  const populateShowcase = new PopulateShowcaseUseCase(
    showcaseRepo,
    new NotionService(
      new NotionRepository(database),
      undefined,
      new BlocksCacheRepository(database)
    ),
    new ApkgPreviewService(),
    new DownloadService(new DownloadRepository(database))
  );

  const emailService = getDefaultEmailService();

  const storageHandler = new StorageHandler();
  const mindmapStorageService = new MindmapStorageMetricsService(() =>
    storageHandler.listMindmapObjects()
  );

  const controller = new OpsController(
    new GetOpsMetricsUseCase(queryService),
    new GetBusinessMetricsUseCase(businessMetricsService),
    new GetConversionMetricsUseCase(conversionMetricsService),
    populateShowcase,
    showcaseRepo,
    new SendInactivityWarningsUseCase(
      new InactivityEmailRepository(database),
      emailService
    ),
    new GetPerformanceMetricsUseCase(performanceMetricsService),
    new GetReturnRateMetricsUseCase(new ReturnRateMetricsService(database)),
    new GetMindmapStorageMetricsUseCase(mindmapStorageService),
    new DeleteInactiveUsersUseCase(
      new InactivityEmailRepository(database),
      new UsersRepository(database),
      new SuppressionEventsRepository(database)
    ),
    new SyncStripeSubscriptionsUseCase(() => updateStripeSubscriptions()),
    new ListFeatureFlagsUseCase(new FeatureFlagsRepository(database)),
    new SetFeatureFlagUseCase(new FeatureFlagsRepository(database)),
    new GetUploadFunnelUseCase(
      new UploadFunnelService({ eventsRepo: new EventsRepository(database) })
    ),
    new GetOrphanedSubscriptionsUseCase(
      new OrphanedSubscriptionsRepository(database)
    ),
    new ReconcileOrphanedSubscriptionsUseCase(
      new OrphanedSubscriptionsRepository(database),
      new SubscriptionRecoveryNotificationsRepository(database),
      emailService,
      async (customerId: string) => {
        const customer = await getStripe().customers.retrieve(customerId);
        return 'email' in customer ? (customer.email ?? null) : null;
      }
    ),
    new GetLandingPageYieldUseCase(
      new LandingPageYieldService({
        repo: new LandingPageYieldRepository(database),
      })
    ),
    new GetCustomerSignalsUseCase(
      new CustomerSignalsService({
        cancellation: new CancellationFeedbackRepository(database),
        emoji: new EmojiFeedbackRepository(database),
        failedConversion: new JobsMetricsRepository(database),
        emptyBack: new ConversionOutputStatsRepository(database),
        behavioralDropoff: new BehavioralDropoffRepository(database),
      })
    ),
    new GetPassUnlockMonitorUseCase(
      new PassUnlockMonitorService({
        userPasses: new UserPassRepository(database),
        anonymousPasses: new AnonymousPassRepository(database),
      })
    ),
    new SendPassWinbackUseCase(
      new PassWinbackRepository(database),
      emailService,
      (email) =>
        new SuppressionEventsRepository(database).isSuppressed(
          emailHash(email)
        ),
      getEventsSink()
    ),
    new GrantDeveloperAccessUseCase(new UsersRepository(database)),
    new GetCancelFunnelUseCase(
      new CancelFunnelService({ eventsRepo: new EventsRepository(database) })
    )
  );

  /**
   * @swagger
   * /api/ops/metrics:
   *   get:
   *     summary: Aggregated request/outbound observability metrics
   *     description: Internal endpoint locked to the ops owner. Returns 404 for everyone else (we don't reveal that the dashboard exists).
   *     tags: [Ops]
   *     parameters:
   *       - in: query
   *         name: window
   *         required: false
   *         schema:
   *           type: string
   *           enum: [1h, 24h, 7d]
   *     responses:
   *       200:
   *         description: Metrics payload
   *       404:
   *         description: Not the ops owner
   */
  router.get('/api/ops/metrics', RequireOpsAccess, (req, res) =>
    controller.getMetrics(req, res)
  );

  /**
   * @swagger
   * /api/ops/business/metrics:
   *   get:
   *     summary: Business metrics from Stripe-backed subscriptions
   *     description: Internal endpoint locked to the ops owner. Returns 404 for everyone else.
   *     tags: [Ops]
   *     responses:
   *       200:
   *         description: Business metrics payload
   *       404:
   *         description: Not the ops owner
   */
  router.get('/api/ops/business/metrics', RequireOpsAccess, (req, res) =>
    controller.getBusinessMetrics(req, res)
  );

  /**
   * @swagger
   * /api/ops/conversion/metrics:
   *   get:
   *     summary: Conversion success/failure metrics from jobs table plus funnel metrics from events
   *     description: Internal endpoint locked to the ops owner. Returns 404 for everyone else.
   *     tags: [Ops]
   *     responses:
   *       200:
   *         description: Conversion metrics payload
   *       404:
   *         description: Not the ops owner
   */
  router.get('/api/ops/conversion/metrics', RequireOpsAccess, (req, res) =>
    controller.getConversionMetrics(req, res)
  );

  /**
   * @swagger
   * /api/ops/showcase/populate:
   *   post:
   *     summary: Populate homepage showcase
   *     description: Fetches Notion blocks and APKG cards, caches them in the database for the homepage showcase section.
   *     tags: [Ops]
   *     responses:
   *       200:
   *         description: Showcase populated
   *       404:
   *         description: Not the ops owner
   */
  router.post('/api/ops/showcase/populate', RequireOpsAccess, (req, res) =>
    controller.populateShowcase(req, res)
  );

  /**
   * @swagger
   * /api/ops/showcase:
   *   delete:
   *     summary: Purge homepage showcase
   *     description: Deletes the cached showcase data. The homepage section hides when no data exists.
   *     tags: [Ops]
   *     responses:
   *       200:
   *         description: Showcase purged
   *       404:
   *         description: Not the ops owner
   */
  router.delete('/api/ops/showcase', RequireOpsAccess, (req, res) =>
    controller.purgeShowcase(req, res)
  );

  /**
   * @swagger
   * /api/ops/send-inactivity-warnings:
   *   post:
   *     summary: Send inactivity warning emails to dormant free accounts
   *     description: |
   *       Finds free users inactive for 6+ months and sends a deletion warning email.
   *       Exempt: patreon=true (lifetime) and active Stripe subscribers.
   *       Pass ?dryRun=false to send real emails; omit or pass ?dryRun=true to count candidates only.
   *       Run manually — do not put on a cron until signal is validated.
   *     tags: [Ops]
   *     parameters:
   *       - in: query
   *         name: dryRun
   *         schema:
   *           type: string
   *           enum: ['true', 'false']
   *         description: Defaults to true. Pass false to actually send emails.
   *     responses:
   *       200:
   *         description: Result with candidate count and dryRun flag
   *       404:
   *         description: Not the ops owner
   */
  router.post(
    '/api/ops/send-inactivity-warnings',
    RequireOpsAccess,
    (req, res) => controller.sendInactivityWarnings(req, res)
  );

  /**
   * @swagger
   * /api/ops/send-pass-winback:
   *   post:
   *     summary: Send a win-back email to lapsed one-time pass buyers
   *     description: |
   *       Finds users whose paid Day/Week pass has expired with no active pass or
   *       subscription, and sends a seasonal win-back nudge. Excludes marketing_opt_out
   *       and hard-suppressed addresses, and dedupes per user per campaign.
   *       Pass ?campaign=<id> (required, e.g. winback-2026-fall) to scope the send and dedupe window.
   *       Pass ?dryRun=false to send real emails; omit or pass ?dryRun=true to count candidates only.
   *       Run manually — enabling an automatic seasonal send is the maintainer's call.
   *     tags: [Ops]
   *     parameters:
   *       - in: query
   *         name: campaign
   *         required: true
   *         schema:
   *           type: string
   *         description: Campaign identifier — scopes the send and the per-user dedupe.
   *       - in: query
   *         name: dryRun
   *         schema:
   *           type: string
   *           enum: ['true', 'false']
   *         description: Defaults to true. Pass false to actually send emails.
   *     responses:
   *       200:
   *         description: Result with campaign, count, and dryRun flag
   *       400:
   *         description: campaign missing
   *       404:
   *         description: Not the ops owner
   */
  router.post('/api/ops/send-pass-winback', RequireOpsAccess, (req, res) =>
    controller.sendPassWinback(req, res)
  );

  /**
   * @swagger
   * /api/ops/delete-inactive-users:
   *   post:
   *     summary: Delete free accounts that ignored the inactivity warning
   *     description: |
   *       Deletes accounts that were warned 14+ days ago and still have not logged in
   *       since the warning. Exempt: patreon=true (lifetime) and active Stripe subscribers.
   *       Permanently removes the user and all their data (usage is snapshotted first).
   *       Pass ?dryRun=false to delete; omit or pass ?dryRun=true to count candidates only.
   *       Also runs as a daily background job, capped at 100 deletions per run.
   *     tags: [Ops]
   *     parameters:
   *       - in: query
   *         name: dryRun
   *         schema:
   *           type: string
   *           enum: ['true', 'false']
   *         description: Defaults to true. Pass false to actually delete accounts.
   *     responses:
   *       200:
   *         description: Result with candidate/deleted count and dryRun flag
   *       404:
   *         description: Not the ops owner
   */
  router.post('/api/ops/delete-inactive-users', RequireOpsAccess, (req, res) =>
    controller.deleteInactiveUsers(req, res)
  );

  /**
   * @swagger
   * /api/ops/developer-access:
   *   post:
   *     summary: Grant or revoke Developers API access for an account by email
   *     description: |
   *       Sets `users.developer_access` for the account matching the given email.
   *       Grants access to the lifetime-gated Developers surface without making
   *       the account lifetime. Internal endpoint locked to the ops owner.
   *     tags: [Ops]
   *     responses:
   *       200:
   *         description: Updated — returns the affected count and grant state
   *       400:
   *         description: Missing or invalid email
   *       404:
   *         description: No account found for that email
   */
  router.post('/api/ops/developer-access', RequireOpsAccess, (req, res) =>
    controller.grantDeveloperAccess(req, res)
  );

  /**
   * @swagger
   * /api/ops/performance/metrics:
   *   get:
   *     summary: Job-duration percentiles, status breakdown, and signup-country counts
   *     description: |
   *       Internal endpoint locked to the ops owner. Returns p50/p95/p99 job durations (24h and 7d), terminal-status counts, the 20 slowest done jobs in the last 24h, and signup country breakdown for the last 7 days. Returns 404 for everyone else.
   *     tags: [Ops]
   *     responses:
   *       200:
   *         description: Performance metrics payload
   *       404:
   *         description: Not the ops owner
   */
  router.get('/api/ops/performance/metrics', RequireOpsAccess, (req, res) =>
    controller.getPerformanceMetrics(req, res)
  );

  /**
   * @swagger
   * /api/ops/return-rate/metrics:
   *   get:
   *     summary: Post-completion return-rate metrics bucketed by source type
   *     description: |
   *       Internal endpoint locked to the ops owner. Returns the % of users who returned for a
   *       second conversion within 7, 14, and 30 days of their prior successful conversion,
   *       bucketed by source_type (page, database, conversion). Cohort window is the last 90 days.
   *       Returns 404 for everyone else.
   *     tags: [Ops]
   *     responses:
   *       200:
   *         description: Return-rate metrics payload
   *       404:
   *         description: Not the ops owner
   */
  router.get('/api/ops/return-rate/metrics', RequireOpsAccess, (req, res) =>
    controller.getReturnRateMetrics(req, res)
  );

  /**
   * @swagger
   * /api/ops/mindmap/storage:
   *   get:
   *     summary: Mindmap image storage usage on S3
   *     description: |
   *       Internal endpoint locked to the ops owner. Returns total bytes and object count for all
   *       mindmap images under the mindmaps/ S3 prefix, plus a top-20 breakdown by user ID.
   *       Use this to gauge growth before deciding on per-user quotas. Returns 404 for everyone else.
   *     tags: [Ops]
   *     responses:
   *       200:
   *         description: Mindmap storage metrics payload
   *       404:
   *         description: Not the ops owner
   */
  router.get('/api/ops/mindmap/storage', RequireOpsAccess, (req, res) =>
    controller.getMindmapStorageMetrics(req, res)
  );

  /**
   * @swagger
   * /api/ops/sync-stripe-subscriptions:
   *   post:
   *     summary: Sync subscriptions from Stripe into the database
   *     description: |
   *       Pulls every active Stripe subscription and upserts it into the subscriptions
   *       table, then reconciles each active DB row against Stripe (deactivating any
   *       that Stripe no longer reports active). Use this to provision a paying user
   *       whose subscription did not land via webhook. Runs in the background and
   *       returns immediately; watch the server logs for the result. Locked to the ops
   *       owner — returns 404 for everyone else.
   *     tags: [Ops]
   *     responses:
   *       202:
   *         description: Sync started in the background
   *       409:
   *         description: A sync is already running
   *       404:
   *         description: Not the ops owner
   */
  router.post(
    '/api/ops/sync-stripe-subscriptions',
    RequireOpsAccess,
    (req, res) => controller.syncStripeSubscriptions(req, res)
  );

  /**
   * @swagger
   * /api/ops/flags:
   *   get:
   *     summary: List runtime feature flags
   *     description: |
   *       Returns every flag in the feature_flags table along with the email of the
   *       admin who last toggled it. Flags are pre-seeded via migration — the UI
   *       only toggles existing flags, it does not create them. Returns 404 for
   *       everyone except the ops owner.
   *     tags: [Ops]
   *     responses:
   *       200:
   *         description: Array of feature flags
   *       404:
   *         description: Not the ops owner
   */
  router.get('/api/ops/flags', RequireOpsAccess, (req, res) =>
    controller.listFeatureFlags(req, res)
  );

  /**
   * @swagger
   * /api/ops/flags/{key}:
   *   put:
   *     summary: Toggle a runtime feature flag
   *     description: |
   *       Updates value for the given flag key. 400 when the body value is not a
   *       boolean. 404 when the key does not exist — new flags get added via
   *       migration, not from the UI. Returns 404 for everyone except the ops
   *       owner.
   *     tags: [Ops]
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [value]
   *             properties:
   *               value: { type: boolean }
   *     responses:
   *       200:
   *         description: Updated flag row
   *       400:
   *         description: Bad request
   *       404:
   *         description: Not the ops owner, or flag key not found
   */
  router.put('/api/ops/flags/:key', RequireOpsAccess, (req, res) =>
    controller.setFeatureFlag(req, res)
  );

  /**
   * @swagger
   * /api/ops/upload-funnel:
   *   get:
   *     summary: Upload-to-download funnel by stage
   *     description: |
   *       Returns distinct-identity counts for each upload-funnel stage
   *       (upload_started, conversion_succeeded, conversion_failed, deck_downloaded)
   *       keyed by user_id or anonymous_id, plus the true upload-to-download success
   *       rate. `by_origin` repeats the same stages and rates per signup_origin
   *       (attributed from the first_touch cookie), ordered by upload volume, so
   *       leaks can be read per acquisition source. Defaults to the last 30 days;
   *       pass ?window=7d|14d|30d|60d|90d.
   *       Internal endpoint locked to the ops owner — returns 404 for everyone else.
   *     tags: [Ops]
   *     parameters:
   *       - in: query
   *         name: window
   *         schema:
   *           type: string
   *           enum: ['7d', '14d', '30d', '60d', '90d']
   *         description: Lookback window. Defaults to 30d.
   *     responses:
   *       200:
   *         description: Funnel payload
   *       404:
   *         description: Not the ops owner
   */
  router.get('/api/ops/upload-funnel', RequireOpsAccess, (req, res) =>
    controller.getUploadFunnel(req, res)
  );

  /**
   * @swagger
   * /api/ops/cancel-funnel:
   *   get:
   *     summary: Cancel-flow funnel by stage with pause save-rate
   *     description: |
   *       Returns event counts for each cancel-flow stage
   *       (subscription_cancel_started, subscription_pause_offered,
   *       subscription_paused, subscription_cancelled,
   *       subscription_pause_offer_declined), plus the pause save-rate
   *       (paused ÷ pause_offered) and offer-reach (pause_offered ÷ cancel_started).
   *       Defaults to the last 30 days; pass ?window=7d|14d|30d|60d|90d.
   *       Internal endpoint locked to the ops owner — returns 404 for everyone else.
   *     tags: [Ops]
   *     parameters:
   *       - in: query
   *         name: window
   *         schema:
   *           type: string
   *           enum: ['7d', '14d', '30d', '60d', '90d']
   *         description: Lookback window. Defaults to 30d.
   *     responses:
   *       200:
   *         description: Cancel funnel payload
   *       404:
   *         description: Not the ops owner
   */
  router.get('/api/ops/cancel-funnel', RequireOpsAccess, (req, res) =>
    controller.getCancelFunnel(req, res)
  );

  /**
   * @swagger
   * /api/ops/growth/landing-page-yield:
   *   get:
   *     summary: Signups and paid conversions per landing page
   *     description: |
   *       Groups users by signup_origin and reports, per page, the number of
   *       signups in the window, how many became active subscribers, how many
   *       bought a pass, and the deduplicated paid conversion rate. Defaults to
   *       the last 30 days; pass ?window=7d|14d|30d|60d|90d.
   *       Internal endpoint locked to the ops owner — returns 404 for everyone else.
   *     tags: [Ops]
   *     parameters:
   *       - in: query
   *         name: window
   *         schema:
   *           type: string
   *           enum: ['7d', '14d', '30d', '60d', '90d']
   *         description: Lookback window. Defaults to 30d.
   *     responses:
   *       200:
   *         description: Landing page yield payload
   *       404:
   *         description: Not the ops owner
   */
  router.get(
    '/api/ops/growth/landing-page-yield',
    RequireOpsAccess,
    (req, res) => controller.getLandingPageYield(req, res)
  );

  /**
   * @swagger
   * /api/ops/growth/customer-signals:
   *   get:
   *     summary: First-party customer signal aggregated into one ranked list
   *     description: |
   *       Aggregates DB-resident customer signal — cancellation reasons and
   *       comments, deck-ready emoji feedback comments, failed-conversion
   *       reasons, and empty-back card counts — into a single list ranked by
   *       volume. Each row carries a pain-killer / money-multiplier / unknown
   *       bucket, and free-text sources return verbatim sample quotes. No user
   *       identity is joined. Defaults to the last 30 days; pass
   *       ?window=7d|14d|30d|60d|90d. Internal endpoint locked to the ops owner
   *       — returns 404 for everyone else.
   *     tags: [Ops]
   *     parameters:
   *       - in: query
   *         name: window
   *         schema:
   *           type: string
   *           enum: ['7d', '14d', '30d', '60d', '90d']
   *         description: Lookback window. Defaults to 30d.
   *     responses:
   *       200:
   *         description: Customer signals payload
   *       404:
   *         description: Not the ops owner
   */
  router.get('/api/ops/growth/customer-signals', RequireOpsAccess, (req, res) =>
    controller.getCustomerSignals(req, res)
  );

  /**
   * @swagger
   * /api/ops/passes/unlock-monitor:
   *   get:
   *     summary: Completed pass payments reconciled against granted pass rows
   *     description: |
   *       Lists completed Day/Week pass checkout sessions from Stripe (the
   *       source of truth) over a rolling window and asserts each has a matching
   *       pass row — user_passes by payment intent, anonymous_passes by session
   *       id. Sessions younger than the grace window are counted as pending, not
   *       missing, so an in-flight webhook is not flagged. A missing row is a
   *       paid-but-not-unlocked buyer. Defaults to the last 7 days; pass
   *       ?window=1d|7d|14d|30d. Internal endpoint locked to the ops owner —
   *       returns 404 for everyone else.
   *     tags: [Ops]
   *     parameters:
   *       - in: query
   *         name: window
   *         schema:
   *           type: string
   *           enum: ['1d', '7d', '14d', '30d']
   *         description: Lookback window. Defaults to 7d.
   *     responses:
   *       200:
   *         description: Pass unlock reconciliation payload
   *       404:
   *         description: Not the ops owner
   */
  router.get('/api/ops/passes/unlock-monitor', RequireOpsAccess, (req, res) =>
    controller.getPassUnlockMonitor(req, res)
  );

  /**
   * @swagger
   * /api/ops/subscriptions/orphaned:
   *   get:
   *     summary: List active subscriptions with no account receiving premium
   *     description: |
   *       Returns active subscriptions whose paid email, linked email, and Stripe
   *       customer id match no 2anki account, so the payer is not getting premium.
   *       Read-only preview — sends nothing. Internal endpoint locked to the ops
   *       owner — returns 404 for everyone else.
   *     tags: [Ops]
   *     responses:
   *       200:
   *         description: Orphan count and list
   *       404:
   *         description: Not the ops owner
   */
  router.get('/api/ops/subscriptions/orphaned', RequireOpsAccess, (req, res) =>
    controller.getOrphanedSubscriptions(req, res)
  );

  /**
   * @swagger
   * /api/ops/subscriptions/reconcile:
   *   post:
   *     summary: Email orphaned subscribers a recovery path
   *     description: |
   *       Finds active subscriptions with no account receiving premium and emails
   *       each payer how to connect their subscription — register with the paid
   *       email, or link from an existing account. Idempotent: an email address
   *       notified within the last 14 days is skipped. Never auto-creates or
   *       auto-links accounts. Internal endpoint locked to the ops owner — returns
   *       404 for everyone else.
   *     tags: [Ops]
   *     responses:
   *       200:
   *         description: Summary with found, emailed, skippedRecentlyNotified, skippedNoEmail
   *       404:
   *         description: Not the ops owner
   */
  router.post(
    '/api/ops/subscriptions/reconcile',
    RequireOpsAccess,
    (req, res) => controller.reconcileOrphanedSubscriptions(req, res)
  );

  return router;
};

export default OpsRouter;
