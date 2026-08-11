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
- **Retention**: life of the conversation. Deleting a conversation deletes its rows + objects; account deletion sweeps the `chat-attachments/<userId>/` prefix and the table (extend the account-deletion table test — `chat_attachments` must be in the owner-tables list from day one).
- **Size budget**: cap what we persist at the existing per-request chat attachment limit; skip persistence above it (turn still works as today).

## Not building

- Follow-up-turn binary replay (v1 is regenerate-only — cost/complexity, weak signal).
- Rendering attachment previews in the conversation UI (separate surface; needs design).
- Any change to the chat request path for text-extractable attachments (`attachment_text` fold stays authoritative).
- A second storage integration — reuse `StorageHandler`.

## Acceptance

1. Regenerate on a turn with a persisted PDF/image attachment succeeds and the model sees the original file.
2. Regenerate on a pre-feature turn (no rows) still returns the honest #4046 refusal.
3. Deleting the account removes the `chat_attachments` rows and the S3 prefix — account-deletion table test extended and green.
4. A failed S3 upload never fails the chat turn.

## Open decisions for Alexander

- Bucket reuse vs a dedicated bucket for user study documents (spec assumes reuse of the existing Spaces bucket).
- Retention: spec says life-of-conversation; a time cap (e.g. 90 days) is the alternative if storage cost matters.
