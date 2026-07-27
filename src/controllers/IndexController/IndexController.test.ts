import type express from 'express';

const mockSendContactEmail = jest.fn().mockResolvedValue({ didSend: true });
const mockSendContactConfirmationEmail = jest.fn().mockResolvedValue(undefined);

jest.mock('../../services/EmailService/EmailService', () => ({
  getDefaultEmailService: () => ({
    sendContactEmail: mockSendContactEmail,
    sendContactConfirmationEmail: mockSendContactConfirmationEmail,
  }),
}));

const mockInsertReturning = jest.fn().mockResolvedValue([{ id: 1 }]);
const mockCount = jest.fn().mockResolvedValue([{ count: 1 }]);

jest.mock('../../data_layer', () => ({
  getDatabase: () => (table: string) => {
    if (table !== 'feedback') throw new Error(`unexpected table ${table}`);
    return {
      insert: () => ({ returning: mockInsertReturning }),
      whereRaw: () => ({
        where: () => ({ count: mockCount }),
      }),
    };
  },
}));

import IndexController from './IndexController';

const VALID_MESSAGE = 'My deck came back empty after converting a Notion page.';

function buildReq(body: Record<string, unknown>): express.Request {
  return { body, files: [] } as unknown as express.Request;
}

function buildRes(): express.Response {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as express.Response;
}

async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('IndexController.contactUs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsertReturning.mockResolvedValue([{ id: 1 }]);
    mockCount.mockResolvedValue([{ count: 1 }]);
    mockSendContactEmail.mockResolvedValue({ didSend: true });
    mockSendContactConfirmationEmail.mockResolvedValue(undefined);
  });

  it('sends a confirmation to the submitter on a valid submission', async () => {
    const controller = new IndexController();
    const res = buildRes();

    await controller.contactUs(
      buildReq({
        name: 'A',
        email: 'user@example.com',
        message: VALID_MESSAGE,
      }),
      res
    );
    await flushAsync();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockSendContactConfirmationEmail).toHaveBeenCalledWith(
      'user@example.com'
    );
  });

  it('skips the confirmation for an invalid email shape but still saves and returns 200', async () => {
    const controller = new IndexController();
    const res = buildRes();

    await controller.contactUs(
      buildReq({ email: 'not-an-email', message: VALID_MESSAGE }),
      res
    );
    await flushAsync();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockInsertReturning).toHaveBeenCalled();
    expect(mockSendContactEmail).toHaveBeenCalled();
    expect(mockSendContactConfirmationEmail).not.toHaveBeenCalled();
  });

  it('skips the confirmation when the same email submitted within the cooldown', async () => {
    mockCount.mockResolvedValue([{ count: 2 }]);
    const controller = new IndexController();
    const res = buildRes();

    await controller.contactUs(
      buildReq({ email: 'user@example.com', message: VALID_MESSAGE }),
      res
    );
    await flushAsync();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockSendContactConfirmationEmail).not.toHaveBeenCalled();
  });

  it('normalizes the recipient and the cooldown key to the same address', async () => {
    const controller = new IndexController();
    const res = buildRes();

    await controller.contactUs(
      buildReq({ email: '  User@Example.COM ', message: VALID_MESSAGE }),
      res
    );
    await flushAsync();

    expect(mockSendContactConfirmationEmail).toHaveBeenCalledWith(
      'user@example.com'
    );
    expect(mockCount).toHaveBeenCalled();
  });

  it('skips the confirmation for an angle-bracket address SendGrid would re-parse', async () => {
    const controller = new IndexController();
    const res = buildRes();

    await controller.contactUs(
      buildReq({ email: 'evil<victim@example.com', message: VALID_MESSAGE }),
      res
    );
    await flushAsync();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockSendContactConfirmationEmail).not.toHaveBeenCalled();
  });

  it('skips the confirmation for a trivial message', async () => {
    const controller = new IndexController();
    const res = buildRes();

    await controller.contactUs(
      buildReq({ email: 'user@example.com', message: 'hi' }),
      res
    );
    await flushAsync();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockSendContactConfirmationEmail).not.toHaveBeenCalled();
  });

  it('still returns 200 and notifies support when the confirmation send fails', async () => {
    mockSendContactConfirmationEmail.mockRejectedValue(
      new Error('sendgrid down')
    );
    const controller = new IndexController();
    const res = buildRes();

    await controller.contactUs(
      buildReq({ email: 'user@example.com', message: VALID_MESSAGE }),
      res
    );
    await flushAsync();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockSendContactEmail).toHaveBeenCalled();
  });

  it('rejects a submission missing email or message with 400', async () => {
    const controller = new IndexController();
    const res = buildRes();

    await controller.contactUs(buildReq({ email: 'user@example.com' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSendContactConfirmationEmail).not.toHaveBeenCalled();
  });
});
