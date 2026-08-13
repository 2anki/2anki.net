# Persist chat attachment files for regenerate and follow-up turns

Issue: [#4047](https://github.com/2anki/server/issues/4047). Follow-up to #4046, which made regenerate refuse turns carrying PDF/image attachments because the blobs live only in the original request.

## Problem

Attachment blobs (PDF/image) exist only for the lifetime of the original chat request. Text-extractable types survive via the stored `attachment_text` fold, but binary context is gone after the turn completes, so:

- regenerate refuses turns that carried a PDF/image (#4046's honest error),
- follow-up turns lose PDF/image context after a reload,
- conversation reload cannot render what was attached.

## Proposal

Persist attachment blobs per message in the existing DigitalOcean Spaces bucket (`StorageHandler` — same credentials/endpoint the upload pipeline uses; no new integration).

- **Key shape**: `chat-attachments/<userId>/<conversationId>/<messageId>/<index>-<safeFilename>`. Owner-prefixed keys make the GDPR sweep a single prefix delete.
- **New table `chat_attachments`** (migration + `pnpm kanel` in the implementing PR): `id`, `message_id` (FK `chat_messages`, cascade), `user_id`, `s3_key`, `filename`, `content_type`, `byte_size`, `created_at`. The existing `had_binary_attachments` flag on `chat_messages` stays as the cheap indicator; rows carry the detail.
- **Write path**: `ChatUseCase.execute` uploads blobs after a successful turn (best-effort — a failed upload logs and degrades to today's behavior, never fails the turn).
- **Regenerate**: instead of throwing `ChatAttachmentsNotReplayableError`, load the turn's rows, fetch blobs, rebuild the original attachment blocks. Refusal stays only when a blob is missing (deleted or pre-feature turns).
- **Follow-up turns**: regenerate-only in v1. Replaying every prior binary into every later turn multiplies token cost per turn; `attachment_text` already carries text context forward. Revisit only with user signal.
- **Retention**: 90 days, enforced by a prefix-scoped bucket lifecycle rule (`scripts/set-chat-attachments-lifecycle.ts`, run with `--apply` on the prod box in the implementation window — creds live only there). The platform rule is the backstop: a missed delete path or an orphaned object (row written, upload failed, or vice versa) degrades to 90-day exposure instead of forever, with no sweep code or cron. Regenerate on a turn older than 90 days returns the honest #4046 refusal.
- **Delete paths** (all three sweep the prefix via `StorageHandler.deleteObjects` — none touch storage today, and S3 objects do not cascade with FK rows):
  1. Account deletion (`UsersControllers`) — sweeps `chat-attachments/<userId>/` and the table; extend the account-deletion table test (`chat_attachments` in the owner-tables list from day one). GDPR delete is immediate, not lifecycle-deferred.
  2. The `delete-inactive-users` ops command — same sweep per deleted user; this path runs continuously and deletes hundreds of users a week.
  3. Conversation deletion (`DeleteAllConversationsUseCase` and any per-conversation delete) — deletes the conversation's objects alongside its rows.
- **Size budget**: cap what we persist at the existing per-request chat attachment limit; skip persistence above it (turn still works as today).

## Not building

- Follow-up-turn binary replay (v1 is regenerate-only — cost/complexity, weak signal).
- Rendering attachment previews in the conversation UI (separate surface; needs design).
- Any change to the chat request path for text-extractable attachments (`attachment_text` fold stays authoritative).
- A second storage integration — reuse `StorageHandler`.

## Acceptance

1. Regenerate on a turn with a persisted PDF/image attachment succeeds and the model sees the original file.
2. Regenerate on a pre-feature turn (no rows) still returns the honest #4046 refusal.
3. All three delete paths (account deletion, `delete-inactive-users`, conversation deletion) remove the `chat_attachments` rows and their S3 objects — account-deletion table test extended and green, plus a test per path asserting the storage sweep is called.
4. A failed S3 upload never fails the chat turn.
5. The 90-day lifecycle rule is live on the bucket (dry-run output of `scripts/set-chat-attachments-lifecycle.ts` shows `expire-chat-attachments-90d`) before the feature flag-free rollout.

## Decisions (resolved 2026-08-13)

- **Bucket**: reuse the existing Spaces bucket — prefix-scoped lifecycle makes a dedicated bucket unnecessary, and a second bucket doubles the GDPR/audit surface.
- **Retention**: 90 days via the platform lifecycle rule, not life-of-conversation. Bounds storage cost and PII-at-rest exposure, and self-heals orphaned objects with zero sweep code.
