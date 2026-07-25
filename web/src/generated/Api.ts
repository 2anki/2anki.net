/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */

import {
  ChatBasicCard,
  ChatDoneFrame,
  ChatErrorFrame,
  ChatMcqCard,
  ChatTokenFrame,
  Error,
  NotionDatabase,
  NotionPage,
  NotionSearchResults,
  Success,
  Upload,
  User,
} from "./data-contracts";
import { ContentType, HttpClient, RequestParams } from "./http-client";

export class Api<
  SecurityDataType = unknown,
> extends HttpClient<SecurityDataType> {
  /**
   * @description Check if the authenticated user has an active subscription
   *
   * @tags Payments
   * @name StripeSubscriptionStatusList
   * @summary Check user subscription status
   * @request GET:/api/stripe/subscription-status
   * @secure
   */
  stripeSubscriptionStatusList = (params: RequestParams = {}) =>
    this.request<
      {
        authenticated?: boolean;
        hasActiveSubscription?: boolean;
        user?: {
          email?: string;
          name?: string;
          patreon?: boolean;
        };
      },
      void
    >({
      path: `/api/stripe/subscription-status`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Returns the running package version and the git SHA the process was built from. Used by the deploy workflow to verify that the new code is actually running (not a stale process).
   *
   * @tags System
   * @name VersionList
   * @summary Get API version information
   * @request GET:/api/version
   * @secure
   */
  versionList = (params: RequestParams = {}) =>
    this.request<
      {
        /** @example "2.0.0" */
        version?: string;
        /**
         * Git SHA (full 40-char) the build was created from, or "unknown" if GIT_SHA is unset in the runtime env.
         * @example "9be7cb9bbcd7..."
         */
        sha?: string;
      },
      any
    >({
      path: `/api/version`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Set a new password using a reset token received via email
   *
   * @tags Authentication
   * @name UsersNewPasswordCreate
   * @summary Set new password
   * @request POST:/api/users/new-password
   * @secure
   */
  usersNewPasswordCreate = (
    data: {
      /** Reset token from email */
      token: string;
      /**
       * New password (minimum 8 characters)
       * @minLength 8
       */
      password: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<Success, Error>({
      path: `/api/users/new-password`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Send a password reset email to the user
   *
   * @tags Authentication
   * @name UsersForgotPasswordCreate
   * @summary Request password reset
   * @request POST:/api/users/forgot-password
   * @secure
   */
  usersForgotPasswordCreate = (
    data: {
      /**
       * User email address
       * @format email
       */
      email: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<Success, Error>({
      path: `/api/users/forgot-password`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Sends a magic link email for passwordless login or password reset. Always returns 200 to prevent email enumeration.
   *
   * @tags Authentication
   * @name UsersMagicLinkCreate
   * @summary Request a magic login link
   * @request POST:/api/users/magic-link
   * @secure
   */
  usersMagicLinkCreate = (
    data: {
      /** @format email */
      email: string;
      /** @default "login" */
      purpose?: "login" | "password_reset";
    },
    params: RequestParams = {},
  ) =>
    this.request<Success, Error>({
      path: `/api/users/magic-link`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Validates a magic link token and creates a session for login, or returns token info for password reset.
   *
   * @tags Authentication
   * @name UsersMagicDetail
   * @summary Verify a magic link token
   * @request GET:/api/users/magic/{token}
   * @secure
   */
  usersMagicDetail = (token: string, params: RequestParams = {}) =>
    this.request<void, Error>({
      path: `/api/users/magic/${token}`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Kept alive for verify_email tokens issued before email verification was removed. New signups no longer receive these.
   *
   * @tags Authentication
   * @name UsersVerifyDetail
   * @summary Honor in-flight email verification links
   * @request GET:/api/users/verify/{token}
   * @secure
   */
  usersVerifyDetail = (token: string, params: RequestParams = {}) =>
    this.request<any, void>({
      path: `/api/users/verify/${token}`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Logout the authenticated user and invalidate session
   *
   * @tags Authentication
   * @name UsersLogoutCreate
   * @summary Logout user
   * @request POST:/api/users/logout
   * @secure
   */
  usersLogoutCreate = (params: RequestParams = {}) =>
    this.request<Success, Error>({
      path: `/api/users/logout`,
      method: "POST",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Deletes all access tokens owned by the signed-in user, including the current session. Derives the owner from the session, never from the request body.
   *
   * @tags Authentication
   * @name UsersLogoutEverywhereCreate
   * @summary Revoke every session for the authenticated user
   * @request POST:/api/users/logout-everywhere
   * @secure
   */
  usersLogoutEverywhereCreate = (params: RequestParams = {}) =>
    this.request<Success, Error>({
      path: `/api/users/logout-everywhere`,
      method: "POST",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Authenticate user with email and password
   *
   * @tags Authentication
   * @name UsersLoginCreate
   * @summary Login user
   * @request POST:/api/users/login
   * @secure
   */
  usersLoginCreate = (
    data: {
      /**
       * User email address
       * @format email
       */
      email: string;
      /** User password */
      password: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      {
        /** JWT authentication token */
        token?: string;
        user?: User;
      },
      Error
    >({
      path: `/api/users/login`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Create a new user account
   *
   * @tags Authentication
   * @name UsersRegisterCreate
   * @summary Register new user
   * @request POST:/api/users/register
   * @secure
   */
  usersRegisterCreate = (
    data: {
      /**
       * User email address
       * @format email
       */
      email: string;
      /**
       * User password (minimum 8 characters)
       * @minLength 8
       */
      password: string;
      /** User's full name */
      name?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      {
        /** JWT authentication token */
        token?: string;
        user?: User;
      },
      Error
    >({
      path: `/api/users/register`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Handle password reset token and redirect to reset page
   *
   * @tags Authentication
   * @name UsersRDetail
   * @summary Password reset redirect
   * @request GET:/api/users/r/{id}
   * @secure
   */
  usersRDetail = (id: string, params: RequestParams = {}) =>
    this.request<any, void | string>({
      path: `/api/users/r/${id}`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Permanently delete the authenticated user's account and all associated data
   *
   * @tags Users
   * @name UsersDeleteAccountCreate
   * @summary Delete user account
   * @request POST:/api/users/delete-account
   * @secure
   */
  usersDeleteAccountCreate = (params: RequestParams = {}) =>
    this.request<Success, Error>({
      path: `/api/users/delete-account`,
      method: "POST",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Cancel the authenticated user's active subscription without deleting the account
   *
   * @tags Users
   * @name UsersCancelSubscriptionCreate
   * @summary Cancel user subscription
   * @request POST:/api/users/cancel-subscription
   * @secure
   */
  usersCancelSubscriptionCreate = (params: RequestParams = {}) =>
    this.request<Success, Error>({
      path: `/api/users/cancel-subscription`,
      method: "POST",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Cancels a single subscription the caller owns. The id must resolve to one of the caller's Stripe subscriptions; otherwise the request is rejected with 403.
   *
   * @tags Users
   * @name UsersSubscriptionsCancelCreate
   * @summary Cancel one Stripe subscription by id
   * @request POST:/api/users/subscriptions/{id}/cancel
   * @secure
   */
  usersSubscriptionsCancelCreate = (
    id: string,
    data?: {
      /** @default "immediate" */
      mode?: "immediate" | "period_end";
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/users/subscriptions/${id}/cancel`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Stores an optional cancellation reason and comment after the subscription has already been cancelled. Never blocks the cancel itself.
   *
   * @tags Users
   * @name UsersCancellationFeedbackCreate
   * @summary Record why a user cancelled
   * @request POST:/api/users/cancellation-feedback
   * @secure
   */
  usersCancellationFeedbackCreate = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/users/cancellation-feedback`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Pauses billing with Stripe pause_collection behavior void. Rejects annual plans and subscriptions younger than 30 days. Paid features are off while paused; the subscription auto-resumes on the resume date.
   *
   * @tags Users
   * @name UsersPauseSubscriptionCreate
   * @summary Pause a monthly subscription for 1-3 months
   * @request POST:/api/users/pause-subscription
   * @secure
   */
  usersPauseSubscriptionCreate = (
    data: {
      months?: 1 | 2 | 3;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/users/pause-subscription`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Clears the Stripe pause_collection so billing and paid features resume right away.
   *
   * @tags Users
   * @name UsersResumeSubscriptionCreate
   * @summary Resume a paused subscription immediately
   * @request POST:/api/users/resume-subscription
   * @secure
   */
  usersResumeSubscriptionCreate = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/users/resume-subscription`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Returns active subscriptions for the authenticated user, fetched directly from Stripe
   *
   * @tags Users
   * @name UsersSubscriptionStatusList
   * @summary Get live subscription status from Stripe
   * @request GET:/api/users/subscription-status
   * @secure
   */
  usersSubscriptionStatusList = (params: RequestParams = {}) =>
    this.request<
      {
        subscriptions?: {
          id?: string;
          status?: string;
          cancel_at_period_end?: boolean;
          current_period_end?: number | null;
        }[];
      },
      void
    >({
      path: `/api/users/subscription-status`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Returns cards used this month, the monthly limit, and whether the user is on an unlimited plan
   *
   * @tags Users
   * @name UsersUsageList
   * @summary Get monthly card usage for the current user
   * @request GET:/api/users/usage
   * @secure
   */
  usersUsageList = (params: RequestParams = {}) =>
    this.request<
      {
        cards_used?: number;
        cards_limit?: number;
        unlimited?: boolean;
      },
      void
    >({
      path: `/api/users/usage`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Get debugging information about the current user session (development only)
   *
   * @tags Debug
   * @name UsersDebugLocalsList
   * @summary Get debug information
   * @request GET:/api/users/debug/locals
   * @secure
   */
  usersDebugLocalsList = (params: RequestParams = {}) =>
    this.request<Record<string, any>, Error>({
      path: `/api/users/debug/locals`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Link an email address to the authenticated user's account
   *
   * @tags Users
   * @name UsersLinkEmailCreate
   * @summary Link email to account
   * @request POST:/api/users/link_email
   * @secure
   */
  usersLinkEmailCreate = (
    data: {
      /**
       * Email address to link
       * @format email
       */
      email: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<Success, Error>({
      path: `/api/users/link_email`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Initiate Google OAuth authentication flow
   *
   * @tags Authentication
   * @name UsersAuthGoogleList
   * @summary Google OAuth authentication
   * @request GET:/api/users/auth/google
   * @secure
   */
  usersAuthGoogleList = (params: RequestParams = {}) =>
    this.request<any, void>({
      path: `/api/users/auth/google`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Microsoft OAuth callback. Exchanges the authorization code for an id_token, verifies it against Microsoft's JWKS, then signs the user in (creating an account if needed).
   *
   * @tags Authentication
   * @name UsersAuthMicrosoftList
   * @summary Microsoft OAuth authentication
   * @request GET:/api/users/auth/microsoft
   * @secure
   */
  usersAuthMicrosoftList = (params: RequestParams = {}) =>
    this.request<any, void>({
      path: `/api/users/auth/microsoft`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Sets a CSRF state cookie (sameSite=none; Secure) and redirects to Apple's authorization page.
   *
   * @tags Authentication
   * @name UsersAuthAppleInitList
   * @summary Initiate Apple OAuth login
   * @request GET:/api/users/auth/apple/init
   * @secure
   */
  usersAuthAppleInitList = (params: RequestParams = {}) =>
    this.request<any, void>({
      path: `/api/users/auth/apple/init`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Redirects to Notion OAuth authorization page. Sets a short-lived nonce cookie to prevent account fixation.
   *
   * @tags Authentication
   * @name UsersAuthNotionInitList
   * @summary Initiate Notion OAuth login
   * @request GET:/api/users/auth/notion/init
   * @secure
   */
  usersAuthNotionInitList = (params: RequestParams = {}) =>
    this.request<any, void>({
      path: `/api/users/auth/notion/init`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Exchanges the Notion OAuth code for a session. Upserts the user by email, mints a JWT, and saves the Notion workspace token.
   *
   * @tags Authentication
   * @name UsersAuthNotionList
   * @summary Notion OAuth callback
   * @request GET:/api/users/auth/notion
   * @secure
   */
  usersAuthNotionList = (
    query: {
      /** Authorization code from Notion OAuth */
      code: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<any, void>({
      path: `/api/users/auth/notion`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Returns the user's stored card options, theme, and AnkiWeb acknowledgement timestamp.
   *
   * @tags Users
   * @name UsersMePreferencesList
   * @summary Get the signed-in user's preferences
   * @request GET:/api/users/me/preferences
   * @secure
   */
  usersMePreferencesList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/users/me/preferences`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Updates any of card options, theme, or the AnkiWeb acknowledgement timestamp.
   *
   * @tags Users
   * @name UsersMePreferencesPartialUpdate
   * @summary Update the signed-in user's preferences
   * @request PATCH:/api/users/me/preferences
   * @secure
   */
  usersMePreferencesPartialUpdate = (
    data: {
      cardOptions?: object;
      theme?: string;
      /** @format date-time */
      ankiWebAcknowledgedAt?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/users/me/preferences`,
      method: "PATCH",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Records that the user has completed the onboarding flow.
   *
   * @tags Users
   * @name UsersMeOnboardedPartialUpdate
   * @summary Mark the signed-in user as onboarded
   * @request PATCH:/api/users/me/onboarded
   * @secure
   */
  usersMeOnboardedPartialUpdate = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/users/me/onboarded`,
      method: "PATCH",
      secure: true,
      ...params,
    });
  /**
   * @description Upload a file to be converted to Anki flashcards. This endpoint is public but has origin restrictions.
   *
   * @tags Upload
   * @name UploadFileCreate
   * @summary Upload a file
   * @request POST:/api/upload/file
   * @secure
   */
  uploadFileCreate = (
    data: {
      /**
       * The file to upload (PDF, DOCX, etc.)
       * @format binary
       */
      file?: File;
      /** JSON string with conversion options */
      options?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<Upload, Error>({
      path: `/api/upload/file`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.FormData,
      format: "json",
      ...params,
    });
  /**
   * @description Persist a built .apkg produced on a native device to My Decks. Paid users only. Accepts the built bytes plus metadata; the server does not rebuild the deck.
   *
   * @tags Upload
   * @name UploadSaveCreate
   * @summary Save a built deck to the user's library
   * @request POST:/api/upload/save
   * @secure
   */
  uploadSaveCreate = (
    data: {
      /**
       * The built .apkg deck
       * @format binary
       */
      file?: File;
      /** Display name for the deck */
      name?: string;
      /** Client-supplied key so re-saving the same deck does not duplicate rows */
      dedupe_key?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      {
        key?: string;
        filename?: string;
        size_mb?: number;
      },
      void
    >({
      path: `/api/upload/save`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.FormData,
      format: "json",
      ...params,
    });
  /**
   * @description Import a file from Dropbox to be converted to Anki flashcards
   *
   * @tags Upload
   * @name UploadDropboxCreate
   * @summary Upload from Dropbox
   * @request POST:/api/upload/dropbox
   * @secure
   */
  uploadDropboxCreate = (
    data: {
      /**
       * Dropbox share link to the file
       * @format uri
       */
      link: string;
      /** Original filename */
      filename?: string;
      /** Upload and conversion options */
      options?: object;
    },
    params: RequestParams = {},
  ) =>
    this.request<Upload, Error>({
      path: `/api/upload/dropbox`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Import a file from Google Drive to be converted to Anki flashcards
   *
   * @tags Upload
   * @name UploadGoogleDriveCreate
   * @summary Upload from Google Drive
   * @request POST:/api/upload/google_drive
   * @secure
   */
  uploadGoogleDriveCreate = (
    data: {
      /** Google Drive file ID */
      fileId?: string;
      /** Original filename */
      filename?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<Upload, Error>({
      path: `/api/upload/google_drive`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Retrieve all uploads belonging to the authenticated user
   *
   * @tags Upload
   * @name UploadMineList
   * @summary Get user's uploads
   * @request GET:/api/upload/mine
   * @secure
   */
  uploadMineList = (params: RequestParams = {}) =>
    this.request<Upload[], Error>({
      path: `/api/upload/mine`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Returns up to 3 recent Notion top-level pages and the user's last re-convertible upload, sorted by recency descending. Powers the Recent section on the upload page so deck
   *
   * @tags Upload
   * @name UploadRecentSourcesList
   * @summary Get the user's recent re-convertible sources
   * @request GET:/api/upload/recent-sources
   * @secure
   */
  uploadRecentSourcesList = (params: RequestParams = {}) =>
    this.request<
      {
        sources?: {
          id?: string;
          title?: string;
          type?: "notion" | "remote_upload";
          /** @format date-time */
          updatedAt?: string;
          convertUrl?: string;
        }[];
      },
      Error
    >({
      path: `/api/upload/recent-sources`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Retrieve all conversion jobs belonging to the authenticated user
   *
   * @tags Jobs
   * @name UploadJobsList
   * @summary Get user's conversion jobs
   * @request GET:/api/upload/jobs
   * @secure
   */
  uploadJobsList = (params: RequestParams = {}) =>
    this.request<
      {
        id?: number;
        status?: "pending" | "processing" | "completed" | "failed";
        title?: string;
        /** @format date-time */
        created_at?: string;
      }[],
      Error
    >({
      path: `/api/upload/jobs`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Delete a specific conversion job belonging to the authenticated user
   *
   * @tags Jobs
   * @name UploadJobsDelete
   * @summary Delete a conversion job
   * @request DELETE:/api/upload/jobs/{id}
   * @secure
   */
  uploadJobsDelete = (id: number, params: RequestParams = {}) =>
    this.request<Success, Error>({
      path: `/api/upload/jobs/${id}`,
      method: "DELETE",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Download the APKG file produced by a completed Claude job
   *
   * @tags Upload
   * @name UploadJobsDownloadList
   * @summary Download a completed job result
   * @request GET:/api/upload/jobs/{jobId}/download
   * @secure
   */
  uploadJobsDownloadList = (jobId: string, params: RequestParams = {}) =>
    this.request<void, Error>({
      path: `/api/upload/jobs/${jobId}/download`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Restart a Claude flashcard job that was previously interrupted
   *
   * @tags Upload
   * @name UploadJobsRestartCreate
   * @summary Restart an interrupted Claude job
   * @request POST:/api/upload/jobs/{jobId}/restart
   * @secure
   */
  uploadJobsRestartCreate = (jobId: string, params: RequestParams = {}) =>
    this.request<
      {
        jobId?: string;
      },
      Error
    >({
      path: `/api/upload/jobs/${jobId}/restart`,
      method: "POST",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Delete a specific upload belonging to the authenticated user
   *
   * @tags Upload
   * @name UploadMineDelete
   * @summary Delete an upload
   * @request DELETE:/api/upload/mine/{key}
   * @secure
   */
  uploadMineDelete = (key: string, params: RequestParams = {}) =>
    this.request<Success, Error>({
      path: `/api/upload/mine/${key}`,
      method: "DELETE",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Returns the most recent Dropbox uploads for the logged-in user, sorted newest first. Folder entries are excluded.
   *
   * @tags Upload
   * @name UploadDropboxMineList
   * @summary List the authenticated user's Dropbox upload history
   * @request GET:/api/upload/dropbox/mine
   * @secure
   */
  uploadDropboxMineList = (
    query?: {
      /**
       * Number of rows to skip for paging beyond the first page
       * @min 0
       */
      offset?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      {
        id?: number;
        name?: string;
        bytes?: number;
        /** @format date-time */
        created_at?: string | null;
      }[],
      Error
    >({
      path: `/api/upload/dropbox/mine`,
      method: "GET",
      query: query,
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Deletes a single dropbox_uploads row owned by the authenticated user. The underlying file in Dropbox is not affected.
   *
   * @tags Upload
   * @name UploadDropboxMineDelete
   * @summary Remove a row from the user's Dropbox upload history
   * @request DELETE:/api/upload/dropbox/mine/{id}
   * @secure
   */
  uploadDropboxMineDelete = (id: number, params: RequestParams = {}) =>
    this.request<Success, Error>({
      path: `/api/upload/dropbox/mine/${id}`,
      method: "DELETE",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Returns the most recent Google Drive files the user has converted, ordered by last_converted_at descending. Folder entries are excluded.
   *
   * @tags Upload
   * @name UploadGoogleDriveMineList
   * @summary List the authenticated user's Google Drive upload history
   * @request GET:/api/upload/google_drive/mine
   * @secure
   */
  uploadGoogleDriveMineList = (
    query?: {
      /**
       * Number of rows to skip for paging beyond the first page
       * @min 0
       */
      offset?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      {
        id?: string;
        iconUrl?: string;
        mimeType?: string;
        name?: string;
        sizeBytes?: string | null;
        url?: string;
        /** @format date-time */
        last_converted_at?: string | null;
      }[],
      Error
    >({
      path: `/api/upload/google_drive/mine`,
      method: "GET",
      query: query,
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Deletes a single google_drive_uploads row owned by the authenticated user. The underlying file in Drive is not affected.
   *
   * @tags Upload
   * @name UploadGoogleDriveMineDelete
   * @summary Remove a row from the user's Google Drive upload history
   * @request DELETE:/api/upload/google_drive/mine/{id}
   * @secure
   */
  uploadGoogleDriveMineDelete = (id: string, params: RequestParams = {}) =>
    this.request<Success, Error>({
      path: `/api/upload/google_drive/mine/${id}`,
      method: "DELETE",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Create a new Anki card template for the authenticated user
   *
   * @tags Templates
   * @name TemplatesCreateCreate
   * @summary Create template
   * @request POST:/api/templates/create
   * @secure
   */
  templatesCreateCreate = (
    data: {
      /** Template payload to persist for the user */
      templates: object;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/templates/create`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Delete the template payload owned by the authenticated user
   *
   * @tags Templates
   * @name TemplatesDeleteCreate
   * @summary Delete template
   * @request POST:/api/templates/delete
   * @secure
   */
  templatesDeleteCreate = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/templates/delete`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Returns the curated starter Anki note types shipped with 2anki — used to seed the Note types gallery.
   *
   * @tags Templates
   * @name TemplatesDefaultsList
   * @summary List built-in starter note types
   * @request GET:/api/templates/defaults
   * @secure
   */
  templatesDefaultsList = (params: RequestParams = {}) =>
    this.request<object[], any>({
      path: `/api/templates/defaults`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Returns the four canonical 2anki templates (Notion Basic, Notion Cloze, Notion Input, Image Occlusion).
   *
   * @tags Templates
   * @name TemplatesOfficialList
   * @summary List official 2anki note types used by the conversion pipeline
   * @request GET:/api/templates/official
   * @secure
   */
  templatesOfficialList = (params: RequestParams = {}) =>
    this.request<object[], any>({
      path: `/api/templates/official`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Returns `{ templates, hiddenIds }` for the current user, or empty defaults if none saved.
   *
   * @tags Templates
   * @name TemplatesUserList
   * @summary Get the authenticated user's saved template payload
   * @request GET:/api/templates/user
   * @secure
   */
  templatesUserList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/templates/user`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Persists `{ templates, hiddenIds }` for the current user.
   *
   * @tags Templates
   * @name TemplatesUserUpdate
   * @summary Save the authenticated user's template payload
   * @request PUT:/api/templates/user
   * @secure
   */
  templatesUserUpdate = (
    data: {
      templates?: any[];
      hiddenIds?: string[];
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/templates/user`,
      method: "PUT",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Builds an `.apkg` file from a note type definition plus optional previewData. Returns an attachment download.
   *
   * @tags Templates
   * @name TemplatesExportCreate
   * @summary Export a note type as an Anki package (.apkg)
   * @request POST:/api/templates/export
   * @secure
   */
  templatesExportCreate = (
    data: {
      /** Anki note type definition (name, tmpls, flds, css) */
      noteType: object;
      /** Field values for the example card included in the .apkg */
      previewData?: object;
    },
    params: RequestParams = {},
  ) =>
    this.request<Blob, void>({
      path: `/api/templates/export`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * No description
   *
   * @tags Templates
   * @name TemplatesAiGenerateCreate
   * @summary Generate a new Anki note type with Claude from a natural-language prompt
   * @request POST:/api/templates/ai/generate
   * @secure
   */
  templatesAiGenerateCreate = (
    data: {
      prompt: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/templates/ai/generate`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * No description
   *
   * @tags Templates
   * @name TemplatesAiModifyCreate
   * @summary Ask Claude to modify the current note type given a chat instruction
   * @request POST:/api/templates/ai/modify
   * @secure
   */
  templatesAiModifyCreate = (
    data: {
      starter: object;
      instruction: string;
      history?: {
        role?: "user" | "assistant";
        content?: string;
      }[];
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/templates/ai/modify`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Returns cached Notion blocks and Anki cards for the homepage "See it in action" section. Public endpoint, no auth required.
   *
   * @tags Showcase
   * @name ShowcaseList
   * @summary Homepage showcase data
   * @request GET:/api/showcase
   * @secure
   */
  showcaseList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/showcase`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Generates an unguessable token and persists a `deck_shares` row tying it to the caller and the given `upload_key`.
   *
   * @tags Deck Shares
   * @name SharesCreate
   * @summary Create a public share link for one of the caller's uploads
   * @request POST:/api/shares
   * @secure
   */
  sharesCreate = (
    data: {
      /** S3 object key of an upload owned by the caller. */
      upload_key: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/shares`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Returns every non-revoked share row the caller owns, with token, url, upload_key, created_at, and view_count.
   *
   * @tags Deck Shares
   * @name SharesList
   * @summary List the caller's active share links
   * @request GET:/api/shares
   * @secure
   */
  sharesList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/shares`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Public endpoint. Returns a paginated, newest-first page of decks the owner listed in the public library. Indexable — unlike the other share endpoints, this response does NOT carry X-Robots-Tag&#58; noindex.
   *
   * @tags Deck Shares
   * @name SharesPublicList
   * @summary List public shared decks
   * @request GET:/api/shares/public
   * @secure
   */
  sharesPublicList = (
    query?: {
      /** Zero-based offset to resume from; omit for the first page. */
      cursor?: number;
      /** Number of decks per page (1–100, default 24). */
      page_size?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/shares/public`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Owner-only. Setting is_public to true requires a non-empty title and records the deck's card count. Setting it to false removes the deck from the public library; the private share link keeps working either way.
   *
   * @tags Deck Shares
   * @name SharesPartialUpdate
   * @summary Publish or unpublish a share to the public library
   * @request PATCH:/api/shares/{token}
   * @secure
   */
  sharesPartialUpdate = (
    token: string,
    data: {
      is_public: boolean;
      title?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/shares/${token}`,
      method: "PATCH",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Sets `revoked_at = NOW()` on a share row the caller owns. Idempotent — repeated calls or unknown tokens still return 204.
   *
   * @tags Deck Shares
   * @name SharesDelete
   * @summary Revoke a share link
   * @request DELETE:/api/shares/{token}
   * @secure
   */
  sharesDelete = (token: string, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/shares/${token}`,
      method: "DELETE",
      secure: true,
      ...params,
    });
  /**
   * @description Public endpoint. Returns total card count and deck list for the shared deck. Rate-limited per IP. Responses carry `X-Robots-Tag&#58; noindex`.
   *
   * @tags Deck Shares
   * @name SharesMetaList
   * @summary Get shared deck preview metadata
   * @request GET:/api/shares/{token}/meta
   * @secure
   */
  sharesMetaList = (token: string, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/shares/${token}/meta`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Public endpoint. Paginated, server-rendered card slice. Rate-limited per IP. Responses carry `X-Robots-Tag&#58; noindex`.
   *
   * @tags Deck Shares
   * @name SharesCardsList
   * @summary Get a page of cards from a shared deck
   * @request GET:/api/shares/{token}/cards
   * @secure
   */
  sharesCardsList = (
    token: string,
    query?: {
      /** Zero-based index to resume from; omit for the first page. */
      cursor?: number;
      /** Number of cards per page (1–100, default 20). */
      page_size?: number;
      /** Restrict to cards belonging to this deck id. */
      deck_id?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/shares/${token}/cards`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Public endpoint. Streams the named media file from the shared upload. Rate-limited per IP. Responses carry `X-Robots-Tag&#58; noindex` and a one-hour `Cache-Control`.
   *
   * @tags Deck Shares
   * @name SharesMediaDetail
   * @summary Serve a media file from a shared deck
   * @request GET:/api/shares/{token}/media/{name}
   * @secure
   */
  sharesMediaDetail = (
    token: string,
    name: string,
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/shares/${token}/media/${name}`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Public endpoint. Streams the original .apkg bytes with `Content-Disposition&#58; attachment`. Rate-limited per IP and per token; increments view_count on success.
   *
   * @tags Deck Shares
   * @name SharesDownloadList
   * @summary Download the .apkg behind a shared deck
   * @request GET:/api/shares/{token}/download
   * @secure
   */
  sharesDownloadList = (token: string, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/shares/${token}/download`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Create a new setting configuration for the authenticated user
   *
   * @tags Settings
   * @name SettingsCreateCreate
   * @summary Create user setting
   * @request POST:/api/settings/create/{id}
   * @secure
   */
  settingsCreateCreate = (
    id: string,
    data: {
      /** Card formatting and generation options */
      cardOptions?: object;
      /** Content conversion preferences */
      conversionOptions?: object;
      /** Template-specific settings */
      templateSettings?: object;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      {
        /** Setting ID */
        id?: string;
        /** Success message */
        message?: string;
      },
      Error
    >({
      path: `/api/settings/create/${id}`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Delete a specific setting configuration for the authenticated user
   *
   * @tags Settings
   * @name SettingsDeleteCreate
   * @summary Delete user setting
   * @request POST:/api/settings/delete/{id}
   * @secure
   */
  settingsDeleteCreate = (id: string, params: RequestParams = {}) =>
    this.request<Success, Error>({
      path: `/api/settings/delete/${id}`,
      method: "POST",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Retrieve a specific setting configuration for the authenticated user
   *
   * @tags Settings
   * @name SettingsFindDetail
   * @summary Find user setting
   * @request GET:/api/settings/find/{id}
   * @secure
   */
  settingsFindDetail = (id: string, params: RequestParams = {}) =>
    this.request<
      {
        /** Setting ID */
        id?: string;
        /** Card formatting options */
        cardOptions?: object;
        /** Content conversion preferences */
        conversionOptions?: object;
      },
      Error
    >({
      path: `/api/settings/find/${id}`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Retrieve the default card options and conversion settings
   *
   * @tags Settings
   * @name SettingsDefaultList
   * @summary Get default settings
   * @request GET:/api/settings/default
   * @secure
   */
  settingsDefaultList = (params: RequestParams = {}) =>
    this.request<
      {
        /** Default card formatting options */
        cardOptions?: object;
        /** Default conversion settings */
        conversionOptions?: object;
      },
      any
    >({
      path: `/api/settings/default`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Retrieve detailed information about available card options and their configurations
   *
   * @tags Settings
   * @name SettingsCardOptionsList
   * @summary Get card option details
   * @request GET:/api/settings/card-options
   * @secure
   */
  settingsCardOptionsList = (params: RequestParams = {}) =>
    this.request<
      {
        options?: {
          /** Option name */
          name?: string;
          /** Option data type */
          type?: string;
          /** Option description */
          description?: string;
          /** Default value for the option */
          defaultValue?: any;
        }[];
      },
      any
    >({
      path: `/api/settings/card-options`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Retrieve all per-page setting overrides for the authenticated user, including page title and last-updated timestamp.
   *
   * @tags Settings
   * @name SettingsListList
   * @summary List per-page settings
   * @request GET:/api/settings/list
   * @secure
   */
  settingsListList = (params: RequestParams = {}) =>
    this.request<
      {
        items?: {
          /** Notion page ID */
          pageId?: string;
          /** Page title resolved from Notion, if known */
          title?: string | null;
          /**
           * Timestamp of the most recent override save
           * @format date-time
           */
          updatedAt?: string | null;
        }[];
      },
      Error
    >({
      path: `/api/settings/list`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Owner-scoped wipe of every per-page parser rule and per-page card-option override for the authenticated user. Idempotent — returns 204 even when the user has no saved pages.
   *
   * @tags Settings
   * @name UsersMeSettingsDelete
   * @summary Reset all saved per-page settings
   * @request DELETE:/api/users/me/settings
   * @secure
   */
  usersMeSettingsDelete = (params: RequestParams = {}) =>
    this.request<void, Error>({
      path: `/api/users/me/settings`,
      method: "DELETE",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags Pitches
   * @name PitchesDismissCreate
   * @summary Dismiss an Auto Sync pitch placement
   * @request POST:/api/pitches/dismiss
   * @secure
   */
  pitchesDismissCreate = (
    data: {
      placement: "convert_success" | "account_banner";
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/pitches/dismiss`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * No description
   *
   * @tags Pitches
   * @name PitchesAutoSyncList
   * @summary Check Auto Sync pitch eligibility for a user
   * @request GET:/api/pitches/auto-sync
   * @secure
   */
  pitchesAutoSyncList = (
    query?: {
      /** Notion object ID for re-upload detection */
      objectId?: string;
      /** Job type (page or database for Notion) */
      jobType?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      {
        convertSuccess?: boolean;
        accountBanner?: boolean;
      },
      void
    >({
      path: `/api/pitches/auto-sync`,
      method: "GET",
      query: query,
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Retrieve a specific parser rule by ID for the authenticated user
   *
   * @tags Parser Rules
   * @name RulesFindDetail
   * @summary Find parser rule
   * @request GET:/api/rules/find/{id}
   * @secure
   */
  rulesFindDetail = (id: string, params: RequestParams = {}) =>
    this.request<
      {
        /** Rule ID */
        id?: string;
        /** Rule name */
        name?: string;
        /** Regular expression pattern */
        pattern?: string;
        /** Replacement text */
        replacement?: string;
        /** Whether rule is enabled */
        enabled?: boolean;
      },
      Error
    >({
      path: `/api/rules/find/${id}`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Create a new parser rule for text processing and card generation
   *
   * @tags Parser Rules
   * @name RulesCreateCreate
   * @summary Create parser rule
   * @request POST:/api/rules/create/{id}
   * @secure
   */
  rulesCreateCreate = (
    id: string,
    data: {
      /** Rule name */
      name: string;
      /** Regular expression pattern to match */
      pattern: string;
      /** Replacement text or pattern */
      replacement: string;
      /**
       * Whether rule is enabled
       * @default true
       */
      enabled?: boolean;
      /** Rule execution priority */
      priority?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      {
        /** Created rule ID */
        id?: string;
        /** Success message */
        message?: string;
      },
      Error
    >({
      path: `/api/rules/create/${id}`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Remove the parser rule row for the given object ID, scoped to the authenticated owner. Idempotent — returns 204 whether or not a row was deleted.
   *
   * @tags Parser Rules
   * @name RulesDelete
   * @summary Delete parser rule
   * @request DELETE:/api/rules/{id}
   * @secure
   */
  rulesDelete = (id: string, params: RequestParams = {}) =>
    this.request<void, Error>({
      path: `/api/rules/${id}`,
      method: "DELETE",
      secure: true,
      ...params,
    });
  /**
   * @description Internal endpoint locked to the ops owner. Returns 404 for everyone else (we don't reveal that the dashboard exists).
   *
   * @tags Ops
   * @name OpsMetricsList
   * @summary Aggregated request/outbound observability metrics
   * @request GET:/api/ops/metrics
   * @secure
   */
  opsMetricsList = (
    query?: {
      window?: "1h" | "24h" | "7d";
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ops/metrics`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Internal endpoint locked to the ops owner. Returns 404 for everyone else.
   *
   * @tags Ops
   * @name OpsBusinessMetricsList
   * @summary Business metrics from Stripe-backed subscriptions
   * @request GET:/api/ops/business/metrics
   * @secure
   */
  opsBusinessMetricsList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ops/business/metrics`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Internal endpoint locked to the ops owner. Returns 404 for everyone else.
   *
   * @tags Ops
   * @name OpsConversionMetricsList
   * @summary Conversion success/failure metrics from jobs table plus funnel metrics from events
   * @request GET:/api/ops/conversion/metrics
   * @secure
   */
  opsConversionMetricsList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ops/conversion/metrics`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Fetches Notion blocks and APKG cards, caches them in the database for the homepage showcase section.
   *
   * @tags Ops
   * @name OpsShowcasePopulateCreate
   * @summary Populate homepage showcase
   * @request POST:/api/ops/showcase/populate
   * @secure
   */
  opsShowcasePopulateCreate = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ops/showcase/populate`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Deletes the cached showcase data. The homepage section hides when no data exists.
   *
   * @tags Ops
   * @name OpsShowcaseDelete
   * @summary Purge homepage showcase
   * @request DELETE:/api/ops/showcase
   * @secure
   */
  opsShowcaseDelete = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ops/showcase`,
      method: "DELETE",
      secure: true,
      ...params,
    });
  /**
   * @description Finds free users inactive for 6+ months and sends a deletion warning email. Exempt: patreon=true (lifetime) and active Stripe subscribers. Pass ?dryRun=false to send real emails; omit or pass ?dryRun=true to count candidates only. Run manually — do not put on a cron until signal is validated.
   *
   * @tags Ops
   * @name OpsSendInactivityWarningsCreate
   * @summary Send inactivity warning emails to dormant free accounts
   * @request POST:/api/ops/send-inactivity-warnings
   * @secure
   */
  opsSendInactivityWarningsCreate = (
    query?: {
      /** Defaults to true. Pass false to actually send emails. */
      dryRun?: "true" | "false";
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ops/send-inactivity-warnings`,
      method: "POST",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Finds users whose paid Day/Week pass has expired with no active pass or subscription, and sends a seasonal win-back nudge. Excludes marketing_opt_out and hard-suppressed addresses, and dedupes per user per campaign. Pass ?campaign=<id> (required, e.g. winback-2026-fall) to scope the send and dedupe window. Pass ?dryRun=false to send real emails; omit or pass ?dryRun=true to count candidates only. Run manually — enabling an automatic seasonal send is the maintainer's call.
   *
   * @tags Ops
   * @name OpsSendPassWinbackCreate
   * @summary Send a win-back email to lapsed one-time pass buyers
   * @request POST:/api/ops/send-pass-winback
   * @secure
   */
  opsSendPassWinbackCreate = (
    query: {
      /** Campaign identifier — scopes the send and the per-user dedupe. */
      campaign: string;
      /** Defaults to true. Pass false to actually send emails. */
      dryRun?: "true" | "false";
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ops/send-pass-winback`,
      method: "POST",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Deletes accounts that were warned 14+ days ago and still have not logged in since the warning. Exempt: patreon=true (lifetime) and active Stripe subscribers. Permanently removes the user and all their data (usage is snapshotted first). Pass ?dryRun=false to delete; omit or pass ?dryRun=true to count candidates only. Also runs as a daily background job, capped at 100 deletions per run.
   *
   * @tags Ops
   * @name OpsDeleteInactiveUsersCreate
   * @summary Delete free accounts that ignored the inactivity warning
   * @request POST:/api/ops/delete-inactive-users
   * @secure
   */
  opsDeleteInactiveUsersCreate = (
    query?: {
      /** Defaults to true. Pass false to actually delete accounts. */
      dryRun?: "true" | "false";
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ops/delete-inactive-users`,
      method: "POST",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Sets `users.developer_access` for the account matching the given email. Grants access to the lifetime-gated Developers surface without making the account lifetime. Internal endpoint locked to the ops owner.
   *
   * @tags Ops
   * @name OpsDeveloperAccessCreate
   * @summary Grant or revoke Developers API access for an account by email
   * @request POST:/api/ops/developer-access
   * @secure
   */
  opsDeveloperAccessCreate = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ops/developer-access`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Internal endpoint locked to the ops owner. Returns p50/p95/p99 job durations (24h and 7d), terminal-status counts, the 20 slowest done jobs in the last 24h, and signup country breakdown for the last 7 days. Returns 404 for everyone else.
   *
   * @tags Ops
   * @name OpsPerformanceMetricsList
   * @summary Job-duration percentiles, status breakdown, and signup-country counts
   * @request GET:/api/ops/performance/metrics
   * @secure
   */
  opsPerformanceMetricsList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ops/performance/metrics`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Internal endpoint locked to the ops owner. Returns the % of users who returned for a second conversion within 7, 14, and 30 days of their prior successful conversion, bucketed by source_type (page, database, conversion). Cohort window is the last 90 days. Returns 404 for everyone else.
   *
   * @tags Ops
   * @name OpsReturnRateMetricsList
   * @summary Post-completion return-rate metrics bucketed by source type
   * @request GET:/api/ops/return-rate/metrics
   * @secure
   */
  opsReturnRateMetricsList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ops/return-rate/metrics`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Internal endpoint locked to the ops owner. Returns total bytes and object count for all mindmap images under the mindmaps/ S3 prefix, plus a top-20 breakdown by user ID. Use this to gauge growth before deciding on per-user quotas. Returns 404 for everyone else.
   *
   * @tags Ops
   * @name OpsMindmapStorageList
   * @summary Mindmap image storage usage on S3
   * @request GET:/api/ops/mindmap/storage
   * @secure
   */
  opsMindmapStorageList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ops/mindmap/storage`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Pulls every active Stripe subscription and upserts it into the subscriptions table, then reconciles each active DB row against Stripe (deactivating any that Stripe no longer reports active). Use this to provision a paying user whose subscription did not land via webhook. Runs in the background and returns immediately; watch the server logs for the result. Locked to the ops owner — returns 404 for everyone else.
   *
   * @tags Ops
   * @name OpsSyncStripeSubscriptionsCreate
   * @summary Sync subscriptions from Stripe into the database
   * @request POST:/api/ops/sync-stripe-subscriptions
   * @secure
   */
  opsSyncStripeSubscriptionsCreate = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ops/sync-stripe-subscriptions`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Returns every flag in the feature_flags table along with the email of the admin who last toggled it. Flags are pre-seeded via migration — the UI only toggles existing flags, it does not create them. Returns 404 for everyone except the ops owner.
   *
   * @tags Ops
   * @name OpsFlagsList
   * @summary List runtime feature flags
   * @request GET:/api/ops/flags
   * @secure
   */
  opsFlagsList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ops/flags`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Updates value for the given flag key. 400 when the body value is not a boolean. 404 when the key does not exist — new flags get added via migration, not from the UI. Returns 404 for everyone except the ops owner.
   *
   * @tags Ops
   * @name OpsFlagsUpdate
   * @summary Toggle a runtime feature flag
   * @request PUT:/api/ops/flags/{key}
   * @secure
   */
  opsFlagsUpdate = (
    key: string,
    data: {
      value: boolean;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ops/flags/${key}`,
      method: "PUT",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Returns distinct-identity counts for each upload-funnel stage (upload_started, conversion_succeeded, conversion_failed, deck_downloaded) keyed by user_id or anonymous_id, plus the true upload-to-download success rate. `by_origin` repeats the same stages and rates per signup_origin (attributed from the first_touch cookie), ordered by upload volume, so leaks can be read per acquisition source. Defaults to the last 30 days; pass ?window=7d|14d|30d|60d|90d. Internal endpoint locked to the ops owner — returns 404 for everyone else.
   *
   * @tags Ops
   * @name OpsUploadFunnelList
   * @summary Upload-to-download funnel by stage
   * @request GET:/api/ops/upload-funnel
   * @secure
   */
  opsUploadFunnelList = (
    query?: {
      /** Lookback window. Defaults to 30d. */
      window?: "7d" | "14d" | "30d" | "60d" | "90d";
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ops/upload-funnel`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Returns event counts for each cancel-flow stage (subscription_cancel_started, subscription_pause_offered, subscription_paused, subscription_cancelled, subscription_pause_offer_declined), plus the pause save-rate (paused ÷ pause_offered) and offer-reach (pause_offered ÷ cancel_started). Defaults to the last 30 days; pass ?window=7d|14d|30d|60d|90d. Internal endpoint locked to the ops owner — returns 404 for everyone else.
   *
   * @tags Ops
   * @name OpsCancelFunnelList
   * @summary Cancel-flow funnel by stage with pause save-rate
   * @request GET:/api/ops/cancel-funnel
   * @secure
   */
  opsCancelFunnelList = (
    query?: {
      /** Lookback window. Defaults to 30d. */
      window?: "7d" | "14d" | "30d" | "60d" | "90d";
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ops/cancel-funnel`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Groups users by signup_origin and reports, per page, the number of signups in the window, how many became active subscribers, how many bought a pass, and the deduplicated paid conversion rate. Defaults to the last 30 days; pass ?window=7d|14d|30d|60d|90d. Internal endpoint locked to the ops owner — returns 404 for everyone else.
   *
   * @tags Ops
   * @name OpsGrowthLandingPageYieldList
   * @summary Signups and paid conversions per landing page
   * @request GET:/api/ops/growth/landing-page-yield
   * @secure
   */
  opsGrowthLandingPageYieldList = (
    query?: {
      /** Lookback window. Defaults to 30d. */
      window?: "7d" | "14d" | "30d" | "60d" | "90d";
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ops/growth/landing-page-yield`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Aggregates DB-resident customer signal — cancellation reasons and comments, deck-ready emoji feedback comments, failed-conversion reasons, and empty-back card counts — into a single list ranked by volume. Each row carries a pain-killer / money-multiplier / unknown bucket, and free-text sources return verbatim sample quotes. No user identity is joined. Defaults to the last 30 days; pass ?window=7d|14d|30d|60d|90d. Internal endpoint locked to the ops owner — returns 404 for everyone else.
   *
   * @tags Ops
   * @name OpsGrowthCustomerSignalsList
   * @summary First-party customer signal aggregated into one ranked list
   * @request GET:/api/ops/growth/customer-signals
   * @secure
   */
  opsGrowthCustomerSignalsList = (
    query?: {
      /** Lookback window. Defaults to 30d. */
      window?: "7d" | "14d" | "30d" | "60d" | "90d";
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ops/growth/customer-signals`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Lists completed Day/Week pass checkout sessions from Stripe (the source of truth) over a rolling window and asserts each has a matching pass row — user_passes by payment intent, anonymous_passes by session id. Sessions younger than the grace window are counted as pending, not missing, so an in-flight webhook is not flagged. A missing row is a paid-but-not-unlocked buyer. Defaults to the last 7 days; pass ?window=1d|7d|14d|30d. Internal endpoint locked to the ops owner — returns 404 for everyone else.
   *
   * @tags Ops
   * @name OpsPassesUnlockMonitorList
   * @summary Completed pass payments reconciled against granted pass rows
   * @request GET:/api/ops/passes/unlock-monitor
   * @secure
   */
  opsPassesUnlockMonitorList = (
    query?: {
      /** Lookback window. Defaults to 7d. */
      window?: "1d" | "7d" | "14d" | "30d";
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ops/passes/unlock-monitor`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Returns active subscriptions whose paid email, linked email, and Stripe customer id match no 2anki account, so the payer is not getting premium. Read-only preview — sends nothing. Internal endpoint locked to the ops owner — returns 404 for everyone else.
   *
   * @tags Ops
   * @name OpsSubscriptionsOrphanedList
   * @summary List active subscriptions with no account receiving premium
   * @request GET:/api/ops/subscriptions/orphaned
   * @secure
   */
  opsSubscriptionsOrphanedList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ops/subscriptions/orphaned`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Finds active subscriptions with no account receiving premium and emails each payer how to connect their subscription — register with the paid email, or link from an existing account. Idempotent: an email address notified within the last 14 days is skipped. Never auto-creates or auto-links accounts. Internal endpoint locked to the ops owner — returns 404 for everyone else.
   *
   * @tags Ops
   * @name OpsSubscriptionsReconcileCreate
   * @summary Email orphaned subscribers a recovery path
   * @request POST:/api/ops/subscriptions/reconcile
   * @secure
   */
  opsSubscriptionsReconcileCreate = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ops/subscriptions/reconcile`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Internal endpoint locked to the ops owner. Returns 401 for everyone else. Groups rows by exact message_hash. Never exposes ip_hash.
   *
   * @tags Ops
   * @name OpsErrorsList
   * @summary List grouped error events
   * @request GET:/api/ops/errors
   * @secure
   */
  opsErrorsList = (
    query?: {
      /** @default 50 */
      limit?: number;
      /** @default 0 */
      offset?: number;
      source?: "web" | "server";
      sort?: "last_seen" | "occurrences";
      /** @default "unresolved" */
      status?: "unresolved" | "resolved" | "all";
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ops/errors`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Internal endpoint locked to the ops owner. Returns 401 for everyone else. One markdown document with an investigation preamble and a section per group, each carrying the latest sample event. Never exposes ip_hash.
   *
   * @tags Ops
   * @name OpsErrorsExportList
   * @summary Export error groups as a Claude-ready markdown file
   * @request GET:/api/ops/errors/export
   * @secure
   */
  opsErrorsExportList = (
    query?: {
      source?: "web" | "server";
      /** @default "unresolved" */
      status?: "unresolved" | "resolved" | "all";
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ops/errors/export`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Records a resolution timestamp for the group. A later occurrence (last_seen after resolved_at) reopens the group automatically.
   *
   * @tags Ops
   * @name OpsErrorsResolveCreate
   * @summary Mark an error group resolved
   * @request POST:/api/ops/errors/{messageHash}/resolve
   * @secure
   */
  opsErrorsResolveCreate = (messageHash: string, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ops/errors/${messageHash}/resolve`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags Ops
   * @name OpsErrorsResolveDelete
   * @summary Reopen a resolved error group
   * @request DELETE:/api/ops/errors/{messageHash}/resolve
   * @secure
   */
  opsErrorsResolveDelete = (messageHash: string, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ops/errors/${messageHash}/resolve`,
      method: "DELETE",
      secure: true,
      ...params,
    });
  /**
   * @description Establish a connection to Notion using OAuth. Redirects to Notion authorization page.
   *
   * @tags Notion
   * @name NotionConnectList
   * @summary Connect to Notion
   * @request GET:/api/notion/connect
   * @secure
   */
  notionConnectList = (params: RequestParams = {}) =>
    this.request<any, void | Error>({
      path: `/api/notion/connect`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Search for pages in the user's connected Notion workspace
   *
   * @tags Notion
   * @name NotionPagesCreate
   * @summary Search Notion pages
   * @request POST:/api/notion/pages
   * @secure
   */
  notionPagesCreate = (
    data: {
      /** Search query for pages */
      query?: string;
      /** Filter criteria for pages */
      filter?: object;
    },
    params: RequestParams = {},
  ) =>
    this.request<NotionSearchResults, Error>({
      path: `/api/notion/pages`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Excludes databases, database rows, and untitled pages. Paginates Notion's search until up to 50 useful entries are collected. Used by the Ankify "Find pages" and "Where should we put it?" pickers so users see real container pages instead of a wall of database rows.
   *
   * @tags Notion
   * @name NotionTopLevelPagesCreate
   * @summary Search Notion for top-level titled pages only
   * @request POST:/api/notion/top-level-pages
   * @secure
   */
  notionTopLevelPagesCreate = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/notion/top-level-pages`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description There is no `/api/notion/login` endpoint. Integrators sometimes guess this URL because OAuth flows are commonly called "login" elsewhere; hitting it returns 404. The endpoint that returns the Notion OAuth authorization URL is `GET /api/notion/get-notion-link`.
   *
   * @tags Notion
   * @name NotionLoginList
   * @summary Deprecated — use GET /api/notion/get-notion-link
   * @request GET:/api/notion/login
   * @deprecated
   * @secure
   */
  notionLoginList = (params: RequestParams = {}) =>
    this.request<any, void>({
      path: `/api/notion/login`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Returns the OAuth link to connect to Notion. The link itself is public — anonymous and expired-session users still get back a working URL so the "Connect to Notion" button never goes inert. `isConnected` and `workspace` are only populated when the caller has a valid session. Note: there is no `/api/notion/login` endpoint. Some integrators guess that path because OAuth flows are commonly called "login"; this endpoint is the canonical one.
   *
   * @tags Notion
   * @name NotionGetNotionLinkList
   * @summary Get Notion connection link (Notion OAuth login URL)
   * @request GET:/api/notion/get-notion-link
   * @secure
   */
  notionGetNotionLinkList = (
    query?: {
      /**
       * Pass `native` to get a link whose OAuth state is bound to the
       * authenticated user for the native app flow. Requires a valid
       * session — anonymous callers receive 401.
       */
      client?: "native";
    },
    params: RequestParams = {},
  ) =>
    this.request<
      {
        /**
         * Notion OAuth authorization URL
         * @format uri
         */
        link?: string;
        /** Whether user is connected to Notion */
        isConnected?: boolean;
        /** Connected workspace name */
        workspace?: string | null;
      },
      void
    >({
      path: `/api/notion/get-notion-link`,
      method: "GET",
      query: query,
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Convert a Notion page to Anki flashcards
   *
   * @tags Notion
   * @name NotionConvertCreate
   * @summary Convert Notion page to Anki
   * @request POST:/api/notion/convert/
   * @secure
   */
  notionConvertCreate = (
    data: {
      /** Notion page ID to convert */
      pageId: string;
      /** Conversion options */
      options?: {
        /** Name for the Anki deck */
        deckName?: string;
        /** Create reversed cards */
        basicReversed?: boolean;
        /** Tags to add to cards */
        tags?: string[];
      };
    },
    params: RequestParams = {},
  ) =>
    this.request<
      {
        /** Conversion job ID */
        jobId?: string;
        /** Success message */
        message?: string;
      },
      Error
    >({
      path: `/api/notion/convert/`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Retrieve a specific Notion page by ID
   *
   * @tags Notion
   * @name NotionPageDetail
   * @summary Get Notion page
   * @request GET:/api/notion/page/{id}
   * @secure
   */
  notionPageDetail = (id: string, params: RequestParams = {}) =>
    this.request<NotionPage, Error>({
      path: `/api/notion/page/${id}`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Cursor-paginated preview of a Notion page. Pre-rendered HTML per block for fast first-paint. Call with no cursor for the first batch (includes pageTitle); subsequent calls pass the returned nextCursor.
   *
   * @tags Notion
   * @name NotionPreviewDetail
   * @summary Stream a preview of a Notion page
   * @request GET:/api/notion/preview/{id}
   * @secure
   */
  notionPreviewDetail = (
    id: string,
    query?: {
      cursor?: string;
      /**
       * @max 50
       * @default 15
       */
      page_size?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/notion/preview/${id}`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Retrieve all blocks from a Notion page
   *
   * @tags Notion
   * @name NotionBlocksDetail
   * @summary Get page blocks
   * @request GET:/api/notion/blocks/{id}
   * @secure
   */
  notionBlocksDetail = (id: string, params: RequestParams = {}) =>
    this.request<
      {
        results?: {
          /** Block ID */
          id?: string;
          /** Block type (paragraph, heading_1, etc.) */
          type?: string;
          /** Block content */
          content?: object;
        }[];
      },
      Error
    >({
      path: `/api/notion/blocks/${id}`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Retrieve a specific block by ID
   *
   * @tags Notion
   * @name NotionBlockDetail
   * @summary Get specific block
   * @request GET:/api/notion/block/{id}
   * @secure
   */
  notionBlockDetail = (id: string, params: RequestParams = {}) =>
    this.request<
      {
        /** Block ID */
        id?: string;
        /** Block type */
        type?: string;
        /** Block content */
        content?: object;
      },
      Error
    >({
      path: `/api/notion/block/${id}`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Create or update a Notion block with new content
   *
   * @tags Notion
   * @name NotionBlockCreate
   * @summary Create or update block
   * @request POST:/api/notion/block/{id}
   * @secure
   */
  notionBlockCreate = (
    id: string,
    data: {
      /** Block content data */
      content?: object;
      /** Block type (paragraph, heading, etc.) */
      type?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      {
        /** Block ID */
        id?: string;
        /** Success message */
        message?: string;
      },
      Error
    >({
      path: `/api/notion/block/${id}`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Delete a Notion block (requires paid subscription)
   *
   * @tags Notion
   * @name NotionBlockDelete
   * @summary Delete block
   * @request DELETE:/api/notion/block/{id}
   * @secure
   */
  notionBlockDelete = (id: string, params: RequestParams = {}) =>
    this.request<Success, Error>({
      path: `/api/notion/block/${id}`,
      method: "DELETE",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Render a Notion block as HTML (requires paid subscription)
   *
   * @tags Notion
   * @name NotionRenderBlockDetail
   * @summary Render block as HTML
   * @request GET:/api/notion/render-block/{id}
   * @secure
   */
  notionRenderBlockDetail = (id: string, params: RequestParams = {}) =>
    this.request<string, Error>({
      path: `/api/notion/render-block/${id}`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Retrieve information about a Notion database
   *
   * @tags Notion
   * @name NotionDatabaseDetail
   * @summary Get Notion database
   * @request GET:/api/notion/database/{id}
   * @secure
   */
  notionDatabaseDetail = (id: string, params: RequestParams = {}) =>
    this.request<NotionDatabase, Error>({
      path: `/api/notion/database/${id}`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Returns the database title, column names, server-inferred Front/Back mapping, and up to 10 sample rows. Used by the /preview/database/:id page so users can inspect a database before queueing a conversion.
   *
   * @tags Notion
   * @name NotionDatabasePreviewList
   * @summary Read-only preview of a Notion database
   * @request GET:/api/notion/database/{id}/preview
   * @secure
   */
  notionDatabasePreviewList = (id: string, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/notion/database/${id}/preview`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Query a Notion database to retrieve pages/entries
   *
   * @tags Notion
   * @name NotionDatabaseQueryDetail
   * @summary Query Notion database
   * @request GET:/api/notion/database/query/{id}
   * @secure
   */
  notionDatabaseQueryDetail = (
    id: string,
    query?: {
      /** Filter criteria (JSON string) */
      filter?: string;
      /** Sort criteria (JSON string) */
      sorts?: string;
      /**
       * Number of results per page
       * @min 1
       * @max 100
       * @default 50
       */
      page_size?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      {
        results?: {
          /** Page ID */
          id?: string;
          /** Page properties */
          properties?: object;
        }[];
        /** Whether there are more results */
        has_more?: boolean;
        /** Cursor for next page */
        next_cursor?: string;
      },
      Error
    >({
      path: `/api/notion/database/query/${id}`,
      method: "GET",
      query: query,
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Disconnect the user's Notion integration and remove stored tokens
   *
   * @tags Notion
   * @name NotionDisconnectCreate
   * @summary Disconnect from Notion
   * @request POST:/api/notion/disconnect
   * @secure
   */
  notionDisconnectCreate = (params: RequestParams = {}) =>
    this.request<Success, Error>({
      path: `/api/notion/disconnect`,
      method: "POST",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * No description
   *
   * @tags Mind maps
   * @name MindmapsList
   * @summary List the user's mind maps
   * @request GET:/api/mindmaps
   * @secure
   */
  mindmapsList = (params: RequestParams = {}) =>
    this.request<
      {
        maps?: object[];
        access?: {
          hasUnlimited?: boolean;
          currentCount?: number;
          freeMapLimit?: number;
          maxNodesPerMap?: number;
        };
      },
      void
    >({
      path: `/api/mindmaps`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * No description
   *
   * @tags Mind maps
   * @name MindmapsCreate
   * @summary Create a new mind map
   * @request POST:/api/mindmaps
   * @secure
   */
  mindmapsCreate = (
    data: {
      title?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/mindmaps`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * No description
   *
   * @tags Mind maps
   * @name MindmapsDetail
   * @summary Get a single mind map
   * @request GET:/api/mindmaps/{id}
   * @secure
   */
  mindmapsDetail = (id: string, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/mindmaps/${id}`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags Mind maps
   * @name MindmapsPartialUpdate
   * @summary Update a mind map's title and/or graph
   * @request PATCH:/api/mindmaps/{id}
   * @secure
   */
  mindmapsPartialUpdate = (
    id: string,
    data: {
      title?: string;
      data?: {
        nodes?: any[];
        edges?: any[];
      };
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/mindmaps/${id}`,
      method: "PATCH",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * No description
   *
   * @tags Mind maps
   * @name MindmapsDelete
   * @summary Delete a mind map
   * @request DELETE:/api/mindmaps/{id}
   * @secure
   */
  mindmapsDelete = (id: string, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/mindmaps/${id}`,
      method: "DELETE",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags Mind maps
   * @name MindmapsExportCreate
   * @summary Export a mind map as an Anki .apkg deck
   * @request POST:/api/mindmaps/{id}/export
   * @secure
   */
  mindmapsExportCreate = (
    id: string,
    data: {
      deckName?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<Blob, void>({
      path: `/api/mindmaps/${id}/export`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * No description
   *
   * @tags Mind maps
   * @name MindmapsImagesCreate
   * @summary Upload an image for a mind map node
   * @request POST:/api/mindmaps/{id}/images
   * @secure
   */
  mindmapsImagesCreate = (
    id: string,
    data: {
      /** @format binary */
      image?: File;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/mindmaps/${id}/images`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.FormData,
      ...params,
    });
  /**
   * No description
   *
   * @tags Mind maps
   * @name MindmapsImagesDetail
   * @summary Serve or redirect to a mindmap image
   * @request GET:/api/mindmaps/images/{userId}/{mapId}/{file}
   * @secure
   */
  mindmapsImagesDetail = (
    userId: string,
    mapId: string,
    file: string,
    params: RequestParams = {},
  ) =>
    this.request<any, void>({
      path: `/api/mindmaps/images/${userId}/${mapId}/${file}`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Public capability URL for a deck created via the hosted MCP server. The objectId is an unguessable UUID that acts as the bearer token; resolves the deck, presigns the stored file, and 302-redirects to it. Returns 404 for unknown, malformed, or keyless ids.
   *
   * @tags MCP
   * @name McpDecksDownloadList
   * @summary Download an MCP-generated deck
   * @request GET:/api/mcp/decks/{objectId}/download
   * @secure
   */
  mcpDecksDownloadList = (objectId: string, params: RequestParams = {}) =>
    this.request<any, void>({
      path: `/api/mcp/decks/${objectId}/download`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags ImageOcclusion
   * @name ImageOcclusionCreate
   * @summary Generate an image occlusion Anki deck
   * @request POST:/api/image-occlusion
   * @secure
   */
  imageOcclusionCreate = (
    data: {
      images?: File[];
    },
    params: RequestParams = {},
  ) =>
    this.request<void, any>({
      path: `/api/image-occlusion`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.FormData,
      ...params,
    });
  /**
   * No description
   *
   * @tags ImageOcclusion
   * @name ImageOcclusionDraftImageCreate
   * @summary Upload an image for an occlusion draft
   * @request POST:/api/image-occlusion/draft/image
   * @secure
   */
  imageOcclusionDraftImageCreate = (
    data: {
      /** @format binary */
      image?: File;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/image-occlusion/draft/image`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.FormData,
      ...params,
    });
  /**
   * No description
   *
   * @tags ImageOcclusion
   * @name ImageOcclusionDraftCreate
   * @summary Create a new occlusion draft
   * @request POST:/api/image-occlusion/draft
   * @secure
   */
  imageOcclusionDraftCreate = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/image-occlusion/draft`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags ImageOcclusion
   * @name ImageOcclusionDraftUpdate
   * @summary Update an occlusion draft
   * @request PUT:/api/image-occlusion/draft/{id}
   * @secure
   */
  imageOcclusionDraftUpdate = (id: string, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/image-occlusion/draft/${id}`,
      method: "PUT",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags ImageOcclusion
   * @name ImageOcclusionDraftDetail
   * @summary Get a single occlusion draft
   * @request GET:/api/image-occlusion/draft/{id}
   * @secure
   */
  imageOcclusionDraftDetail = (id: string, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/image-occlusion/draft/${id}`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags ImageOcclusion
   * @name ImageOcclusionDraftDelete
   * @summary Delete an occlusion draft and its S3 images
   * @request DELETE:/api/image-occlusion/draft/{id}
   * @secure
   */
  imageOcclusionDraftDelete = (id: string, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/image-occlusion/draft/${id}`,
      method: "DELETE",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags ImageOcclusion
   * @name ImageOcclusionDraftsList
   * @summary List occlusion drafts for the authenticated user
   * @request GET:/api/image-occlusion/drafts
   * @secure
   */
  imageOcclusionDraftsList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/image-occlusion/drafts`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags ImageOcclusion
   * @name ImageOcclusionPhotoToDeckCreate
   * @summary Generate an Anki deck from a photo via Claude Vision
   * @request POST:/api/image-occlusion/photo-to-deck
   * @secure
   */
  imageOcclusionPhotoToDeckCreate = (
    data: {
      imageBase64?: string;
      mediaType?: string;
      deckName?: string;
      width?: number;
      height?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/image-occlusion/photo-to-deck`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * No description
   *
   * @tags ImageOcclusion
   * @name ImageOcclusionDraftNotionImageCreate
   * @summary Import images from Notion blocks into an occlusion draft
   * @request POST:/api/image-occlusion/draft/notion-image
   * @secure
   */
  imageOcclusionDraftNotionImageCreate = (
    data: {
      blockIds?: string[];
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/image-occlusion/draft/notion-image`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * No description
   *
   * @tags IAP
   * @name IapRedeemCreate
   * @summary Credit a 2anki account after a verified Apple in-app purchase
   * @request POST:/api/iap/redeem
   * @secure
   */
  iapRedeemCreate = (
    data: {
      /** Apple StoreKit 2 Transaction.jwsRepresentation */
      jws: string;
      /** Claimed product id, cross-checked against the decoded JWS */
      product_id: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/iap/redeem`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Returns process uptime and version. Always 200.
   *
   * @tags Health
   * @name HealthList
   * @summary Process health
   * @request GET:/api/health
   * @secure
   */
  healthList = (params: RequestParams = {}) =>
    this.request<void, any>({
      path: `/api/health`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Returns 200 when the database responds to a probe query, 503 otherwise.
   *
   * @tags Health
   * @name HealthDbList
   * @summary Database health
   * @request GET:/api/health/db
   * @secure
   */
  healthDbList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/health/db`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Aggregated signals for the public status page (api, db, Notion, Stripe, last deploy, recent incidents).
   *
   * @tags Health
   * @name StatusList
   * @summary Public status snapshot
   * @request GET:/api/status
   * @secure
   */
  statusList = (params: RequestParams = {}) =>
    this.request<void, any>({
      path: `/api/status`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags Feedback
   * @name FeatureInterestCreate
   * @summary Record interest in a not-yet-built feature
   * @request POST:/api/feature-interest
   * @secure
   */
  featureInterestCreate = (
    data: {
      feature_key: string;
      comment?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/feature-interest`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Add a new item to the user's favorites list
   *
   * @tags Favorites
   * @name FavoriteCreateCreate
   * @summary Create favorite
   * @request POST:/api/favorite/create
   * @secure
   */
  favoriteCreateCreate = (
    data: {
      /** Type of item to favorite */
      type: "upload" | "template" | "notion_page";
      /** Data about the favorite item */
      data: object;
      /** Display title for the favorite */
      title?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      {
        /** Favorite ID */
        id?: number;
        /** Success message */
        message?: string;
      },
      Error
    >({
      path: `/api/favorite/create`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Remove an item from the user's favorites list
   *
   * @tags Favorites
   * @name FavoriteRemoveCreate
   * @summary Remove favorite
   * @request POST:/api/favorite/remove
   * @secure
   */
  favoriteRemoveCreate = (
    data: {
      /** Favorite ID to remove */
      id: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<Success, Error>({
      path: `/api/favorite/remove`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Retrieve all favorite items for the authenticated user
   *
   * @tags Favorites
   * @name FavoriteList
   * @summary Get user favorites
   * @request GET:/api/favorite
   * @secure
   */
  favoriteList = (params: RequestParams = {}) =>
    this.request<
      {
        /** Favorite ID */
        id?: number;
        /** Type of favorite item */
        type?: "upload" | "template" | "notion_page";
        /** Display title */
        title?: string;
        /** Item data */
        data?: object;
        /**
         * When the favorite was created
         * @format date-time
         */
        created_at?: string;
      }[],
      Error
    >({
      path: `/api/favorite`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Anonymous endpoint. Rate-limited to 10 req/min per IP and 1 000/min globally. Payload must be ≤ 10 KB. Duplicate messages (same hash + IP within 5 min) return 202 with no insert.
   *
   * @tags Events
   * @name EventsErrorsCreate
   * @summary Ingest a client or server error event
   * @request POST:/api/events/errors
   * @secure
   */
  eventsErrorsCreate = (
    data: {
      message: string;
      stack?: string;
      url?: string;
      userAgent?: string;
      release?: string;
      userId?: number;
      source?: "web" | "server";
      context?: object;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/events/errors`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * No description
   *
   * @tags Feedback
   * @name EmojiFeedbackCreate
   * @summary Submit emoji feedback
   * @request POST:/api/emoji-feedback
   * @secure
   */
  emojiFeedbackCreate = (
    data: {
      /**
       * @min 1
       * @max 5
       */
      rating: number;
      comment?: string;
      email?: string;
      page: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/emoji-feedback`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Download a file uploaded by the authenticated user using the file key
   *
   * @tags Download
   * @name DownloadUDetail
   * @summary Download user file
   * @request GET:/api/download/u/{key}
   * @secure
   */
  downloadUDetail = (key: string, params: RequestParams = {}) =>
    this.request<Blob, Error>({
      path: `/api/download/u/${key}`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Self-service — any signed-in account. Returns key names, prefixes, and last-used timestamps; never the secret.
   *
   * @tags Developer
   * @name DeveloperKeysList
   * @summary List the caller's API keys
   * @request GET:/api/developer/keys
   * @secure
   */
  developerKeysList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/developer/keys`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Self-service — any signed-in account. The secret is returned once and stored only as a hash. Keys start on the free Sandbox tier.
   *
   * @tags Developer
   * @name DeveloperKeysCreate
   * @summary Create an API key
   * @request POST:/api/developer/keys
   * @secure
   */
  developerKeysCreate = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/developer/keys`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Revocation is immediate — anything using the key stops working.
   *
   * @tags Developer
   * @name DeveloperKeysDelete
   * @summary Revoke an API key
   * @request DELETE:/api/developer/keys/{id}
   * @secure
   */
  developerKeysDelete = (id: string, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/developer/keys/${id}`,
      method: "DELETE",
      secure: true,
      ...params,
    });
  /**
   * @description Submit a contact form with optional file attachments
   *
   * @tags Support
   * @name ContactUsCreate
   * @summary Contact us form
   * @request POST:/api/contact-us
   * @secure
   */
  contactUsCreate = (
    data: {
      /** Sender's name */
      name: string;
      /**
       * Sender's email address
       * @format email
       */
      email: string;
      /** Contact message */
      message: string;
      /** Message subject */
      subject?: string;
      /** Optional file attachments (max 25MB per file) */
      attachments?: File[];
    },
    params: RequestParams = {},
  ) =>
    this.request<Success, Error>({
      path: `/api/contact-us`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.FormData,
      format: "json",
      ...params,
    });
  /**
   * @description Returns all messages from the contact form, newest first (ops only)
   *
   * @tags Ops
   * @name OpsContactMessagesList
   * @summary List contact form submissions
   * @request GET:/api/ops/contact-messages
   * @secure
   */
  opsContactMessagesList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ops/contact-messages`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Sets is_acknowledged=true for the given message (ops only)
   *
   * @tags Ops
   * @name OpsContactMessagesAcknowledgePartialUpdate
   * @summary Mark a contact message as read
   * @request PATCH:/api/ops/contact-messages/{id}/acknowledge
   * @secure
   */
  opsContactMessagesAcknowledgePartialUpdate = (
    id: number,
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ops/contact-messages/${id}/acknowledge`,
      method: "PATCH",
      secure: true,
      ...params,
    });
  /**
   * @description Check the health and status of the API server
   *
   * @tags System
   * @name ChecksList
   * @summary Health check
   * @request GET:/api/checks
   * @secure
   */
  checksList = (params: RequestParams = {}) =>
    this.request<
      {
        /** Server status */
        status?: "ok" | "healthy";
        /**
         * Check timestamp
         * @format date-time
         */
        timestamp?: string;
        /** Server uptime in seconds */
        uptime?: number;
        /** API version */
        version?: string;
      },
      Error
    >({
      path: `/api/checks`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Returns the monthly and annual Unlimited prices the visitor would pay at checkout. Accounts created before the pricing-v2 cutover see legacy prices until the lock-in window closes; everyone else sees v2 prices once the pricing_v2 flag is on. Anonymous visitors are always quoted the new-member prices.
   *
   * @tags Payments
   * @name CheckoutPricesList
   * @summary Get the Unlimited plan prices for the current visitor
   * @request GET:/api/checkout/prices
   * @secure
   */
  checkoutPricesList = (params: RequestParams = {}) =>
    this.request<void, any>({
      path: `/api/checkout/prices`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags Chat
   * @name ChatConsentCreate
   * @summary Record chat consent for the authenticated user
   * @request POST:/api/chat/consent
   * @secure
   */
  chatConsentCreate = (params: RequestParams = {}) =>
    this.request<void, any>({
      path: `/api/chat/consent`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Streams the assistant's reply as Server-Sent Events (`text/event-stream`). Three event names are emitted on the response, each carrying a JSON payload in the `data:` line: - `event: token` — incremental assistant text. `data` is a JSON string fragment (e.g. `"Hello"`). Concatenate every `token` payload to reconstruct the full reply. - `event: done` — terminal frame for a successful turn. `data` is a JSON object matching `ChatDoneFrame` (see schemas), carrying the final assistant content, the conversation id, and, when the assistant generated flashcards, a `cards` array plus the prose that came before / after the cards. - `event: error` — terminal frame for a failure. `data` is a JSON object matching `ChatErrorFrame` (see schemas). The HTTP status is still 200 because the stream has already opened; clients must branch on the `error` frame's `type` field instead of HTTP code. Each event ends with a blank line (`\n\n`). Clients that consume SSE via a line-based reader must not discard empty lines — they are the frame separator. The request accepts `multipart/form-data` so the caller can attach up to 5 files totalling 25 MB. PDFs and images are sent to the model as native blocks; `.zip` (Notion export), `.docx`, `.md`, and `.txt` are parsed to text on the server and injected into the model context as `<file name="…">…</file>` blocks before the prompt runs. Card-shape footgun: when the caller is a Patreon (lifetime/paid) user, the assistant may emit MCQ-shape cards even if `templateSlug=basic` is sent. `templateSlug` is a hint, not a contract — clients must be ready for both card shapes on every `done` frame. See the `ChatDoneFrame.cards` schema's `oneOf`.
   *
   * @tags Chat
   * @name ChatMessageCreate
   * @summary Send a message to the study assistant (Server-Sent Events stream)
   * @request POST:/api/chat/message
   * @secure
   */
  chatMessageCreate = (
    data: {
      /** @maxLength 100000 */
      content: string;
      conversationId?: number | null;
      /**
       * Card template hint (`basic`, `basic-and-reversed`,
       * `cloze`, `mcq`). Patreon users may still receive MCQ
       * cards when this is `basic` — see endpoint description.
       */
      templateSlug?: string | null;
      history?: {
        role: "user" | "assistant";
        content: string;
      }[];
    },
    params: RequestParams = {},
  ) =>
    this.request<ChatTokenFrame | ChatDoneFrame | ChatErrorFrame, Error | void>(
      {
        path: `/api/chat/message`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        ...params,
      },
    );
  /**
   * @description Builds an `.apkg` from a client-supplied card list. Each card may be either the basic shape (`front` + `back`) or the MCQ shape (`front` + 4 `options` + `correctIndex`, with optional `rationale` and `tags`); the two shapes can be mixed in a single request. Per card, `tags` is an optional array of short subject tags (lower-case, hyphenated, up to 8 per card).
   *
   * @tags Chat
   * @name ChatDeckCreate
   * @summary Generate an Anki deck from chat cards
   * @request POST:/api/chat/deck
   * @secure
   */
  chatDeckCreate = (
    data: {
      /** @maxLength 120 */
      deckName: string;
      /**
       * Card template slug (`basic`, `basic-and-reversed`,
       * `cloze`, `mcq`). The server still chooses the actual
       * note model based on card shape — MCQ-shape cards
       * render as MCQ regardless of this value.
       */
      templateSlug?: string | null;
      /** @maxItems 200 */
      cards: (ChatBasicCard | ChatMcqCard)[];
    },
    params: RequestParams = {},
  ) =>
    this.request<Blob, Error | void>({
      path: `/api/chat/deck`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * No description
   *
   * @tags Chat
   * @name ChatTagCardsCreate
   * @summary Generate short subject tags for an existing set of chat cards
   * @request POST:/api/chat/tag-cards
   * @secure
   */
  chatTagCardsCreate = (
    data: {
      /** @maxItems 200 */
      cards: {
        front: string;
        back?: string;
      }[];
    },
    params: RequestParams = {},
  ) =>
    this.request<
      {
        tags?: string[][];
      },
      void
    >({
      path: `/api/chat/tag-cards`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * No description
   *
   * @tags Chat
   * @name ChatUsageList
   * @summary Get chat usage for the current month
   * @request GET:/api/chat/usage
   * @secure
   */
  chatUsageList = (params: RequestParams = {}) =>
    this.request<
      {
        used?: number;
        limit?: number | null;
      },
      any
    >({
      path: `/api/chat/usage`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * No description
   *
   * @tags Chat
   * @name ChatConversationsList
   * @summary List the user's chat conversations
   * @request GET:/api/chat/conversations
   * @secure
   */
  chatConversationsList = (params: RequestParams = {}) =>
    this.request<void, any>({
      path: `/api/chat/conversations`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags Chat
   * @name ChatConversationsDetail
   * @summary Load a conversation and its messages
   * @request GET:/api/chat/conversations/{id}
   * @secure
   */
  chatConversationsDetail = (id: number, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/chat/conversations/${id}`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags Chat
   * @name ChatConversationsPartialUpdate
   * @summary Rename a conversation
   * @request PATCH:/api/chat/conversations/{id}
   * @secure
   */
  chatConversationsPartialUpdate = (
    id: number,
    data: {
      /** @maxLength 120 */
      title: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/chat/conversations/${id}`,
      method: "PATCH",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * No description
   *
   * @tags Chat
   * @name ChatConversationsDelete
   * @summary Soft-delete a conversation
   * @request DELETE:/api/chat/conversations/{id}
   * @secure
   */
  chatConversationsDelete = (id: number, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/chat/conversations/${id}`,
      method: "DELETE",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags Chat
   * @name ChatConversationsDraftPartialUpdate
   * @summary Save the in-progress draft for a conversation
   * @request PATCH:/api/chat/conversations/{id}/draft
   * @secure
   */
  chatConversationsDraftPartialUpdate = (
    id: number,
    data: {
      /** @maxLength 100000 */
      content: string | null;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/chat/conversations/${id}/draft`,
      method: "PATCH",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * No description
   *
   * @tags Chat
   * @name ChatConversationsTemplatePartialUpdate
   * @summary Set the card template for a conversation
   * @request PATCH:/api/chat/conversations/{id}/template
   * @secure
   */
  chatConversationsTemplatePartialUpdate = (
    id: number,
    data: {
      templateSlug: "basic" | "basic-and-reversed" | "cloze" | "mcq" | null;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/chat/conversations/${id}/template`,
      method: "PATCH",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Deletes the most recent assistant message in the conversation and re-runs the prior user prompt against Claude under the supplied `templateSlug`, streaming the new turn back with the same SSE event shape as `POST /api/chat/message` (`token` / `done` / `error`). The prior user message is kept as-is, so the conversation does not grow a duplicate turn on reload. The per-call `templateSlug` is independent of the conversation's stored default template set via `PATCH /api/chat/conversations/{id}/template`.
   *
   * @tags Chat
   * @name ChatConversationsRegenerateCreate
   * @summary Regenerate the last assistant turn in place (Server-Sent Events stream)
   * @request POST:/api/chat/conversations/{id}/regenerate
   * @secure
   */
  chatConversationsRegenerateCreate = (
    id: number,
    data?: {
      templateSlug?: "basic" | "basic-and-reversed" | "cloze" | "mcq" | null;
    },
    params: RequestParams = {},
  ) =>
    this.request<ChatTokenFrame | ChatDoneFrame | ChatErrorFrame, Error | void>(
      {
        path: `/api/chat/conversations/${id}/regenerate`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        ...params,
      },
    );
  /**
   * @description Returns the iOS and Mac App Store product URLs for the native app, built from the numeric Apple ID in the server env. When the ID is unset, `available` is false and the Download page shows its coming-soon state instead of a dead link.
   *
   * @tags System
   * @name AppStoreList
   * @summary Get native app store links
   * @request GET:/api/app-store
   * @secure
   */
  appStoreList = (params: RequestParams = {}) =>
    this.request<
      {
        /** @example true */
        available?: boolean;
        /** @example "https://apps.apple.com/app/id1234567890" */
        iosUrl?: string;
        /** @example "https://apps.apple.com/app/id1234567890?mt=12" */
        macUrl?: string;
      },
      any
    >({
      path: `/api/app-store`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description Returns the total card count and the list of decks (with card counts) for a user-owned .apkg upload.
   *
   * @tags Apkg Preview
   * @name ApkgMetaList
   * @summary Get .apkg preview metadata
   * @request GET:/api/apkg/{key}/meta
   * @secure
   */
  apkgMetaList = (key: string, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/apkg/${key}/meta`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Returns a paginated, server-rendered (sanitised HTML + note-type CSS) slice of the deck. Optionally filtered by deck id.
   *
   * @tags Apkg Preview
   * @name ApkgCardsList
   * @summary Get a page of rendered .apkg cards
   * @request GET:/api/apkg/{key}/cards
   * @secure
   */
  apkgCardsList = (
    key: string,
    query?: {
      /** Zero-based index to resume from; omit for the first page. */
      cursor?: number;
      /** Number of cards per page (1–100, default 20). */
      page_size?: number;
      /** Restrict to cards belonging to this deck id. */
      deck_id?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/apkg/${key}/cards`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Streams bytes for the named file (by its original filename from the media manifest) with a best-effort Content-Type.
   *
   * @tags Apkg Preview
   * @name ApkgMediaDetail
   * @summary Serve a media file bundled inside an .apkg upload
   * @request GET:/api/apkg/{key}/media/{name}
   * @secure
   */
  apkgMediaDetail = (key: string, name: string, params: RequestParams = {}) =>
    this.request<Blob, void>({
      path: `/api/apkg/${key}/media/${name}`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Re-packs the source .apkg with the provided edit set — text edits, card deletions, and suspend flags — and returns the modified file for download.
   *
   * @tags Apkg Preview
   * @name ApkgDownloadEditedCreate
   * @summary Download an .apkg with user edits applied
   * @request POST:/api/apkg/{key}/download-edited
   * @secure
   */
  apkgDownloadEditedCreate = (
    key: string,
    data: {
      edits: {
        cardIndex: number;
        front?: string;
        back?: string;
        deleted?: boolean;
        suspended?: boolean;
      }[];
    },
    params: RequestParams = {},
  ) =>
    this.request<Blob, void>({
      path: `/api/apkg/${key}/download-edited`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Returns active and inactive Remote Anki Client records belonging to the authenticated user.
   *
   * @tags Ankify
   * @name AnkifyClientsList
   * @summary List the requesting user's hosted Anki clients
   * @request GET:/api/ankify/clients
   * @secure
   */
  ankifyClientsList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ankify/clients`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Allocates host ports and starts a remote-anki-client container for the authenticated user.
   *
   * @tags Ankify
   * @name AnkifyClientsCreate
   * @summary Provision a new hosted Anki client
   * @request POST:/api/ankify/clients
   * @secure
   */
  ankifyClientsCreate = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ankify/clients`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Stops the underlying container and marks the client inactive.
   *
   * @tags Ankify
   * @name AnkifyClientsDelete
   * @summary Stop and clean up a hosted Anki client
   * @request DELETE:/api/ankify/clients/{id}
   * @secure
   */
  ankifyClientsDelete = (id: number, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ankify/clients/${id}`,
      method: "DELETE",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Reads the upload's APKG, parses notes, and dispatches them via AnkiConnect into the active Ankify client. Idempotent — a second call updates rather than duplicates, keyed off ankify_sync_mappings.
   *
   * @tags Ankify
   * @name AnkifyDispatchCreate
   * @summary Send an existing APKG upload to the user's hosted Anki client
   * @request POST:/api/ankify/dispatch
   * @secure
   */
  ankifyDispatchCreate = (
    data: {
      upload_id: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ankify/dispatch`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. The named volume backing the user's collection is preserved, so the new container has the same data.
   *
   * @tags Ankify
   * @name AnkifyClientsRespinCreate
   * @summary Stop the active hosted Anki container and start a fresh one
   * @request POST:/api/ankify/clients/respin
   * @secure
   */
  ankifyClientsRespinCreate = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ankify/clients/respin`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Returns the active client with a fresh session_url containing a new 256-bit token. Prior tokens for the same client remain valid until their natural 8h TTL — open noVNC tabs survive a reissue. Tokens are revoked when the client is stopped or respun.
   *
   * @tags Ankify
   * @name AnkifyClientsReissueSessionCreate
   * @summary Mint a fresh session URL
   * @request POST:/api/ankify/clients/{id}/reissue-session
   * @secure
   */
  ankifyClientsReissueSessionCreate = (
    id: string,
    params: RequestParams = {},
  ) =>
    this.request<any, any>({
      path: `/api/ankify/clients/${id}/reissue-session`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Internal endpoint called by Caddy/Traefik forward_auth on each request to /v/<token>/. Validates the URL token, the 2anki session cookie, and the allowlist. On success, sets X-Backend-Port and responds 200.
   *
   * @tags Ankify
   * @name AnkifySessionsValidateCreate
   * @summary Token+cookie session validation called by the reverse proxy
   * @request POST:/api/ankify/sessions/validate
   * @secure
   */
  ankifySessionsValidateCreate = (params: RequestParams = {}) =>
    this.request<any, any>({
      path: `/api/ankify/sessions/validate`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Pulls the per-day review history from the active hosted Anki via AnkiConnect and writes one row per day into the user-supplied Notion database (skipping dates already present).
   *
   * @tags Ankify
   * @name AnkifyExportsReviewDataCreate
   * @summary Export Anki review counts into a Notion database
   * @request POST:/api/ankify/exports/review-data
   * @secure
   */
  ankifyExportsReviewDataCreate = (
    data: {
      database_id: string;
      /** Restrict to the trailing N days of history. */
      date_range_days?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ankify/exports/review-data`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * No description
   *
   * @tags Ankify
   * @name AnkifyExportsScheduleList
   * @summary Read the user's daily review-export schedule
   * @request GET:/api/ankify/exports/schedule
   * @secure
   */
  ankifyExportsScheduleList = (params: RequestParams = {}) =>
    this.request<any, any>({
      path: `/api/ankify/exports/schedule`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Schedules a daily run at the supplied IANA timezone-local time.
   *
   * @tags Ankify
   * @name AnkifyExportsScheduleCreate
   * @summary Create or update the user's daily review-export schedule
   * @request POST:/api/ankify/exports/schedule
   * @secure
   */
  ankifyExportsScheduleCreate = (
    data: {
      database_id: string;
      /** @example "09:00" */
      time_of_day: string;
      /** @example "Europe/Oslo" */
      timezone: string;
      date_range_days?: number;
      enabled?: boolean;
    },
    params: RequestParams = {},
  ) =>
    this.request<any, any>({
      path: `/api/ankify/exports/schedule`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * No description
   *
   * @tags Ankify
   * @name AnkifyExportsScheduleDelete
   * @summary Cancel and remove the user's daily review-export schedule
   * @request DELETE:/api/ankify/exports/schedule
   * @secure
   */
  ankifyExportsScheduleDelete = (params: RequestParams = {}) =>
    this.request<any, any>({
      path: `/api/ankify/exports/schedule`,
      method: "DELETE",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Optional query params `limit` (default 100) and `status` (success|error|info).
   *
   * @tags Ankify
   * @name AnkifySyncLogsList
   * @summary Recent ankify sync events for the user (newest first)
   * @request GET:/api/ankify/sync-logs
   * @secure
   */
  ankifySyncLogsList = (params: RequestParams = {}) =>
    this.request<any, any>({
      path: `/api/ankify/sync-logs`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags Ankify
   * @name AnkifySubscriptionsList
   * @summary List Notion pages auto-synced into the user's hosted Anki
   * @request GET:/api/ankify/subscriptions
   * @secure
   */
  ankifySubscriptionsList = (params: RequestParams = {}) =>
    this.request<any, any>({
      path: `/api/ankify/subscriptions`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags Ankify
   * @name AnkifySubscriptionsCreate
   * @summary Subscribe a Notion page (kicks off an immediate sync)
   * @request POST:/api/ankify/subscriptions
   * @secure
   */
  ankifySubscriptionsCreate = (
    data: {
      notion_page_id: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<any, any>({
      path: `/api/ankify/subscriptions`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Re-runs the Notion → hosted Anki pull for the given subscription, bypassing the 5-minute polling cycle. Per-subscription 30-second cooldown enforced server-side; returns 429 with Retry-After when on cooldown.
   *
   * @tags Ankify
   * @name AnkifySubscriptionsRefreshCreate
   * @summary Manually pull a subscribed Notion page right now
   * @request POST:/api/ankify/subscriptions/{id}/refresh
   * @secure
   */
  ankifySubscriptionsRefreshCreate = (id: number, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ankify/subscriptions/${id}/refresh`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags Ankify
   * @name AnkifyConflictsList
   * @summary List sync conflicts (pending by default)
   * @request GET:/api/ankify/conflicts
   * @secure
   */
  ankifyConflictsList = (params: RequestParams = {}) =>
    this.request<any, any>({
      path: `/api/ankify/conflicts`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * No description
   *
   * @tags Ankify
   * @name AnkifyConflictsResolveCreate
   * @summary Resolve a conflict
   * @request POST:/api/ankify/conflicts/{id}/resolve
   * @secure
   */
  ankifyConflictsResolveCreate = (
    id: string,
    data: {
      resolution: "keep_notion" | "keep_anki" | "dismissed";
    },
    params: RequestParams = {},
  ) =>
    this.request<any, any>({
      path: `/api/ankify/conflicts/${id}/resolve`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Looks up the owner's conflict row, derives its Anki note id, and invokes AnkiConnect guiBrowse(nid:<id>) so Anki's browser focuses that note. Returns { opened: false } when the client is offline.
   *
   * @tags Ankify
   * @name AnkifyConflictsOpenInAnkiCreate
   * @summary Open the conflicting note in the user's hosted Anki browser
   * @request POST:/api/ankify/conflicts/{id}/open-in-anki
   * @secure
   */
  ankifyConflictsOpenInAnkiCreate = (id: number, params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ankify/conflicts/${id}/open-in-anki`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Returns each database with a `has_review_shape` flag (true when it already has Date + Reviews properties suitable for the review export).
   *
   * @tags Ankify
   * @name AnkifyNotionDatabasesList
   * @summary List the user's Notion databases
   * @request GET:/api/ankify/notion/databases
   * @secure
   */
  ankifyNotionDatabasesList = (params: RequestParams = {}) =>
    this.request<any, any>({
      path: `/api/ankify/notion/databases`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Creates a database with Date (date) and Reviews (number) properties, ready to use as the review-export target.
   *
   * @tags Ankify
   * @name AnkifyNotionDatabasesCreate
   * @summary Create a new "Anki review tracker" Notion database under a parent page
   * @request POST:/api/ankify/notion/databases
   * @secure
   */
  ankifyNotionDatabasesCreate = (
    data: {
      parent_page_id: string;
      title?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<any, any>({
      path: `/api/ankify/notion/databases`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Returns { ready, reason? } where ready is true if AnkiConnect responds inside the container. Used by the UI to show a skeleton while a freshly-provisioned container is still booting.
   *
   * @tags Ankify
   * @name AnkifyClientsActiveReadyList
   * @summary Probe whether the active hosted Anki container is reachable
   * @request GET:/api/ankify/clients/active/ready
   * @secure
   */
  ankifyClientsActiveReadyList = (params: RequestParams = {}) =>
    this.request<any, any>({
      path: `/api/ankify/clients/active/ready`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Triggers ac.sync() and reports status as 'linked' (signed in and sync succeeded), 'unlinked' (sign-in needed), 'unreachable' (AnkiConnect down), 'error' (other), or 'no_active_client'.
   *
   * @tags Ankify
   * @name AnkifyClientsActiveAnkiWebStatusList
   * @summary Probe whether the active hosted Anki is signed in to AnkiWeb
   * @request GET:/api/ankify/clients/active/anki-web-status
   * @secure
   */
  ankifyClientsActiveAnkiWebStatusList = (params: RequestParams = {}) =>
    this.request<any, any>({
      path: `/api/ankify/clients/active/anki-web-status`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Pings AnkiConnect, then returns reviewed-today, the per-day review history, computed streaks, and per-deck backlog for the user's synced decks. Always 200 — returns connected: false when no active client exists or AnkiConnect is unreachable.
   *
   * @tags Ankify
   * @name AnkifyStatsList
   * @summary Live study stats from the user's hosted Anki
   * @request GET:/api/ankify/stats
   * @secure
   */
  ankifyStatsList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ankify/stats`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Returns { profile }. 409 when no active client, 503 when AnkiConnect is unreachable.
   *
   * @tags Ankify
   * @name AnkifyActiveProfileList
   * @summary The synced Anki profile name on the user's hosted client
   * @request GET:/api/ankify/active-profile
   * @secure
   */
  ankifyActiveProfileList = (params: RequestParams = {}) =>
    this.request<any, any>({
      path: `/api/ankify/active-profile`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Returns { ok: true }. 409 when no active client, 503 when AnkiConnect is unreachable.
   *
   * @tags Ankify
   * @name AnkifySyncToAnkiwebCreate
   * @summary Trigger an AnkiWeb sync on the user's hosted Anki
   * @request POST:/api/ankify/sync-to-ankiweb
   * @secure
   */
  ankifySyncToAnkiwebCreate = (params: RequestParams = {}) =>
    this.request<any, any>({
      path: `/api/ankify/sync-to-ankiweb`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Body { deck }. The deck must belong to one of the caller's Notion subscriptions. 403 when the deck is not owned, 503 when AnkiConnect is unreachable.
   *
   * @tags Ankify
   * @name AnkifyGuiDeckOverviewCreate
   * @summary Jump the user's hosted Anki to a deck's overview
   * @request POST:/api/ankify/gui-deck-overview
   * @secure
   */
  ankifyGuiDeckOverviewCreate = (
    data: {
      deck: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<any, any>({
      path: `/api/ankify/gui-deck-overview`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Query { deck }. Returns { connected, matureCount, total, avgIntervalDays } (mature = interval ≥ 21 days). The deck must belong to the caller. 403 when not owned, 503 when AnkiConnect is unreachable.
   *
   * @tags Ankify
   * @name AnkifyDeckMaturityList
   * @summary Maturity breakdown for one of the user's synced decks
   * @request GET:/api/ankify/deck-maturity
   * @secure
   */
  ankifyDeckMaturityList = (
    query: {
      deck: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<any, any>({
      path: `/api/ankify/deck-maturity`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Returns every tag:leech note scoped to the caller's owned decks, sorted most-lapses-first. Always 200 — returns connected: false when no active client exists or AnkiConnect is unreachable.
   *
   * @tags Ankify
   * @name AnkifyLeechesList
   * @summary List leech cards in the user's owned synced decks
   * @request GET:/api/ankify/leeches
   * @secure
   */
  ankifyLeechesList = (params: RequestParams = {}) =>
    this.request<void, void>({
      path: `/api/ankify/leeches`,
      method: "GET",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Re-validates the note's deck ownership before writing. Body { fields }. 204 on success, 400 on invalid note id or fields, 403 when the note is not owned, 409 when no active client, 503 when AnkiConnect is unreachable.
   *
   * @tags Ankify
   * @name AnkifyLeechesPartialUpdate
   * @summary Edit a leech note's fields
   * @request PATCH:/api/ankify/leeches/{noteId}
   * @secure
   */
  ankifyLeechesPartialUpdate = (
    noteId: number,
    data: {
      fields: object;
    },
    params: RequestParams = {},
  ) =>
    this.request<any, any>({
      path: `/api/ankify/leeches/${noteId}`,
      method: "PATCH",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Re-validates the note's deck ownership before deleting. 204 on success, 400 on invalid note id, 403 when the note is not owned, 409 when no active client, 503 when AnkiConnect is unreachable.
   *
   * @tags Ankify
   * @name AnkifyLeechesDelete
   * @summary Delete a leech note
   * @request DELETE:/api/ankify/leeches/{noteId}
   * @secure
   */
  ankifyLeechesDelete = (noteId: number, params: RequestParams = {}) =>
    this.request<any, any>({
      path: `/api/ankify/leeches/${noteId}`,
      method: "DELETE",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Re-validates the note's deck ownership, then unsuspends the note's cards and removes the leech tag. 200 with the result, 400 on invalid note id, 403 when the note is not owned, 409 when no active client, 503 when AnkiConnect is unreachable.
   *
   * @tags Ankify
   * @name AnkifyLeechesReturnToReviewCreate
   * @summary Return a leech note to review
   * @request POST:/api/ankify/leeches/{noteId}/return-to-review
   * @secure
   */
  ankifyLeechesReturnToReviewCreate = (
    noteId: number,
    params: RequestParams = {},
  ) =>
    this.request<any, any>({
      path: `/api/ankify/leeches/${noteId}/return-to-review`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Query deck. Returns the due card ids for any deck in the user's own hosted Anki as connected plus an array of cardIds. Cards are loaded one at a time via review-card so large decks stay instant. Always 200 when reachable — returns connected false when no active client exists or AnkiConnect is unreachable.
   *
   * @tags Ankify
   * @name AnkifyReviewQueueList
   * @summary List the due card ids for one of the user's Anki decks
   * @request GET:/api/ankify/review-queue
   * @secure
   */
  ankifyReviewQueueList = (
    query: {
      deck: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ankify/review-queue`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Query cardId. Probes the card exists in the caller's own hosted Anki, then returns { connected, card } where card is { cardId, questionHtml, answerHtml, css } with media inlined as data URIs, or null when the card is gone. 503 when AnkiConnect is unreachable.
   *
   * @tags Ankify
   * @name AnkifyReviewCardList
   * @summary Load one due card's rendered HTML and media for review
   * @request GET:/api/ankify/review-card
   * @secure
   */
  ankifyReviewCardList = (
    query: {
      cardId: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ankify/review-card`,
      method: "GET",
      query: query,
      secure: true,
      ...params,
    });
  /**
   * @description Allowlisted endpoint. Body cardId and ease (1-4). Validates ease, then probes the card exists in the caller's own hosted Anki via a cid: query before grading. 200 on success, 400 on invalid ease or cardId, 404 when the card does not exist, 503 when AnkiConnect is unreachable.
   *
   * @tags Ankify
   * @name AnkifyReviewGradeCreate
   * @summary Grade one card in the user's Anki via AnkiConnect answerCards
   * @request POST:/api/ankify/review-grade
   * @secure
   */
  ankifyReviewGradeCreate = (
    data: {
      cardId: number;
      ease: 1 | 2 | 3 | 4;
    },
    params: RequestParams = {},
  ) =>
    this.request<void, void>({
      path: `/api/ankify/review-grade`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
}
