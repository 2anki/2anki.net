import { vi } from 'vitest';
import { Request, Response } from 'express';

const emailService = vi.hoisted(() => ({
  sendOpsAlertEmail: vi.fn().mockResolvedValue(undefined),
  sendAiSpendAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./EmailService/EmailService', () => ({
  getDefaultEmailService: () => emailService,
}));
vi.mock('./events/track', () => ({ track: vi.fn() }));

import { makeStripeAccessErrorReporter } from './StripeAccessErrorReporter';
import { SUPPORT_CC_ADDRESS } from '../lib/constants';
import { IErrorEventRepository } from '../data_layer/ErrorEventRepository';

const repo: IErrorEventRepository = {
  insert: async () => undefined,
  existsWithinWindow: async () => false,
} as unknown as IErrorEventRepository;

describe('makeStripeAccessErrorReporter default sender', () => {
  it('emails ops as a stripe-access ops alert, not an AI spend alert', async () => {
    const report = makeStripeAccessErrorReporter(repo, null);

    await report(
      Object.assign(new Error('denied'), {
        type: 'StripePermissionError',
        statusCode: 403,
      }),
      { originalUrl: '/api/checkout/auto-sync' } as unknown as Request,
      { locals: {} } as unknown as Response
    );

    expect(emailService.sendOpsAlertEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendOpsAlertEmail.mock.calls[0].slice(0, 2)).toEqual([
      'stripe-access',
      SUPPORT_CC_ADDRESS,
    ]);
    expect(emailService.sendAiSpendAlertEmail).not.toHaveBeenCalled();
  });
});
