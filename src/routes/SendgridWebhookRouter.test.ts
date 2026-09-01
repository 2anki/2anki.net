import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  InMemorySuppressionEventsRepository,
  ISuppressionEventsRepository,
  RecordSuppressionEvent,
} from '../data_layer/SuppressionEventsRepository';
import { emailHash } from '../lib/emailHash';
import { ProcessSendgridEventsUseCase } from '../usecases/email/ProcessSendgridEventsUseCase';
import SendgridWebhookRouter from './SendgridWebhookRouter';

const ENDPOINT = '/api/internal/sendgrid/events';

function makeKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const publicKeyBase64 = publicKey
    .export({ type: 'spki', format: 'der' })
    .toString('base64');
  return { publicKeyBase64, privateKey };
}

function sign(
  privateKey: crypto.KeyObject,
  timestamp: string,
  payload: string
) {
  return crypto
    .sign('sha256', Buffer.from(timestamp + payload, 'utf8'), {
      key: privateKey,
      dsaEncoding: 'der',
    })
    .toString('base64');
}

async function buildServer(repo: ISuppressionEventsRepository) {
  const useCase = new ProcessSendgridEventsUseCase(repo);
  const app = express();
  app.use(SendgridWebhookRouter(useCase));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe(`POST ${ENDPOINT}`, () => {
  const originalKey = process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY;
  let keyPair: ReturnType<typeof makeKeyPair>;
  let repo: InMemorySuppressionEventsRepository;
  let server: http.Server;
  let url: string;

  beforeEach(async () => {
    keyPair = makeKeyPair();
    process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY =
      keyPair.publicKeyBase64;
    repo = new InMemorySuppressionEventsRepository();
    ({ server, url } = await buildServer(repo));
  });

  afterEach(() => {
    server.close();
    if (originalKey === undefined) {
      delete process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY;
    } else {
      process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY = originalKey;
    }
  });

  function freshTimestamp(): string {
    return String(Math.floor(Date.now() / 1000));
  }

  it('processes events when the signature is valid', async () => {
    const timestamp = freshTimestamp();
    const payload = JSON.stringify([
      {
        email: 'bounced@example.com',
        event: 'bounce',
        sg_event_id: 'evt-1',
        timestamp: Number(timestamp),
      },
    ]);
    const signature = sign(keyPair.privateKey, timestamp, payload);

    const res = await fetch(`${url}${ENDPOINT}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Twilio-Email-Event-Webhook-Signature': signature,
        'X-Twilio-Email-Event-Webhook-Timestamp': timestamp,
      },
      body: payload,
    });

    expect(res.status).toBe(200);
    expect(await repo.isSuppressed(emailHash('bounced@example.com'))).toBe(
      true
    );
  });

  it('returns 401 and changes no state when the signature is invalid', async () => {
    const timestamp = freshTimestamp();
    const payload = JSON.stringify([
      {
        email: 'bounced@example.com',
        event: 'bounce',
        sg_event_id: 'evt-1',
        timestamp: Number(timestamp),
      },
    ]);

    const res = await fetch(`${url}${ENDPOINT}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Twilio-Email-Event-Webhook-Signature': 'AAAA',
        'X-Twilio-Email-Event-Webhook-Timestamp': timestamp,
      },
      body: payload,
    });

    expect(res.status).toBe(401);
    expect(await repo.isSuppressed(emailHash('bounced@example.com'))).toBe(
      false
    );
  });

  it('returns 401 when the signature header is missing', async () => {
    const timestamp = freshTimestamp();
    const payload = JSON.stringify([
      { email: 'a@example.com', event: 'bounce', sg_event_id: 'evt-1' },
    ]);

    const res = await fetch(`${url}${ENDPOINT}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Twilio-Email-Event-Webhook-Timestamp': timestamp,
      },
      body: payload,
    });

    expect(res.status).toBe(401);
  });

  it('returns 401 when the signature was made over a different body (replay with new payload)', async () => {
    const timestamp = freshTimestamp();
    const signedPayload = JSON.stringify([
      { email: 'a@example.com', event: 'bounce', sg_event_id: 'evt-a' },
    ]);
    const signature = sign(keyPair.privateKey, timestamp, signedPayload);
    const attackerPayload = JSON.stringify([
      { email: 'victim@example.com', event: 'bounce', sg_event_id: 'evt-b' },
    ]);

    const res = await fetch(`${url}${ENDPOINT}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Twilio-Email-Event-Webhook-Signature': signature,
        'X-Twilio-Email-Event-Webhook-Timestamp': timestamp,
      },
      body: attackerPayload,
    });

    expect(res.status).toBe(401);
    expect(await repo.isSuppressed(emailHash('victim@example.com'))).toBe(
      false
    );
  });

  it('returns 401 when the timestamp is stale (replay of an old delivery)', async () => {
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 60 * 60);
    const payload = JSON.stringify([
      { email: 'a@example.com', event: 'bounce', sg_event_id: 'evt-1' },
    ]);
    const signature = sign(keyPair.privateKey, staleTimestamp, payload);

    const res = await fetch(`${url}${ENDPOINT}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Twilio-Email-Event-Webhook-Signature': signature,
        'X-Twilio-Email-Event-Webhook-Timestamp': staleTimestamp,
      },
      body: payload,
    });

    expect(res.status).toBe(401);
  });

  it('returns 400 when the body is malformed after a valid signature', async () => {
    const timestamp = freshTimestamp();
    const payload = 'this is not json';
    const signature = sign(keyPair.privateKey, timestamp, payload);

    const res = await fetch(`${url}${ENDPOINT}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Twilio-Email-Event-Webhook-Signature': signature,
        'X-Twilio-Email-Event-Webhook-Timestamp': timestamp,
      },
      body: payload,
    });

    expect(res.status).toBe(400);
  });

  it('returns 500 and logs the partial result when recording fails mid-batch', async () => {
    class FailAfterFirstRepository implements ISuppressionEventsRepository {
      readonly recorded: RecordSuppressionEvent[] = [];
      async record(input: RecordSuppressionEvent): Promise<void> {
        if (this.recorded.length >= 1) {
          throw new Error('database unavailable');
        }
        this.recorded.push(input);
      }
      async isSuppressed(): Promise<boolean> {
        return false;
      }
    }
    const failingRepo = new FailAfterFirstRepository();
    const failing = await buildServer(failingRepo);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const timestamp = freshTimestamp();
      const payload = JSON.stringify([
        {
          email: 'a@example.com',
          event: 'bounce',
          sg_event_id: 'evt-a',
          timestamp: Number(timestamp),
        },
        {
          email: 'b@example.com',
          event: 'bounce',
          sg_event_id: 'evt-b',
          timestamp: Number(timestamp),
        },
      ]);
      const signature = sign(keyPair.privateKey, timestamp, payload);

      const res = await fetch(`${failing.url}${ENDPOINT}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Twilio-Email-Event-Webhook-Signature': signature,
          'X-Twilio-Email-Event-Webhook-Timestamp': timestamp,
        },
        body: payload,
      });

      expect(res.status).toBe(500);
      expect(failingRepo.recorded).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalledWith(
        'sendgrid.events.partial',
        expect.objectContaining({ recorded: 1 })
      );
    } finally {
      errorSpy.mockRestore();
      failing.server.close();
    }
  });

  it('returns 500 when the verification key is not configured', async () => {
    delete process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY;
    const timestamp = freshTimestamp();
    const payload = JSON.stringify([]);
    const signature = sign(keyPair.privateKey, timestamp, payload);

    const res = await fetch(`${url}${ENDPOINT}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Twilio-Email-Event-Webhook-Signature': signature,
        'X-Twilio-Email-Event-Webhook-Timestamp': timestamp,
      },
      body: payload,
    });

    expect(res.status).toBe(500);
  });
});
