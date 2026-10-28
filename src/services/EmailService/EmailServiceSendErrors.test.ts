import { inspect } from 'node:util';
import { vi } from 'vitest';
const send = vi.hoisted(() => vi.fn());

vi.mock('@sendgrid/mail', () => {
  const sgMailMock = { setApiKey: vi.fn(), send };
  return { ...sgMailMock, default: sgMailMock };
});

import { EmailService } from './EmailService';
import { DEFAULT_SENDER } from './constants';

const API_KEY = 'SG.leaked-key-value';
const RECIPIENT = 'reader@example.com';

function transportError() {
  return Object.assign(new Error('connect ETIMEDOUT 203.0.113.7:443'), {
    code: 'ETIMEDOUT',
    config: {
      headers: { Authorization: `Bearer ${API_KEY}` },
      data: JSON.stringify({
        personalizations: [{ to: [{ email: RECIPIENT }] }],
      }),
    },
  });
}

function rendered(value: unknown): string {
  return inspect(value, { depth: 20 });
}

describe('EmailService send failures', () => {
  let errorLog: ReturnType<typeof vi.spyOn>;
  let service: EmailService;

  beforeEach(() => {
    vi.clearAllMocks();
    send.mockRejectedValue(transportError());
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    service = new EmailService('test-key', DEFAULT_SENDER);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ['password reset', () => service.sendResetEmail(RECIPIENT, 'tok')],
    ['magic link', () => service.sendMagicLinkEmail(RECIPIENT, 'tok', 'login')],
    [
      'inactivity warning',
      () => service.sendInactivityWarningEmail(RECIPIENT, 'tok'),
    ],
    [
      'resuming soon',
      () =>
        service.sendSubscriptionResumingSoonEmail(
          RECIPIENT,
          new Date('2026-11-01T00:00:00Z'),
          '$7.99'
        ),
    ],
    [
      'AI spend alert',
      () => service.sendAiSpendAlertEmail(RECIPIENT, 'Spend alert', 'body'),
    ],
    ['Notion reconnect', () => service.sendNotionReconnectEmail(RECIPIENT)],
    [
      'deck ready',
      () => service.sendConversionEmail(RECIPIENT, 'deck', Buffer.from('apkg')),
    ],
  ])(
    'rethrows a %s failure with only its code and message',
    async (_label, sendEmail) => {
      const error = await Promise.resolve(sendEmail()).catch((e) => e);

      expect(error).toMatchObject({
        code: 'ETIMEDOUT',
        message: 'connect ETIMEDOUT 203.0.113.7:443',
      });
      expect(rendered(error)).not.toContain(API_KEY);
      expect(rendered(error)).not.toContain(RECIPIENT);
    }
  );

  it('never logs the API key, the request body or the recipient', async () => {
    await service.sendResetEmail(RECIPIENT, 'tok').catch(() => undefined);
    await service
      .sendInactivityWarningEmail(RECIPIENT, 'tok')
      .catch(() => undefined);
    await service
      .sendPassEndingEmail(RECIPIENT, 'tok', 'Week Pass')
      .catch(() => undefined);

    expect(errorLog).toHaveBeenCalledTimes(3);
    const logged = rendered(errorLog.mock.calls);
    expect(logged).toContain('ETIMEDOUT');
    expect(logged).not.toContain(API_KEY);
    expect(logged).not.toContain('personalizations');
    expect(logged).not.toContain(RECIPIENT);
  });

  it('returns an Auto Sync access request failure without the API key', async () => {
    const result = await service.sendHostedAnkiAccessRequestEmail(
      '42',
      RECIPIENT
    );

    expect(result.didSend).toBe(false);
    expect(result.error).toMatchObject({ code: 'ETIMEDOUT' });
    expect(rendered(result)).not.toContain(API_KEY);
    expect(rendered(errorLog.mock.calls)).not.toContain(API_KEY);
  });

  it('still retries a transient failure, since the code survives', async () => {
    vi.useFakeTimers();
    send.mockReset();
    send
      .mockRejectedValueOnce(transportError())
      .mockResolvedValue([{ statusCode: 202 }, {}]);

    const pending = service.sendContactEmail('Reader', RECIPIENT, 'hi', []);
    await vi.runAllTimersAsync();

    expect(await pending).toEqual({ didSend: true });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
