import express from 'express';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';

import { StripeController } from './StripeController';

jest.mock('./extractTokenFromCookies', () => ({
  extractTokenFromCookies: jest.fn(),
}));

jest.mock('../../services/SubscriptionService', () => ({
  getUserActiveSubscriptions: jest.fn(),
}));

jest.mock('../IndexController/getIndexFileContents', () => ({
  getIndexFileContents: jest.fn().mockReturnValue('<html/>'),
}));

import { extractTokenFromCookies } from './extractTokenFromCookies';
import SubscriptionService from '../../services/SubscriptionService';
import type AuthenticationService from '../../services/AuthenticationService';
import type { UserWithOwner } from '../../services/AuthenticationService';
import type UsersService from '../../services/UsersService';
import type { PersistStripeSessionUseCase } from '../../usecases/checkout/PersistStripeSessionUseCase';
import type { IUserPassRepository } from '../../data_layer/UserPassRepository';
import type Subscriptions from '../../data_layer/public/Subscriptions';
import type { SubscriptionsId } from '../../data_layer/public/Subscriptions';
import type { UsersId } from '../../data_layer/public/Users';

type StripeMock = {
  checkout: { sessions: { retrieve: jest.Mock } };
};

const mockedExtractToken = extractTokenFromCookies as jest.MockedFunction<
  typeof extractTokenFromCookies
>;
const mockedGetActiveSubscriptions =
  SubscriptionService.getUserActiveSubscriptions as jest.MockedFunction<
    typeof SubscriptionService.getUserActiveSubscriptions
  >;

function buildUser(overrides: Partial<UserWithOwner> = {}): UserWithOwner {
  return {
    id: 1 as UsersId,
    name: 'Test',
    email: 'test@example.com',
    password: '',
    created_at: null,
    updated_at: null,
    reset_token: null,
    reset_token_expires_at: null,
    reset_token_used_at: null,
    patreon: false,
    ankify_access: false,
    developer_access: false,
    last_login_at: null,
    hosted_anki_requested_at: null,
    signup_origin: null,
    ankify_welcome_seen: false,
    card_options: null,
    theme: null,
    language: null,
    anki_web_acknowledged_at: null,
    onboarded_at: null,
    email_verified: false,
    ai_template_generate_count: 0,
    ai_template_modify_count: 0,
    cards_used_this_month: 0,
    cards_month_started_at: new Date(0),
    pdf_prints_this_month: 0,
    prints_month_started_at: new Date(0),
    signup_country: null,
    chat_consent_at: null,
    stripe_customer_id: null,
    owner: 1,
    ...overrides,
  };
}

function buildSubscription(
  overrides: Partial<Subscriptions> = {}
): Subscriptions {
  return {
    id: 1 as SubscriptionsId,
    email: 'test@example.com',
    active: true,
    payload: {},
    created_at: null,
    updated_at: null,
    linked_email: null,
    stripe_product_id: null,
    ...overrides,
  };
}

type SessionCustomerDetails = NonNullable<
  StripeTypes.Checkout.Session['customer_details']
>;

function buildSession(
  customerEmail: string | null,
  metadataUserId?: string
): Pick<StripeTypes.Checkout.Session, 'customer_details' | 'metadata'> {
  return {
    customer_details:
      customerEmail == null
        ? null
        : ({ email: customerEmail } as SessionCustomerDetails),
    metadata: metadataUserId == null ? null : { user_id: metadataUserId },
  };
}

function mockRequest(
  query: Record<string, string> = {},
  cookies?: string
): express.Request {
  return {
    get: jest.fn().mockReturnValue(cookies || 'token=abc'),
    query,
  } as unknown as express.Request;
}

function mockResponse(): express.Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  } as unknown as express.Response;
}

interface ControllerHarness {
  controller: StripeController;
  authService: { getUserFrom: jest.Mock };
  usersService: { updateSubScriptionEmailUsingPrimaryEmail: jest.Mock };
  persistStripeSessionUseCase: { execute: jest.Mock };
  stripe: StripeMock;
  userPassRepository: { findActive: jest.Mock };
}

function buildController(): ControllerHarness {
  const authService = {
    getUserFrom: jest.fn(),
  };
  const usersService = {
    updateSubScriptionEmailUsingPrimaryEmail: jest.fn(),
  };
  const persistStripeSessionUseCase = {
    execute: jest.fn(),
  };
  const stripe: StripeMock = {
    checkout: { sessions: { retrieve: jest.fn() } },
  };
  const userPassRepository = {
    findActive: jest.fn().mockResolvedValue(null),
  };
  const controller = new StripeController(
    authService as unknown as AuthenticationService,
    usersService as unknown as UsersService,
    persistStripeSessionUseCase as unknown as PersistStripeSessionUseCase,
    stripe as unknown as Pick<StripeTypes, 'checkout'>,
    userPassRepository as unknown as IUserPassRepository
  );
  return {
    controller,
    authService,
    usersService,
    persistStripeSessionUseCase,
    stripe,
    userPassRepository,
  };
}

