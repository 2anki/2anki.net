import express from 'express';

import { AnkifyClientsRepository } from '../data_layer/ankify/AnkifyClientsRepository';
import { AnkifyNotionSubscriptionsRepository } from '../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import { AnkifySyncMappingsRepository } from '../data_layer/ankify/AnkifySyncMappingsRepository';
import { AnkifySyncConflictsRepository } from '../data_layer/ankify/AnkifySyncConflictsRepository';
import { AnkifySyncLogsRepository } from '../data_layer/ankify/AnkifySyncLogsRepository';
import NotionRepository from '../data_layer/NotionRespository';
import { getDatabase } from '../data_layer';
import { ankiConnectFactory } from '../services/ankify/buildAnkiConnectClient';
import { notionBlockChildrenFetcherFactory } from '../services/ankify/notionBlockChildrenFetcher';
import { SyncNotionPageToRacUseCase } from '../usecases/ankify/SyncNotionPageToRacUseCase';
import { verifyNotionWebhookSignature } from '../lib/ankify/notionWebhookSignature';
import { hasAnkifyAccess } from '../lib/ankify/access';
import UsersRepository from '../data_layer/UsersRepository';
import SubscriptionService from '../services/SubscriptionService';
import { getDefaultEmailService } from '../services/EmailService/EmailService';
import { MarkNotionTokenInvalidUseCase } from '../usecases/notion/MarkNotionTokenInvalidUseCase';
import { makeAnkifyTemplateOverridesProvider } from '../services/ankify/templateOverrides';
import SettingsRepository from '../data_layer/SettingsRepository';
import { UnsupportedNotionBlockRepository } from '../data_layer/UnsupportedNotionBlockRepository';

const AnkifyWebhookRouter = () => {
  const router = express.Router();
  const db = getDatabase();
  const subscriptions = new AnkifyNotionSubscriptionsRepository(db);
  const clients = new AnkifyClientsRepository(db);
  const mappings = new AnkifySyncMappingsRepository(db);
  const conflicts = new AnkifySyncConflictsRepository(db);
  const logs = new AnkifySyncLogsRepository(db);
  const notionRepo = new NotionRepository(db);
  const usersRepo = new UsersRepository(db);

  const useCase = new SyncNotionPageToRacUseCase(
    clients,
    mappings,
    conflicts,
    subscriptions,
    logs,
    notionRepo,
    ankiConnectFactory,
    notionBlockChildrenFetcherFactory,
    undefined,
    undefined,
    (owner: number) =>
      new MarkNotionTokenInvalidUseCase(
        notionRepo,
        usersRepo,
        getDefaultEmailService()
      ).execute(owner, 'ankify'),
    makeAnkifyTemplateOverridesProvider(new SettingsRepository(db)),
    undefined,
    new UnsupportedNotionBlockRepository(db)
  );

  router.post(
    '/api/ankify/webhook/notion',
    express.raw({ type: 'application/json' }) as express.RequestHandler,
    async (req, res) => {
      const secret = process.env.NOTION_WEBHOOK_SECRET;
      if (secret == null || secret.length === 0) {
        res.status(500).json({ message: 'webhook secret not configured' });
        return;
      }

      const signature = req.header('x-notion-signature') ?? undefined;
      const rawBody = (req.body as Buffer).toString('utf8');
      if (!verifyNotionWebhookSignature(rawBody, signature, secret)) {
        res.status(401).json({ message: 'invalid signature' });
        return;
      }

      let payload: {
        page_id?: string;
        type?: string;
        entity?: { id?: string };
      };
      try {
        payload = JSON.parse(rawBody);
      } catch {
        res.status(400).json({ message: 'invalid JSON' });
        return;
      }

      const pageId = payload.page_id ?? payload.entity?.id;
      if (pageId == null) {
        res.status(200).json({ message: 'no actionable page_id' });
        return;
      }

      res.status(202).json({ message: 'accepted' });

      try {
        const matching = await subscriptions.findByPageId(pageId);
        for (const sub of matching) {
          const user = await usersRepo.getById(sub.owner.toString());
          const userSubs = user?.email
            ? await SubscriptionService.getUserActiveSubscriptions(user.email)
            : [];
          if (
            !hasAnkifyAccess(
              user,
              userSubs,
              process.env.AUTO_SYNC_PRODUCT_ID ?? ''
            )
          ) {
            continue;
          }
          useCase
            .execute({
              owner: sub.owner,
              notionPageId: sub.notion_page_id,
              trigger: 'webhook',
            })
            .catch((error) => {
              console.error(
                `[ankify-webhook] sync failed for ${sub.notion_page_id}`,
                error
              );
            });
        }
      } catch (error) {
        console.error('[ankify-webhook] failed to dispatch sync', error);
      }
    }
  );

  return router;
};

export default AnkifyWebhookRouter;
