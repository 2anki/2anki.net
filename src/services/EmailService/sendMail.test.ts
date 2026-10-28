import { inspect } from 'node:util';
import { vi } from 'vitest';
const send = vi.hoisted(() => vi.fn());

vi.mock('@sendgrid/mail', () => {
  const sgMailMock = { setApiKey: vi.fn(), send };
  return { ...sgMailMock, default: sgMailMock };
});

import { EmailSendError, sendMail, toEmailSendError } from './sendMail';
import { sendWithRetry } from './sendWithRetry';

const MSG = {
  to: 'reader@example.com',
  from: 'a@b.c',
  subject: 's',
  text: 't',
};

function rejection(code: number, reasons: string[]) {
  return Object.assign(new Error('Forbidden'), {
    code,
    response: {
      headers: { 'x-request-id': 'r1' },
      body: { errors: reasons.map((message) => ({ message, field: 'from' })) },
    },
  });
}

describe('sendMail', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('returns what SendGrid returns on success', async () => {
    send.mockResolvedValue([{ statusCode: 202 }, {}]);

    await expect(sendMail(MSG)).resolves.toEqual([{ statusCode: 202 }, {}]);
  });

  it("keeps SendGrid's reason for a rejection", async () => {
    send.mockRejectedValue(
      rejection(403, [
        'The from address does not match a verified Sender Identity.',
      ])
    );

    const error = await sendMail(MSG).catch((e) => e);

    expect(error).toBeInstanceOf(EmailSendError);
    expect(error).toMatchObject({
      code: 403,
      message:
        'Forbidden: The from address does not match a verified Sender Identity.',
    });
    expect(inspect(error, { depth: 20 })).not.toContain('x-request-id');
  });

  it('stops retrying on a permanent rejection', async () => {
    send.mockRejectedValue(rejection(400, ['Bad request']));

    await expect(
      sendWithRetry(() => sendMail(MSG), { sleepFn: async () => {} })
    ).rejects.toMatchObject({ code: 400 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries a rate limit', async () => {
    send
      .mockRejectedValueOnce(rejection(429, []))
      .mockResolvedValue([{ statusCode: 202 }, {}]);

    await sendWithRetry(() => sendMail(MSG), { sleepFn: async () => {} });

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('names a non-Error rejection without its contents', () => {
    expect(toEmailSendError('Bearer SG.secret')).toMatchObject({
      message: 'email send failed',
      code: undefined,
    });
  });
});
