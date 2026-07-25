import express from 'express';

import { GetOpsMetricsUseCase } from '../usecases/ops/GetOpsMetricsUseCase';
import { GetBusinessMetricsUseCase } from '../usecases/ops/GetBusinessMetricsUseCase';
import { GetConversionMetricsUseCase } from '../usecases/ops/GetConversionMetricsUseCase';
import { GetPerformanceMetricsUseCase } from '../usecases/ops/GetPerformanceMetricsUseCase';
import { GetReturnRateMetricsUseCase } from '../usecases/ops/GetReturnRateMetricsUseCase';
import { GetMindmapStorageMetricsUseCase } from '../usecases/ops/GetMindmapStorageMetricsUseCase';
import { PopulateShowcaseUseCase } from '../usecases/ops/PopulateShowcaseUseCase';
import { SendInactivityWarningsUseCase } from '../usecases/ops/SendInactivityWarningsUseCase';
import { SendPassWinbackUseCase } from '../usecases/ops/SendPassWinbackUseCase';
import { DeleteInactiveUsersUseCase } from '../usecases/ops/DeleteInactiveUsersUseCase';
import { IShowcaseRepository } from '../data_layer/ShowcaseRepository';
import { SyncStripeSubscriptionsUseCase } from '../usecases/ops/SyncStripeSubscriptionsUseCase';
import { ListFeatureFlagsUseCase } from '../usecases/ops/ListFeatureFlagsUseCase';
import {
  FeatureFlagNotFoundError,
  SetFeatureFlagUseCase,
} from '../usecases/ops/SetFeatureFlagUseCase';
import { GetUploadFunnelUseCase } from '../usecases/ops/GetUploadFunnelUseCase';
import { GetCancelFunnelUseCase } from '../usecases/ops/GetCancelFunnelUseCase';
import { GetOrphanedSubscriptionsUseCase } from '../usecases/ops/GetOrphanedSubscriptionsUseCase';
import { ReconcileOrphanedSubscriptionsUseCase } from '../usecases/ops/ReconcileOrphanedSubscriptionsUseCase';
import { GetLandingPageYieldUseCase } from '../usecases/ops/GetLandingPageYieldUseCase';
import { GetCustomerSignalsUseCase } from '../usecases/ops/GetCustomerSignalsUseCase';
import { GetPassUnlockMonitorUseCase } from '../usecases/ops/GetPassUnlockMonitorUseCase';
import GrantDeveloperAccessUseCase, {
  InvalidEmailError,
} from '../usecases/developer/GrantDeveloperAccessUseCase';

class OpsController {
  constructor(
    private readonly getOpsMetrics: GetOpsMetricsUseCase,
    private readonly getBusinessMetricsUseCase?: GetBusinessMetricsUseCase,
    private readonly getConversionMetricsUseCase?: GetConversionMetricsUseCase,
    private readonly populateShowcaseUseCase?: PopulateShowcaseUseCase,
    private readonly showcaseRepo?: IShowcaseRepository,
    private readonly sendInactivityWarningsUseCase?: SendInactivityWarningsUseCase,
    private readonly getPerformanceMetricsUseCase?: GetPerformanceMetricsUseCase,
    private readonly getReturnRateMetricsUseCase?: GetReturnRateMetricsUseCase,
    private readonly getMindmapStorageMetricsUseCase?: GetMindmapStorageMetricsUseCase,
    private readonly deleteInactiveUsersUseCase?: DeleteInactiveUsersUseCase,
    private readonly syncStripeSubscriptionsUseCase?: SyncStripeSubscriptionsUseCase,
    private readonly listFeatureFlagsUseCase?: ListFeatureFlagsUseCase,
    private readonly setFeatureFlagUseCase?: SetFeatureFlagUseCase,
    private readonly getUploadFunnelUseCase?: GetUploadFunnelUseCase,
    private readonly getOrphanedSubscriptionsUseCase?: GetOrphanedSubscriptionsUseCase,
    private readonly reconcileOrphanedSubscriptionsUseCase?: ReconcileOrphanedSubscriptionsUseCase,
    private readonly getLandingPageYieldUseCase?: GetLandingPageYieldUseCase,
    private readonly getCustomerSignalsUseCase?: GetCustomerSignalsUseCase,
    private readonly getPassUnlockMonitorUseCase?: GetPassUnlockMonitorUseCase,
    private readonly sendPassWinbackUseCase?: SendPassWinbackUseCase,
    private readonly grantDeveloperAccessUseCase?: GrantDeveloperAccessUseCase,
    private readonly getCancelFunnelUseCase?: GetCancelFunnelUseCase
  ) {}

