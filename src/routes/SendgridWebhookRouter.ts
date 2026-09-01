import express from 'express';

import { getDatabase } from '../data_layer';
import SuppressionEventsRepository from '../data_layer/SuppressionEventsRepository';
import {
  ProcessSendgridEventsUseCase,
  SendgridEvent,
  SendgridEventProcessingError,
} from '../usecases/email/ProcessSendgridEventsUseCase';
import { verifySendgridEventWebhookSignature } from '../lib/sendgrid/sendgridEventWebhookSignature';

const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

function parseEvents(rawBody: string): SendgridEvent[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  return parsed as SendgridEvent[];
}

const SendgridWebhookRouter = (
  useCase: ProcessSendgridEventsUseCase = new ProcessSendgridEventsUseCase(
    new SuppressionEventsRepository(getDatabase())
  )
) => {
  const router = express.Router();

  router.post(
    '/api/internal/sendgrid/events',
    express.raw({ type: '*/*' }) as express.RequestHandler,
    async (req, res) => {
      const verificationKey =
        process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY;
      if (verificationKey == null || verificationKey.length === 0) {
        res
          .status(500)
          .json({ message: 'event webhook verification key not configured' });
        return;
      }

      const rawBody = (req.body as Buffer).toString('utf8');
      const isVerified = verifySendgridEventWebhookSignature({
        rawBody,
        signature: req.header(SIGNATURE_HEADER) ?? undefined,
        timestamp: req.header(TIMESTAMP_HEADER) ?? undefined,
        publicKeyBase64: verificationKey,
        now: new Date(),
      });
      if (!isVerified) {
        res.status(401).json({ message: 'invalid signature' });
        return;
      }

      const events = parseEvents(rawBody);
      if (events == null) {
        res.status(400).json({ message: 'invalid event payload' });
        return;
      }

      try {
        const summary = await useCase.execute(events);
        console.info('sendgrid.events.processed', summary);
        res.status(200).json({ message: 'accepted' });
      } catch (err) {
        if (err instanceof SendgridEventProcessingError) {
          console.error('sendgrid.events.partial', err.partial);
          res.status(500).json({ message: 'partial processing failure' });
          return;
        }
        throw err;
      }
    }
  );

  return router;
};

export default SendgridWebhookRouter;
