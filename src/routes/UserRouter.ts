import crypto from 'node:crypto';
import express from 'express';

import RequireAuthentication, {
  OptionalAuthentication,
} from './middleware/RequireAuthentication';
import UsersController from '../controllers/UsersControllers';
import SubscriptionLifecycleController from '../controllers/SubscriptionLifecycleController';
import { EmailPreferencesController } from '../controllers/EmailPreferencesController';
import { UserPreferencesController } from '../controllers/UserPreferencesController';
import UsersRepository from '../data_layer/UsersRepository';
import TokenRepository from '../data_layer/TokenRepository';
import EmailPreferencesRepository from '../data_layer/EmailPreferencesRepository';
import UserPreferencesRepository from '../data_layer/UserPreferencesRepository';
import AuthenticationService from '../services/AuthenticationService';
import { getDatabase } from '../data_layer';
import UsersService from '../services/UsersService';
import { getDefaultEmailService } from '../services/EmailService/EmailService';
import { MagicTokenRepository } from '../data_layer/MagicTokenRepository';
import { UserVisibleErrorsRepository } from '../data_layer/UserVisibleErrorsRepository';
import { RecordUserVisibleErrorUseCase } from '../usecases/observability/RecordUserVisibleErrorUseCase';

const UserRouter = () => {
  const router = express.Router();
  const database = getDatabase();
  const authService = new AuthenticationService(
    new TokenRepository(database),
    new UsersRepository(database)
  );

  const emailService = getDefaultEmailService();
  const magicTokenRepository = new MagicTokenRepository(database);
  const recordErrorUseCase = new RecordUserVisibleErrorUseCase(
    new UserVisibleErrorsRepository(database)
  );
  const usersService = new UsersService(
    new UsersRepository(database),
    emailService,
    magicTokenRepository
  );
  const controller = new UsersController(
    usersService,
    authService,
    database,
    recordErrorUseCase,
    emailService
  );
  const subscriptionController = new SubscriptionLifecycleController(
    usersService,
    database
  );
  const emailPreferencesController = new EmailPreferencesController(
    new EmailPreferencesRepository(database)
  );
  const userPreferencesController = new UserPreferencesController(
    new UserPreferencesRepository(database)
  );

  // No authentication required for new password since user has reset token
  /**
   * @swagger
   * /api/users/new-password:
   *   post:
   *     summary: Set new password
   *     description: Set a new password using a reset token received via email
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - token
   *               - password
   *             properties:
   *               token:
   *                 type: string
   *                 description: Reset token from email
   *               password:
   *                 type: string
   *                 minLength: 8
   *                 description: New password (minimum 8 characters)
   *     responses:
   *       200:
   *         description: Password updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Success'
   *       400:
   *         description: Invalid token or password
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post('/api/users/new-password', (req, res, next) =>
    controller.newPassword(req, res, next)
  );

  // Forgot password triggers email with reset token
  /**
   * @swagger
   * /api/users/forgot-password:
   *   post:
   *     summary: Request password reset
   *     description: Send a password reset email to the user
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 description: User email address
   *     responses:
   *       200:
   *         description: Password reset email sent
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Success'
   *       404:
   *         description: Email not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post('/api/users/forgot-password', (req, res, next) =>
    controller.forgotPassword(req, res, next)
  );

  /**
   * @swagger
   * /api/users/magic-link:
   *   post:
   *     summary: Request a magic login link
   *     description: Sends a magic link email for passwordless login or password reset. Always returns 200 to prevent email enumeration.
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [email]
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *               purpose:
   *                 type: string
   *                 enum: [login, password_reset]
   *                 default: login
   *     responses:
   *       200:
   *         description: Magic link sent (or silently ignored if email not found)
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Success'
   *       429:
   *         description: Too many requests
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post('/api/users/magic-link', (req, res, next) =>
    controller.requestMagicLink(req, res, next)
  );

  /**
   * @swagger
   * /api/users/magic/{token}:
   *   get:
   *     summary: Verify a magic link token
   *     description: Validates a magic link token and creates a session for login, or returns token info for password reset.
   *     tags: [Authentication]
   *     parameters:
   *       - in: path
   *         name: token
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Token valid — session created (login) or reset info returned (password_reset)
   *       400:
   *         description: Token invalid or expired
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get('/api/users/magic/:token', (req, res, next) =>
    controller.verifyMagicLink(req, res, next)
  );

  /**
   * @swagger
   * /api/users/verify/{token}:
   *   get:
   *     summary: Honor in-flight email verification links
   *     description: Kept alive for verify_email tokens issued before email verification was removed. New signups no longer receive these.
   *     tags: [Authentication]
   *     parameters:
   *       - in: path
   *         name: token
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       302:
   *         description: Redirects to /login?verified=1 (or /account?verified=1 if signed in) on success; same paths with verify_error=expired on failure
   */
  router.get('/api/users/verify/:token', (req, res, next) =>
    controller.verifyEmail(req, res, next)
  );

  /**
   * @swagger
   * /api/users/logout:
   *   post:
   *     summary: Logout user
   *     description: Logout the authenticated user and invalidate session
   *     tags: [Authentication]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Logged out successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Success'
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post('/api/users/logout', RequireAuthentication, (req, res, next) =>
    controller.logOut(req, res, next)
  );

  /**
   * @swagger
   * /api/users/logout-everywhere:
   *   post:
   *     summary: Revoke every session for the authenticated user
   *     description: Deletes all access tokens owned by the signed-in user, including the current session. Derives the owner from the session, never from the request body.
   *     tags: [Authentication]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: All sessions revoked
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Success'
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post(
    '/api/users/logout-everywhere',
    RequireAuthentication,
    (req, res, next) => controller.logOutEverywhere(req, res, next)
  );

  /**
   * @swagger
   * /api/users/login:
   *   post:
   *     summary: Login user
   *     description: Authenticate user with email and password
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - password
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 description: User email address
   *               password:
   *                 type: string
   *                 description: User password
   *     responses:
   *       200:
   *         description: Login successful
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 token:
   *                   type: string
   *                   description: JWT authentication token
   *                 user:
   *                   $ref: '#/components/schemas/User'
   *       401:
   *         description: Invalid credentials
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post('/api/users/login', (req, res, next) =>
    controller.login(req, res, next)
  );

  /**
   * @swagger
   * /api/users/register:
   *   post:
   *     summary: Register new user
   *     description: Create a new user account
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - password
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 description: User email address
   *               password:
   *                 type: string
   *                 minLength: 8
   *                 description: User password (minimum 8 characters)
   *               name:
   *                 type: string
   *                 description: User's full name
   *     responses:
   *       201:
   *         description: User registered successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 token:
   *                   type: string
   *                   description: JWT authentication token
   *                 user:
   *                   $ref: '#/components/schemas/User'
   *       400:
   *         description: Email already exists or invalid input
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post('/api/users/register', (req, res, next) =>
    controller.register(req, res, next)
  );

  /**
   * @swagger
   * /api/users/r/{id}:
   *   get:
   *     summary: Password reset redirect
   *     description: Handle password reset token and redirect to reset page
   *     tags: [Authentication]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Password reset token ID
   *     responses:
   *       302:
   *         description: Redirect to password reset page
   *       400:
   *         description: Invalid or expired token
   *         content:
   *           text/html:
   *             schema:
   *               type: string
   *               description: Error page
   */
  router.get('/api/users/r/:id', (req, res, next) =>
    controller.resetPassword(req, res, next)
  );

  /**
   * @swagger
   * /api/users/delete-account:
   *   post:
   *     summary: Delete user account
   *     description: Permanently delete the authenticated user's account and all associated data
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Account deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Success'
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post('/api/users/delete-account', RequireAuthentication, (req, res) =>
    controller.deleteAccount(req, res)
  );

  /**
   * @swagger
   * /api/users/email-change/request:
   *   post:
   *     summary: Request an account email change
   *     description: Re-authenticates with the current password, mails a confirmation link to the new address, and notifies the old address. The change applies only when the link is confirmed.
   *     tags: [Users]
   *     security:
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Confirmation link sent to the new address
   *       400:
   *         description: Invalid or unchanged email
   *       401:
   *         description: Authentication required or wrong password
   *       403:
   *         description: OAuth-only account must set a password first
   *       409:
   *         description: Email already in use
   *       429:
   *         description: Too many attempts
   */
  router.post(
    '/api/users/email-change/request',
    RequireAuthentication,
    (req, res) => controller.requestEmailChange(req, res)
  );

  /**
   * @swagger
   * /api/users/email-change/confirm:
   *   post:
   *     summary: Confirm an account email change
   *     description: Applies the pending email change identified by the emailed token. Token-authenticated, so it works from the new inbox on any device; every session is revoked on success.
   *     tags: [Users]
   *     responses:
   *       200:
   *         description: Email updated
   *       400:
   *         description: Invalid or expired token
   *       409:
   *         description: Email now in use by another account
   */
  router.post('/api/users/email-change/confirm', (req, res) =>
    controller.confirmEmailChange(req, res)
  );

  /**
   * @swagger
   * /api/users/email-change/cancel:
   *   post:
   *     summary: Cancel a pending account email change
   *     description: Deletes any live pending email-change token for the authenticated account.
   *     tags: [Users]
   *     security:
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Pending change cancelled (if one existed)
   *       401:
   *         description: Authentication required
   */
  router.post(
    '/api/users/email-change/cancel',
    RequireAuthentication,
    (req, res) => controller.cancelEmailChange(req, res)
  );

  router.post(
    '/api/users/request-hosted-anki-access',
    RequireAuthentication,
    (req, res) => controller.requestHostedAnkiAccess(req, res)
  );

  /**
   * @swagger
   * /api/users/cancel-subscription:
   *   post:
   *     summary: Cancel user subscription
   *     description: Cancel the authenticated user's active subscription without deleting the account
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Subscription cancelled successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Success'
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: User or active subscription not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post(
    '/api/users/cancel-subscription',
    RequireAuthentication,
    (req, res) => subscriptionController.cancelSubscription(req, res)
  );

  /**
   * @swagger
   * /api/users/subscriptions/{id}/cancel:
   *   post:
   *     summary: "Cancel one Stripe subscription by id"
   *     description: "Cancels a single subscription the caller owns. The id must resolve to one of the caller's Stripe subscriptions; otherwise the request is rejected with 403."
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: "Stripe subscription id"
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               mode:
   *                 type: string
   *                 enum: [immediate, period_end]
   *                 default: immediate
   *     responses:
   *       200:
   *         description: "Subscription cancelled"
   *       400:
   *         description: "A subscription id is required"
   *       401:
   *         description: "Authentication required"
   *       403:
   *         description: "Subscription not found for this account"
   *       404:
   *         description: "User not found"
   */
  router.post(
    '/api/users/subscriptions/:id/cancel',
    RequireAuthentication,
    (req, res) => subscriptionController.cancelSubscriptionById(req, res)
  );

  /**
   * @swagger
   * /api/users/cancellation-feedback:
   *   post:
   *     summary: Record why a user cancelled
   *     description: Stores an optional cancellation reason and comment after the subscription has already been cancelled. Never blocks the cancel itself.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Feedback recorded
   *       400:
   *         description: A reason is required
   *       401:
   *         description: Authentication required
   */
  router.post(
    '/api/users/cancellation-feedback',
    RequireAuthentication,
    (req, res) => subscriptionController.submitCancellationFeedback(req, res)
  );

  /**
   * @swagger
   * /api/users/pause-subscription:
   *   post:
   *     summary: Pause a monthly subscription for 1-3 months
   *     description: Pauses billing with Stripe pause_collection behavior void. Rejects annual plans and subscriptions younger than 30 days. Paid features are off while paused; the subscription auto-resumes on the resume date.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               months:
   *                 type: integer
   *                 enum: [1, 2, 3]
   *     responses:
   *       200:
   *         description: Subscription paused
   *       400:
   *         description: Invalid pause length
   *       401:
   *         description: Authentication required
   *       422:
   *         description: Plan not eligible for pausing
   */
  router.post(
    '/api/users/pause-subscription',
    RequireAuthentication,
    (req, res) => subscriptionController.pauseSubscription(req, res)
  );

  /**
   * @swagger
   * /api/users/resume-subscription:
   *   post:
   *     summary: Resume a paused subscription immediately
   *     description: Clears the Stripe pause_collection so billing and paid features resume right away.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Subscription resumed
   *       401:
   *         description: Authentication required
   *       422:
   *         description: No paused subscription found
   */
  router.post(
    '/api/users/resume-subscription',
    RequireAuthentication,
    (req, res) => subscriptionController.resumeSubscription(req, res)
  );

  /**
   * @swagger
   * /api/users/subscription-status:
   *   get:
   *     summary: Get live subscription status from Stripe
   *     description: Returns active subscriptions for the authenticated user, fetched directly from Stripe
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Subscription status retrieved
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 subscriptions:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       status:
   *                         type: string
   *                       cancel_at_period_end:
   *                         type: boolean
   *                       current_period_end:
   *                         type: integer
   *                         nullable: true
   *       401:
   *         description: Authentication required
   */
  router.get(
    '/api/users/subscription-status',
    RequireAuthentication,
    (req, res) => subscriptionController.getSubscriptionStatus(req, res)
  );

  /**
   * @swagger
   * /api/users/usage:
   *   get:
   *     summary: Get monthly card usage for the current user
   *     description: Returns cards used this month, the monthly limit, and whether the user is on an unlimited plan
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Current usage retrieved
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 cards_used:
   *                   type: integer
   *                 cards_limit:
   *                   type: integer
   *                 unlimited:
   *                   type: boolean
   *       401:
   *         description: Authentication required
   */
  router.get('/api/users/usage', RequireAuthentication, (req, res) =>
    controller.getCardUsage(req, res)
  );

  /**
   * @swagger
   * /api/users/debug/locals:
   *   get:
   *     summary: Get debug information
   *     description: Get debugging information about the current user session (development only)
   *     tags: [Debug]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Debug information retrieved
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               additionalProperties: true
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get('/api/users/debug/locals', OptionalAuthentication, (req, res) =>
    controller.getLocals(req, res)
  );

  router.post(
    '/api/users/debug/ankify-welcome-seen',
    RequireAuthentication,
    (req, res) => controller.markAnkifyWelcomeSeen(req, res)
  );

  /**
   * @swagger
   * /login:
   *   get:
   *     summary: Check user authentication
   *     description: Check if user is authenticated and return user information
   *     tags: [Authentication]
   *     responses:
   *       200:
   *         description: User information or authentication status
   *         content:
   *           application/json:
   *             schema:
   *               oneOf:
   *                 - $ref: '#/components/schemas/User'
   *                 - type: object
   *                   properties:
   *                     authenticated:
   *                       type: boolean
   *                       example: false
   */
  router.get('/login', (req, res) => controller.checkUser(req, res));

  /**
   * @swagger
   * /patr*on:
   *   get:
   *     summary: Patreon integration
   *     description: Handle Patreon authentication callback and redirects (supports /patreon)
   *     tags: [Authentication]
   *     responses:
   *       302:
   *         description: Redirect after Patreon authentication
   *       200:
   *         description: Patreon integration page
   *         content:
   *           text/html:
   *             schema:
   *               type: string
   */
  router.get('/patr*on', (req, res) => controller.patreon(req, res));

  /**
   * @swagger
   * /api/users/auth/google:
   *   get:
   *     summary: Google OAuth authentication
   *     description: Initiate Google OAuth authentication flow
   *     tags: [Authentication]
   *     responses:
   *       302:
   *         description: Redirect to Google OAuth
   */
  router.get('/api/users/auth/google', (req, res) =>
    controller.loginWithGoogle(req, res)
  );

  /**
   * @swagger
   * /api/users/auth/microsoft:
   *   get:
   *     summary: Microsoft OAuth authentication
   *     description: Microsoft OAuth callback. Exchanges the authorization code for an id_token, verifies it against Microsoft's JWKS, then signs the user in (creating an account if needed).
   *     tags: [Authentication]
   *     responses:
   *       302:
   *         description: Redirect to the post-login destination
   */
  router.get('/api/users/auth/microsoft', (req, res) =>
    controller.loginWithMicrosoft(req, res)
  );

  /**
   * @swagger
   * /api/users/auth/apple/init:
   *   get:
   *     summary: Initiate Apple OAuth login
   *     description: Sets a CSRF state cookie (sameSite=none; Secure) and redirects to Apple's authorization page.
   *     tags: [Authentication]
   *     responses:
   *       302:
   *         description: Redirect to Apple OAuth
   */
  router.get('/api/users/auth/apple/init', (req, res) => {
    const clientId = process.env.APPLE_CLIENT_ID;
    const redirectUri = `${process.env.DOMAIN ?? 'https://2anki.net'}/auth/apple/callback`;
    if (!clientId) {
      return res.redirect('/login');
    }
    const state = crypto.randomBytes(32).toString('hex');
    res.cookie('apple_login_state', state, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      maxAge: 300_000,
    });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code id_token',
      response_mode: 'form_post',
      scope: 'name email',
      state,
    });
    return res.redirect(
      `https://appleid.apple.com/auth/authorize?${params.toString()}`
    );
  });

  /**
   * @swagger
   * /auth/apple/callback:
   *   post:
   *     summary: Apple OAuth callback
   *     description: form_post callback from Apple. Verifies state, exchanges code for id_token, signs the user in.
   *     tags: [Authentication]
   *     responses:
   *       302:
   *         description: Redirect to home on success or /login on failure
   */
  router.post(
    '/auth/apple/callback',
    express.urlencoded({ extended: false }),
    (req, res) => controller.loginWithApple(req, res)
  );

  /**
   * @swagger
   * /auth/apple/native:
   *   post:
   *     summary: Apple Sign In from native iOS/macOS clients
   *     description: Accepts an Apple identity token from a native ASAuthorizationController flow, verifies it against Apple's JWKS using the App ID audience (APPLE_NATIVE_CLIENT_ID), and issues a session cookie. Does not use the web OAuth code flow.
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [identityToken]
   *             properties:
   *               identityToken:
   *                 type: string
   *               email:
   *                 type: string
   *               fullName:
   *                 type: object
   *                 properties:
   *                   givenName:
   *                     type: string
   *                   familyName:
   *                     type: string
   *     responses:
   *       200:
   *         description: Signed in — token cookie set
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok:
   *                   type: boolean
   *       400:
   *         description: Missing identity token
   *       401:
   *         description: Token verification failed or email required for new account
   */
  router.post('/auth/apple/native', express.json(), (req, res) =>
    controller.loginWithAppleNative(req, res)
  );

  /**
   * @swagger
   * /api/users/auth/notion/init:
   *   get:
   *     summary: Initiate Notion OAuth login
   *     description: Redirects to Notion OAuth authorization page. Sets a short-lived nonce cookie to prevent account fixation.
   *     tags: [Authentication]
   *     responses:
   *       302:
   *         description: Redirect to Notion OAuth
   */
  router.get('/api/users/auth/notion/init', (req, res) => {
    const clientId = process.env.NOTION_CLIENT_ID;
    const redirectUri = process.env.NOTION_REDIRECT_URI;
    if (!clientId || !redirectUri) {
      return res.redirect('/login?error=notion_cancelled');
    }
    const nonce = crypto.randomBytes(16).toString('hex');
    res.cookie('notion_login_state', nonce, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 300_000,
    });
    const state = `login:${nonce}`;
    const url = `https://api.notion.com/v1/oauth/authorize?owner=user&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${encodeURIComponent(state)}`;
    return res.redirect(url);
  });

  /**
   * @swagger
   * /api/users/auth/notion:
   *   get:
   *     summary: Notion OAuth callback
   *     description: Exchanges the Notion OAuth code for a session. Upserts the user by email, mints a JWT, and saves the Notion workspace token.
   *     tags: [Authentication]
   *     parameters:
   *       - in: query
   *         name: code
   *         required: true
   *         schema:
   *           type: string
   *         description: Authorization code from Notion OAuth
   *     responses:
   *       302:
   *         description: Redirect to home on success, or /login?error=notion_cancelled on failure
   */
  router.get('/api/users/auth/notion', (req, res) =>
    controller.loginWithNotion(req, res)
  );

  router.get(
    '/api/users/email-preferences',
    RequireAuthentication,
    (req, res) => emailPreferencesController.get(req, res)
  );

  router.patch(
    '/api/users/email-preferences',
    RequireAuthentication,
    (req, res) => emailPreferencesController.update(req, res)
  );

  /**
   * @swagger
   * /api/users/me/preferences:
   *   get:
   *     summary: Get the signed-in user's preferences
   *     description: Returns the user's stored card options, theme, and AnkiWeb acknowledgement timestamp.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: The user's preferences
   *       401:
   *         description: Not authenticated
   */
  router.get('/api/users/me/preferences', RequireAuthentication, (req, res) =>
    userPreferencesController.get(req, res)
  );

  /**
   * @swagger
   * /api/users/me/preferences:
   *   patch:
   *     summary: Update the signed-in user's preferences
   *     description: Updates any of card options, theme, or the AnkiWeb acknowledgement timestamp.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               cardOptions:
   *                 type: object
   *               theme:
   *                 type: string
   *               ankiWebAcknowledgedAt:
   *                 type: string
   *                 format: date-time
   *     responses:
   *       200:
   *         description: The updated preferences
   *       400:
   *         description: Invalid preference value
   *       401:
   *         description: Not authenticated
   */
  router.patch('/api/users/me/preferences', RequireAuthentication, (req, res) =>
    userPreferencesController.patch(req, res)
  );

  router.post(
    '/api/users/me/preferences/migrate',
    RequireAuthentication,
    (req, res) => userPreferencesController.migrate(req, res)
  );

  router.delete(
    '/api/users/me/preferences/card-options',
    RequireAuthentication,
    (req, res) => userPreferencesController.deleteCardOptions(req, res)
  );

  /**
   * @swagger
   * /api/users/me/onboarded:
   *   patch:
   *     summary: Mark the signed-in user as onboarded
   *     description: Records that the user has completed the onboarding flow.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Onboarding state recorded
   *       401:
   *         description: Not authenticated
   */
  router.patch('/api/users/me/onboarded', RequireAuthentication, (req, res) =>
    controller.markOnboarded(req, res)
  );

  return router;
};

export default UserRouter;
