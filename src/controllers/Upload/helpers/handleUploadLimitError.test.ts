import { vi, type MockedClass, type MockedFunction } from 'vitest';
import express from 'express';

vi.mock('../../../data_layer', () => ({
  getDatabase: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../services/EmailService/EmailService', () => ({
  getDefaultEmailService: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../data_layer/UsersRepository');
vi.mock('../../../services/UsersService');

vi.mock('../../../lib/integrations/stripe', () => ({
  getStripe: vi.fn().mockReturnValue({
    customers: { retrieve: vi.fn() },
  }),
  updateStoreSubscription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../services/SubscriptionService', () => ({
  __esModule: true,
  default: {
    findActiveStripeSubscriptions: vi.fn(),
  },
}));

import { handleUploadLimitError } from './handleUploadLimitError';
import UsersService from '../../../services/UsersService';
import SubscriptionService from '../../../services/SubscriptionService';
import {
  getStripe,
  updateStoreSubscription,
} from '../../../lib/integrations/stripe';

const mockedFindActive =
  SubscriptionService.findActiveStripeSubscriptions as MockedFunction<
    typeof SubscriptionService.findActiveStripeSubscriptions
  >;
const mockedUpdateStoreSubscription = updateStoreSubscription as MockedFunction<
  typeof updateStoreSubscription
>;
const mockedStripe = getStripe() as any;

function mockResponse(owner?: string): express.Response {
  return {
    locals: { owner },
    redirect: vi.fn(),
  } as unknown as express.Response;
}

function mockRequest(): express.Request {
  return {} as express.Request;
}

describe('handleUploadLimitError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects unauthenticated users to /limit with file_size kind by default', async () => {
    const res = mockResponse(undefined);
    await handleUploadLimitError(mockRequest(), res);
    expect(res.redirect).toHaveBeenCalledWith('/limit?kind=file_size');
  });

  it('redirects with card_count kind when error message matches', async () => {
    const res = mockResponse(undefined);
    await handleUploadLimitError(
      mockRequest(),
      res,
      new Error('You can only add 100 cards')
    );
    expect(res.redirect).toHaveBeenCalledWith('/limit?kind=card_count');
  });

  it('redirects authenticated users with no Stripe subscription to /limit?kind=file_size', async () => {
    (UsersService as MockedClass<typeof UsersService>).prototype.getUserById =
      vi.fn().mockResolvedValue({ id: '1', email: 'user@example.com' });
    mockedFindActive.mockResolvedValue([]);

    const res = mockResponse('owner-1');
    await handleUploadLimitError(
      mockRequest(),
      res,
      new Error('File too large')
    );

    expect(res.redirect).toHaveBeenCalledWith('/limit?kind=file_size');
  });

  it('redirects authenticated users with card_count error to /limit?kind=card_count', async () => {
    (UsersService as MockedClass<typeof UsersService>).prototype.getUserById =
      vi.fn().mockResolvedValue({ id: '1', email: 'user@example.com' });
    mockedFindActive.mockResolvedValue([]);

    const res = mockResponse('owner-1');
    await handleUploadLimitError(
      mockRequest(),
      res,
      new Error('You can only add 100 cards')
    );

    expect(res.redirect).toHaveBeenCalledWith('/limit?kind=card_count');
  });

  it('syncs subscription and redirects to upload when active Stripe sub exists but is missing from DB', async () => {
    (UsersService as MockedClass<typeof UsersService>).prototype.getUserById =
      vi.fn().mockResolvedValue({ id: '1', email: 'user@example.com' });
    const fakeSub = {
      id: 'sub_123',
      customer: 'cus_123',
      status: 'active',
    } as any;
    mockedFindActive.mockResolvedValue([fakeSub]);
    mockedStripe.customers.retrieve.mockResolvedValue({
      id: 'cus_123',
      email: 'user@example.com',
    });

    const res = mockResponse('owner-1');
    await handleUploadLimitError(mockRequest(), res);

    expect(mockedUpdateStoreSubscription).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/upload');
  });

  it('falls back to /limit?kind=file_size when Stripe call throws', async () => {
    (UsersService as MockedClass<typeof UsersService>).prototype.getUserById =
      vi.fn().mockResolvedValue({ id: '1', email: 'user@example.com' });
    mockedFindActive.mockRejectedValue(new Error('Stripe unavailable'));

    const res = mockResponse('owner-1');
    await handleUploadLimitError(mockRequest(), res);

    expect(res.redirect).toHaveBeenCalledWith('/limit?kind=file_size');
  });
});
