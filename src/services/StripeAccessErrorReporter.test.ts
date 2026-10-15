import { vi, type Mock } from 'vitest';
import { Request, Response } from 'express';
import { makeStripeAccessErrorReporter } from './StripeAccessErrorReporter';
import {
  IErrorEventRepository,
  ErrorEventInsert,
} from '../data_layer/ErrorEventRepository';
import { track } from './events/track';

vi.mock('./events/track', () => ({ track: vi.fn() }));
const trackMock = track as Mock;

const FAKE_KEY = 'rk_live_FAKEKEY0123456789abcdef';

function makeRepository(existsResult = false): IErrorEventRepository & {
  inserts: ErrorEventInsert[];
  existsArgs: unknown[];
} {
  const inserts: ErrorEventInsert[] = [];
  const existsArgs: unknown[] = [];
  return {
    inserts,
    existsArgs,
    async insert(row: ErrorEventInsert) {
      inserts.push(row);
    },
    async existsWithinWindow(
      messageHash: string,
      ipHash: string,
      windowMs: number
    ) {
      existsArgs.push([messageHash, ipHash, windowMs]);
      return existsResult;
    },
    async listGroups() {
      return [];
    },
    async countGroups() {
      return 0;
    },
    async latestSamples() {
      return [];
    },
    async resolveGroup() {},
    async reopenGroup() {},
  };
}

function permissionError(): Error {
  return Object.assign(
    new Error(
      `The provided key '${FAKE_KEY}' does not have the required permissions ` +
        'for this request. Missing permission: customer_portal_write.'
    ),
    { type: 'StripePermissionError', statusCode: 403 }
  );
}

function makeReq(url = '/api/checkout/auto-sync'): Request {
  return { originalUrl: url } as unknown as Request;
}

function makeRes(owner?: number): Response {
  return { locals: { owner } } as unknown as Response;
}

describe('makeStripeAccessErrorReporter', () => {
  beforeEach(() => {
    trackMock.mockReset();
  });

  it('records one sanitized server row for a first occurrence', async () => {
    const repo = makeRepository();
    const sendAlert = vi.fn().mockResolvedValue(undefined);
    const report = makeStripeAccessErrorReporter(repo, 'rel123', { sendAlert });

    await report(permissionError(), makeReq(), makeRes(777));

    expect(repo.inserts).toHaveLength(1);
    const row = repo.inserts[0];
    expect(row.source).toBe('server');
    expect(row.message).toBe('Stripe access denied: StripePermissionError');
    expect(row.stack).toBeNull();
    expect(row.url).toBe('/api/checkout/auto-sync');
    expect(row.release).toBe('rel123');
    expect(row.user_id).toBe(777);
    expect(row.context).toEqual({ stripe_error_type: 'StripePermissionError' });
  });

  it('never stores the raw key or the raw Stripe message in the row', async () => {
    const repo = makeRepository();
    const report = makeStripeAccessErrorReporter(repo, null, {
      sendAlert: vi.fn().mockResolvedValue(undefined),
    });

    await report(permissionError(), makeReq(), makeRes(777));

    const serialized = JSON.stringify(repo.inserts[0]);
    expect(serialized).not.toContain(FAKE_KEY);
    expect(serialized).not.toContain('customer_portal_write');
  });

  it('redacts a Stripe id that appears in the request path', async () => {
    const repo = makeRepository();
    const sendAlert = vi.fn().mockResolvedValue(undefined);
    const report = makeStripeAccessErrorReporter(repo, null, { sendAlert });

    await report(
      permissionError(),
      makeReq('/api/billing/portal?customer=cus_Qx1aBcD2eFgH3i'),
      makeRes(777)
    );

    expect(repo.inserts[0].url).toBe(
      '/api/billing/portal?customer=<stripe_id>'
    );
    const [, body] = sendAlert.mock.calls[0];
    expect(body).not.toContain('cus_Qx1aBcD2eFgH3i');
  });

  it('dedups on the message with a surrogate ip so different callers share it', async () => {
    const repo = makeRepository();
    const report = makeStripeAccessErrorReporter(repo, null, {
      sendAlert: vi.fn().mockResolvedValue(undefined),
      windowMs: 1234,
    });

    await report(
      permissionError(),
      makeReq('/api/checkout/auto-sync'),
      makeRes()
    );

    const [messageHash, ipHash, windowMs] = repo.existsArgs[0] as [
      string,
      string,
      number,
    ];
    expect(windowMs).toBe(1234);
    expect(ipHash).toBe(repo.inserts[0].ip_hash);
    expect(messageHash).toBe(repo.inserts[0].message_hash);
  });

  it('emails ops once on the first occurrence, without the key in the body', async () => {
    const repo = makeRepository();
    const sendAlert = vi.fn().mockResolvedValue(undefined);
    const report = makeStripeAccessErrorReporter(repo, null, { sendAlert });

    await report(permissionError(), makeReq(), makeRes(777));

    expect(sendAlert).toHaveBeenCalledTimes(1);
    const [subject, body] = sendAlert.mock.calls[0];
    expect(subject).toContain('StripePermissionError');
    expect(body).toContain('/api/checkout/auto-sync');
    expect(body).not.toContain(FAKE_KEY);
    expect(trackMock).toHaveBeenCalledWith('stripe_access_alert_sent', {
      userId: 777,
      props: { stripe_error_type: 'StripePermissionError' },
    });
  });

  it('does not record or alert on a repeat within the window', async () => {
    const repo = makeRepository(true);
    const sendAlert = vi.fn().mockResolvedValue(undefined);
    const report = makeStripeAccessErrorReporter(repo, null, { sendAlert });

    await report(permissionError(), makeReq(), makeRes(777));

    expect(repo.inserts).toHaveLength(0);
    expect(sendAlert).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('does not alert when the dedup read fails, and never throws', async () => {
    const repo = makeRepository();
    repo.existsWithinWindow = async () => {
      throw new Error('db down');
    };
    const sendAlert = vi.fn().mockResolvedValue(undefined);
    const report = makeStripeAccessErrorReporter(repo, null, { sendAlert });

    await expect(
      report(permissionError(), makeReq(), makeRes(777))
    ).resolves.toBeUndefined();

    expect(sendAlert).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('does not alert when the row insert fails', async () => {
    const repo = makeRepository();
    repo.insert = async () => {
      throw new Error('db down');
    };
    const sendAlert = vi.fn().mockResolvedValue(undefined);
    const report = makeStripeAccessErrorReporter(repo, null, { sendAlert });

    await expect(
      report(permissionError(), makeReq(), makeRes(777))
    ).resolves.toBeUndefined();

    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('survives a failing alert email', async () => {
    const repo = makeRepository();
    const sendAlert = vi.fn().mockRejectedValue(new Error('sendgrid down'));
    const report = makeStripeAccessErrorReporter(repo, null, { sendAlert });

    await expect(
      report(permissionError(), makeReq(), makeRes(777))
    ).resolves.toBeUndefined();

    expect(repo.inserts).toHaveLength(1);
  });
});