  async grantDeveloperAccess(req: express.Request, res: express.Response) {
    if (this.grantDeveloperAccessUseCase == null) {
      res
        .status(500)
        .json({ message: 'Developer access grant not configured' });
      return;
    }
    const { email, grant } = req.body as { email?: unknown; grant?: unknown };
    try {
      const result = await this.grantDeveloperAccessUseCase.execute(
        email,
        grant !== false
      );
      if (result.updated === 0) {
        res.status(404).json({ message: 'No account found for that email' });
        return;
      }
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof InvalidEmailError) {
        res.status(400).json({ message: error.message });
        return;
      }
      console.error('[ops] grantDeveloperAccess failed', error);
      res.status(500).json({ message: 'Failed to update developer access' });
    }
  }

  async getMetrics(req: express.Request, res: express.Response) {
    try {
      const window = req.query.window;
      const result = await this.getOpsMetrics.execute(window);
      res.status(200).json(result);
    } catch (error) {
      console.error('[ops] getMetrics failed', error);
      res.status(500).json({ message: 'Failed to load ops metrics' });
    }
  }

  async getBusinessMetrics(_req: express.Request, res: express.Response) {
    if (this.getBusinessMetricsUseCase == null) {
      res.status(500).json({ message: 'Business metrics not configured' });
      return;
    }
    try {
      const result = await this.getBusinessMetricsUseCase.execute();
      res.set('Cache-Control', 'private, max-age=86400');
      res.status(200).json(result);
    } catch (error) {
      console.error('[ops] getBusinessMetrics failed', error);
      res.status(500).json({ message: 'Failed to load business metrics' });
    }
  }

  async getConversionMetrics(_req: express.Request, res: express.Response) {
    if (this.getConversionMetricsUseCase == null) {
      res.status(500).json({ message: 'Conversion metrics not configured' });
      return;
    }
    try {
      const result = await this.getConversionMetricsUseCase.execute();
      res.status(200).json(result);
    } catch (error) {
      console.error('[ops] getConversionMetrics failed', error);
      res.status(500).json({ message: 'Failed to load conversion metrics' });
    }
  }
  async populateShowcase(req: express.Request, res: express.Response) {
    if (this.populateShowcaseUseCase == null) {
      res.status(500).json({ message: 'Showcase not configured' });
      return;
    }
    try {
      const { pageId, apkgKey } = req.body;
      if (typeof pageId !== 'string' || pageId.trim().length === 0) {
        res.status(400).json({ message: 'pageId is required' });
        return;
      }
      if (typeof apkgKey !== 'string' || apkgKey.trim().length === 0) {
        res.status(400).json({ message: 'apkgKey is required' });
        return;
      }
      await this.populateShowcaseUseCase.execute(
        res.locals.owner,
        pageId.trim(),
        apkgKey.trim()
      );
      res.status(200).json({ message: 'Showcase populated.' });
    } catch (error) {
      console.error('[ops] populateShowcase failed', error);
      res.status(500).json({ message: 'Failed to populate showcase.' });
    }
  }

  async purgeShowcase(_req: express.Request, res: express.Response) {
    if (this.showcaseRepo == null) {
      res.status(500).json({ message: 'Showcase not configured' });
      return;
    }
    try {
      await this.showcaseRepo.purge();
      res.status(200).json({ message: 'Showcase purged.' });
    } catch (error) {
      console.error('[ops] purgeShowcase failed', error);
      res.status(500).json({ message: 'Failed to purge showcase.' });
    }
  }

  async getPerformanceMetrics(_req: express.Request, res: express.Response) {
    if (this.getPerformanceMetricsUseCase == null) {
      res.status(500).json({ message: 'Performance metrics not configured' });
      return;
    }
    try {
      const result = await this.getPerformanceMetricsUseCase.execute();
      res.status(200).json(result);
    } catch (error) {
      console.error('[ops] getPerformanceMetrics failed', error);
      res.status(500).json({ message: 'Failed to load performance metrics' });
    }
  }

  async sendInactivityWarnings(req: express.Request, res: express.Response) {
    if (this.sendInactivityWarningsUseCase == null) {
      res.status(500).json({ message: 'Inactivity warnings not configured' });
      return;
    }
    try {
      const dryRun = req.query.dryRun !== 'false';
      const result = await this.sendInactivityWarningsUseCase.execute(dryRun);
      res.status(200).json(result);
    } catch (error) {
      console.error('[ops] sendInactivityWarnings failed', error);
      res.status(500).json({ message: 'Failed to run inactivity warnings' });
    }
  }

  async sendPassWinback(req: express.Request, res: express.Response) {
    if (this.sendPassWinbackUseCase == null) {
      res.status(500).json({ message: 'Pass win-back not configured' });
      return;
    }
    const campaign =
      typeof req.query.campaign === 'string' ? req.query.campaign.trim() : '';
    if (campaign.length === 0) {
      res.status(400).json({ message: 'campaign is required' });
      return;
    }
    try {
      const dryRun = req.query.dryRun !== 'false';
      const result = await this.sendPassWinbackUseCase.execute(
        campaign,
        dryRun
      );
      res.status(200).json(result);
    } catch (error) {
      console.error('[ops] sendPassWinback failed', error);
      res.status(500).json({ message: 'Failed to run pass win-back' });
    }
  }

  async deleteInactiveUsers(req: express.Request, res: express.Response) {
    if (this.deleteInactiveUsersUseCase == null) {
      res
        .status(500)
        .json({ message: 'Inactive user deletion not configured' });
      return;
    }
    try {
      const dryRun = req.query.dryRun !== 'false';
      const result = await this.deleteInactiveUsersUseCase.execute(dryRun);
      res.status(200).json(result);
    } catch (error) {
      console.error('[ops] deleteInactiveUsers failed', error);
      res.status(500).json({ message: 'Failed to run inactive user deletion' });
    }
  }

  async syncStripeSubscriptions(_req: express.Request, res: express.Response) {
    if (this.syncStripeSubscriptionsUseCase == null) {
      res
        .status(500)
        .json({ message: 'Stripe subscription sync not configured' });
      return;
    }
    try {
      const result = this.syncStripeSubscriptionsUseCase.execute();
      if (result.alreadyRunning) {
        res
          .status(409)
          .json({ message: 'A Stripe subscription sync is already running.' });
        return;
      }
      res.status(202).json({
        message:
          'Stripe subscription sync started. It runs in the background — check the server logs for the result.',
      });
    } catch (error) {
      console.error('[ops] syncStripeSubscriptions failed', error);
      res
        .status(500)
        .json({ message: 'Failed to start Stripe subscription sync' });
    }
  }

  async getReturnRateMetrics(_req: express.Request, res: express.Response) {
    if (this.getReturnRateMetricsUseCase == null) {
      res.status(500).json({ message: 'Return-rate metrics not configured' });
      return;
    }
    try {
      const result = await this.getReturnRateMetricsUseCase.execute();
      res.status(200).json(result);
    } catch (error) {
      console.error('[ops] getReturnRateMetrics failed', error);
      res.status(500).json({ message: 'Failed to load return-rate metrics' });
    }
  }

  async getMindmapStorageMetrics(_req: express.Request, res: express.Response) {
    if (this.getMindmapStorageMetricsUseCase == null) {
      res
        .status(500)
        .json({ message: 'Mindmap storage metrics not configured' });
      return;
    }
    try {
      const result = await this.getMindmapStorageMetricsUseCase.execute();
      res.status(200).json(result);
    } catch (error) {
      console.error('[ops] getMindmapStorageMetrics failed', error);
      res
        .status(500)
        .json({ message: 'Failed to load mindmap storage metrics' });
    }
  }

  async listFeatureFlags(_req: express.Request, res: express.Response) {
    if (this.listFeatureFlagsUseCase == null) {
      res.status(500).json({ message: 'Feature flags not configured' });
      return;
    }
    try {
      const rows = await this.listFeatureFlagsUseCase.execute();
      res.status(200).json(
        rows.map((row) => ({
          key: row.key,
          value: row.value,
          description: row.description,
          updated_at: row.updated_at,
          updated_by_email: row.updated_by_email,
        }))
      );
    } catch (error) {
      console.error('[ops] listFeatureFlags failed', error);
      res.status(500).json({ message: 'Failed to load feature flags' });
    }
  }

  async setFeatureFlag(req: express.Request, res: express.Response) {
    if (this.setFeatureFlagUseCase == null) {
      res.status(500).json({ message: 'Feature flags not configured' });
      return;
    }
    const key = req.params.key;
    if (typeof key !== 'string' || key.length === 0) {
      res.status(400).json({ message: 'key is required' });
      return;
    }
    const body = req.body as { value?: unknown };
    if (typeof body?.value !== 'boolean') {
      res.status(400).json({ message: 'value must be a boolean' });
      return;
    }
    const userId = res.locals.owner;
    if (typeof userId !== 'number') {
      res.status(500).json({ message: 'Authenticated user id missing' });
      return;
    }
    try {
      const updated = await this.setFeatureFlagUseCase.execute({
        key,
        value: body.value,
        userId,
      });
      res.status(200).json({
        key: updated.key,
        value: updated.value,
        description: updated.description,
        updated_at: updated.updated_at,
        updated_by_email: updated.updated_by_email,
      });
    } catch (error) {
      if (error instanceof FeatureFlagNotFoundError) {
        res.status(404).json({ message: `Flag not found: ${key}` });
        return;
      }
      console.error('[ops] setFeatureFlag failed', error);
      res.status(500).json({ message: 'Failed to update feature flag' });
    }
  }

  async getUploadFunnel(req: express.Request, res: express.Response) {
    if (this.getUploadFunnelUseCase == null) {
      res.status(500).json({ message: 'Upload funnel not configured' });
      return;
    }
    try {
      const window =
        typeof req.query.window === 'string' ? req.query.window : undefined;
      const result = await this.getUploadFunnelUseCase.execute(window);
      res.status(200).json(result);
    } catch (error) {
      console.error('[ops] getUploadFunnel failed', error);
      res.status(500).json({ message: 'Failed to load upload funnel' });
    }
  }

  async getCancelFunnel(req: express.Request, res: express.Response) {
    if (this.getCancelFunnelUseCase == null) {
      res.status(500).json({ message: 'Cancel funnel not configured' });
      return;
    }
    try {
      const window =
        typeof req.query.window === 'string' ? req.query.window : undefined;
      const result = await this.getCancelFunnelUseCase.execute(window);
      res.status(200).json(result);
    } catch (error) {
      console.error('[ops] getCancelFunnel failed', error);
      res.status(500).json({ message: 'Failed to load cancel funnel' });
    }
  }

  async getLandingPageYield(req: express.Request, res: express.Response) {
    if (this.getLandingPageYieldUseCase == null) {
      res.status(503).json({ message: 'Landing page yield not configured' });
      return;
    }
    try {
      const window =
        typeof req.query.window === 'string' ? req.query.window : undefined;
      const result = await this.getLandingPageYieldUseCase.execute(window);
      res.status(200).json(result);
    } catch (error) {
      console.error('[ops] getLandingPageYield failed', error);
      res.status(500).json({ message: 'Failed to load landing page yield' });
    }
  }

  async getCustomerSignals(req: express.Request, res: express.Response) {
    if (this.getCustomerSignalsUseCase == null) {
      res.status(503).json({ message: 'Customer signals not configured' });
      return;
    }
    try {
      const window =
        typeof req.query.window === 'string' ? req.query.window : undefined;
      const result = await this.getCustomerSignalsUseCase.execute(window);
      res.status(200).json(result);
    } catch (error) {
      console.error('[ops] getCustomerSignals failed', error);
      res.status(500).json({ message: 'Failed to load customer signals' });
    }
  }

  async getPassUnlockMonitor(req: express.Request, res: express.Response) {
    if (this.getPassUnlockMonitorUseCase == null) {
      res.status(503).json({ message: 'Pass unlock monitor not configured' });
      return;
    }
    try {
      const window =
        typeof req.query.window === 'string' ? req.query.window : undefined;
      const result = await this.getPassUnlockMonitorUseCase.execute(window);
      res.status(200).json(result);
    } catch (error) {
      console.error('[ops] getPassUnlockMonitor failed', error);
      res.status(500).json({ message: 'Failed to load pass unlock monitor' });
    }
  }

  async getOrphanedSubscriptions(_req: express.Request, res: express.Response) {
    if (this.getOrphanedSubscriptionsUseCase == null) {
      res
        .status(500)
        .json({ message: 'Orphaned subscriptions not configured' });
      return;
    }
    try {
      const orphans = await this.getOrphanedSubscriptionsUseCase.execute();
      res.status(200).json({
        count: orphans.length,
        orphans: orphans.map((orphan) => ({
          id: orphan.id,
          email: orphan.email,
          stripeProductId: orphan.stripeProductId,
          createdAt:
            orphan.createdAt == null ? null : orphan.createdAt.toISOString(),
          customerId: orphan.customerId,
        })),
      });
    } catch (error) {
      console.error('[ops] getOrphanedSubscriptions failed', error);
      res
        .status(500)
        .json({ message: 'Failed to load orphaned subscriptions' });
    }
  }

  async reconcileOrphanedSubscriptions(
    _req: express.Request,
    res: express.Response
  ) {
    if (this.reconcileOrphanedSubscriptionsUseCase == null) {
      res
        .status(500)
        .json({ message: 'Orphaned subscription reconcile not configured' });
      return;
    }
    try {
      const result = await this.reconcileOrphanedSubscriptionsUseCase.execute();
      res.status(200).json({
        found: result.found,
        emailed: result.emailed,
        skippedRecentlyNotified: result.skippedRecentlyNotified,
        skippedNoEmail: result.skippedNoEmail,
      });
    } catch (error) {
      console.error('[ops] reconcileOrphanedSubscriptions failed', error);
      res
        .status(500)
        .json({ message: 'Failed to reconcile orphaned subscriptions' });
    }
  }
}

export default OpsController;