describe('StripeController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkSubscriptionStatus', () => {
    it('returns hasActiveSubscription true when session_id is provided and the use case reports paid', async () => {
      const h = buildController();
      mockedExtractToken.mockReturnValue('abc');
      h.authService.getUserFrom.mockResolvedValue(buildUser());
      mockedGetActiveSubscriptions.mockResolvedValue([]);
      h.persistStripeSessionUseCase.execute.mockResolvedValue(true);

      const req = mockRequest({ session_id: 'cs_test_123' });
      const res = mockResponse();

      await h.controller.checkSubscriptionStatus(req, res);

      expect(h.persistStripeSessionUseCase.execute).toHaveBeenCalledWith(
        'cs_test_123'
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ hasActiveSubscription: true })
      );
    });

    it('returns hasActiveSubscription true when the user holds an active pass', async () => {
      const h = buildController();
      mockedExtractToken.mockReturnValue('abc');
      h.authService.getUserFrom.mockResolvedValue(
        buildUser({ patreon: false })
      );
      mockedGetActiveSubscriptions.mockResolvedValue([]);
      h.userPassRepository.findActive.mockResolvedValue({
        id: 1,
        user_id: 1,
        kind: 'unlimited',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        stripe_payment_intent_id: 'apple:tx_1',
      });

      const req = mockRequest();
      const res = mockResponse();

      await h.controller.checkSubscriptionStatus(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ hasActiveSubscription: true })
      );
    });

    it('returns hasActiveSubscription true when user has patreon flag', async () => {
      const h = buildController();
      mockedExtractToken.mockReturnValue('abc');
      h.authService.getUserFrom.mockResolvedValue(buildUser({ patreon: true }));
      mockedGetActiveSubscriptions.mockResolvedValue([]);

      const req = mockRequest();
      const res = mockResponse();

      await h.controller.checkSubscriptionStatus(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ hasActiveSubscription: true })
      );
    });

    it('returns hasActiveSubscription true when DB has active subscription', async () => {
      const h = buildController();
      mockedExtractToken.mockReturnValue('abc');
      h.authService.getUserFrom.mockResolvedValue(buildUser());
      mockedGetActiveSubscriptions.mockResolvedValue([buildSubscription()]);

      const req = mockRequest();
      const res = mockResponse();

      await h.controller.checkSubscriptionStatus(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ hasActiveSubscription: true })
      );
    });

    it('returns hasActiveSubscription false when no subscription found anywhere', async () => {
      const h = buildController();
      mockedExtractToken.mockReturnValue('abc');
      h.authService.getUserFrom.mockResolvedValue(buildUser());
      mockedGetActiveSubscriptions.mockResolvedValue([]);

      const req = mockRequest();
      const res = mockResponse();

      await h.controller.checkSubscriptionStatus(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ hasActiveSubscription: false })
      );
    });
  });

  describe('getSuccessfulCheckout', () => {
    function authedUser(h: ControllerHarness, email: string) {
      mockedExtractToken.mockReturnValue('abc');
      h.authService.getUserFrom.mockResolvedValue(buildUser({ email }));
    }

    it('persists the subscription before linking when emails differ', async () => {
      const h = buildController();
      authedUser(h, 'user@2anki.com');
      h.persistStripeSessionUseCase.execute.mockResolvedValue(true);
      h.stripe.checkout.sessions.retrieve.mockResolvedValue(
        buildSession('paypal@email.com', '1')
      );
      h.usersService.updateSubScriptionEmailUsingPrimaryEmail.mockResolvedValue(
        1
      );

      const req = mockRequest({ session_id: 'cs_test_123' });
      const res = mockResponse();

      await h.controller.getSuccessfulCheckout(req, res);

      expect(h.persistStripeSessionUseCase.execute).toHaveBeenCalledWith(
        'cs_test_123'
      );
      expect(
        h.usersService.updateSubScriptionEmailUsingPrimaryEmail
      ).toHaveBeenCalledWith('paypal@email.com', 'user@2anki.com');
    });

    it('does not link when session email matches the logged-in email', async () => {
      const h = buildController();
      authedUser(h, 'user@2anki.com');
      h.persistStripeSessionUseCase.execute.mockResolvedValue(true);
      h.stripe.checkout.sessions.retrieve.mockResolvedValue(
        buildSession('user@2anki.com', '1')
      );

      const req = mockRequest({ session_id: 'cs_test_123' });
      const res = mockResponse();

      await h.controller.getSuccessfulCheckout(req, res);

      expect(
        h.usersService.updateSubScriptionEmailUsingPrimaryEmail
      ).not.toHaveBeenCalled();
    });

    it('does not link when the session does not belong to the logged-in user', async () => {
      const h = buildController();
      authedUser(h, 'attacker@2anki.com');
      h.persistStripeSessionUseCase.execute.mockResolvedValue(true);
      h.stripe.checkout.sessions.retrieve.mockResolvedValue(
        buildSession('victim@email.com', '999')
      );

      const req = mockRequest({ session_id: 'cs_test_leaked' });
      const res = mockResponse();

      await h.controller.getSuccessfulCheckout(req, res);

      expect(
        h.usersService.updateSubScriptionEmailUsingPrimaryEmail
      ).not.toHaveBeenCalled();
      expect(h.persistStripeSessionUseCase.execute).not.toHaveBeenCalled();
    });

    it('does not link when the session was never paid for', async () => {
      const h = buildController();
      authedUser(h, 'user@2anki.com');
      h.persistStripeSessionUseCase.execute.mockResolvedValue(false);
      h.stripe.checkout.sessions.retrieve.mockResolvedValue(
        buildSession('paypal@email.com', '1')
      );

      const req = mockRequest({ session_id: 'cs_test_unpaid' });
      const res = mockResponse();

      await h.controller.getSuccessfulCheckout(req, res);

      expect(
        h.usersService.updateSubScriptionEmailUsingPrimaryEmail
      ).not.toHaveBeenCalled();
    });

    it('serves the page without error when no token present', async () => {
      const h = buildController();
      mockedExtractToken.mockReturnValue(null);

      const req = mockRequest({ session_id: 'cs_test_123' });
      const res = mockResponse();

      await h.controller.getSuccessfulCheckout(req, res);

      expect(res.send).toHaveBeenCalled();
      expect(h.persistStripeSessionUseCase.execute).not.toHaveBeenCalled();
    });
  });
});
