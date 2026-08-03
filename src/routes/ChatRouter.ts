import express from 'express';
import multer from 'multer';
import ChatController from '../controllers/ChatController';
import ChatConsentController from '../controllers/ChatConsentController';
import ChatDeckController from '../controllers/ChatDeckController';
import ConversationsController from '../controllers/ConversationsController';
import TagCardsController from '../controllers/TagCardsController';
import { ChatUseCase } from '../usecases/chat/ChatUseCase';
import { SetChatConsentUseCase } from '../usecases/chat/SetChatConsentUseCase';
import { ChatDeckUseCase } from '../usecases/chat/ChatDeckUseCase';
import { ConversationsUseCase } from '../usecases/chat/ConversationsUseCase';
import { DeleteAllConversationsUseCase } from '../usecases/chat/DeleteAllConversationsUseCase';
import { TagCardsUseCase } from '../usecases/chat/TagCardsUseCase';
import { ChatMessagesRepository } from '../data_layer/ChatMessagesRepository';
import { ConversationsRepository } from '../data_layer/ConversationsRepository';
import UsersRepository from '../data_layer/UsersRepository';
import { getDatabase } from '../data_layer';
import { getAnthropicClient } from '../lib/claude/ClaudeService';
import RequireAuthentication from './middleware/RequireAuthentication';

const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

const ChatRouter = () => {
  const router = express.Router();
  const db = getDatabase();
  const messagesRepo = new ChatMessagesRepository(db);
  const conversationsRepo = new ConversationsRepository(db);
  const usersRepo = new UsersRepository(db);
  const anthropic = getAnthropicClient();
  const useCase = new ChatUseCase(messagesRepo, conversationsRepo, anthropic);
  const controller = new ChatController(useCase);
  const consentUseCase = new SetChatConsentUseCase(usersRepo);
  const consentController = new ChatConsentController(consentUseCase);
  const deckUseCase = new ChatDeckUseCase();
  const deckController = new ChatDeckController(deckUseCase);
  const tagCardsUseCase = new TagCardsUseCase(anthropic, messagesRepo);
  const tagCardsController = new TagCardsController(tagCardsUseCase);
  const conversationsUseCase = new ConversationsUseCase(conversationsRepo);
  const deleteAllConversationsUseCase = new DeleteAllConversationsUseCase(
    conversationsRepo,
    messagesRepo
  );
  const conversationsController = new ConversationsController(
    conversationsUseCase,
    deleteAllConversationsUseCase
  );

  /**
   * @swagger
   * /api/chat/consent:
   *   post:
   *     summary: Record chat consent for the authenticated user
   *     tags: [Chat]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       204:
   *         description: Consent recorded
   */
  router.post('/api/chat/consent', RequireAuthentication, (req, res) =>
    consentController.recordConsent(req, res)
  );

  /**
   * @swagger
   * /api/chat/message:
   *   post:
   *     summary: Send a message to the study assistant (Server-Sent Events stream)
   *     description: |
   *       Streams the assistant's reply as Server-Sent Events (`text/event-stream`).
   *       Three event names are emitted on the response, each carrying a JSON
   *       payload in the `data:` line:
   *
   *       - `event: token` — incremental assistant text. `data` is a JSON
   *         string fragment (e.g. `"Hello"`). Concatenate every `token`
   *         payload to reconstruct the full reply.
   *       - `event: done` — terminal frame for a successful turn. `data` is
   *         a JSON object matching `ChatDoneFrame` (see schemas), carrying
   *         the final assistant content, the conversation id, and, when the
   *         assistant generated flashcards, a `cards` array plus the prose
   *         that came before / after the cards.
   *       - `event: error` — terminal frame for a failure. `data` is a JSON
   *         object matching `ChatErrorFrame` (see schemas). The HTTP status
   *         is still 200 because the stream has already opened; clients must
   *         branch on the `error` frame's `type` field instead of HTTP code.
   *
   *       Each event ends with a blank line (`\n\n`). Clients that consume
   *       SSE via a line-based reader must not discard empty lines — they
   *       are the frame separator.
   *
   *       The request accepts `multipart/form-data` so the caller can attach
   *       up to 5 files totalling 25 MB. PDFs and images are sent to the
   *       model as native blocks; `.zip` (Notion export), `.docx`, `.md`, and
   *       `.txt` are parsed to text on the server and injected into the model
   *       context as `<file name="…">…</file>` blocks before the prompt runs.
   *
   *       Card-shape footgun: when the caller is a Patreon (lifetime/paid)
   *       user, the assistant may emit MCQ-shape cards even if
   *       `templateSlug=basic` is sent. `templateSlug` is a hint, not a
   *       contract — clients must be ready for both card shapes on every
   *       `done` frame. See the `ChatDoneFrame.cards` schema's `oneOf`.
   *     tags: [Chat]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [content]
   *             properties:
   *               content:
   *                 type: string
   *                 maxLength: 100000
   *               conversationId:
   *                 type: integer
   *                 nullable: true
   *               templateSlug:
   *                 type: string
   *                 nullable: true
   *                 description: |
   *                   Card template hint (`basic`, `basic-and-reversed`,
   *                   `cloze`, `mcq`). Patreon users may still receive MCQ
   *                   cards when this is `basic` — see endpoint description.
   *               history:
   *                 type: array
   *                 items:
   *                   type: object
   *                   required: [role, content]
   *                   properties:
   *                     role:
   *                       type: string
   *                       enum: [user, assistant]
   *                     content:
   *                       type: string
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required: [content]
   *             properties:
   *               content:
   *                 type: string
   *                 maxLength: 100000
   *               conversationId:
   *                 type: integer
   *                 nullable: true
   *               templateSlug:
   *                 type: string
   *                 nullable: true
   *               history:
   *                 type: string
   *                 description: |
   *                   JSON-encoded array of `{ role, content }` history
   *                   entries when sent over multipart.
   *               files:
   *                 type: array
   *                 maxItems: 5
   *                 description: |
   *                   Study-material attachments. Per-file limit 10 MB,
   *                   combined limit 25 MB. Accepted MIME types:
   *                   `application/pdf`, `image/png`, `image/jpeg`,
   *                   `image/gif`, `image/webp`, `application/zip`,
   *                   `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
   *                   `text/markdown`, `text/plain`. The zip, docx, markdown,
   *                   and plain-text types are parsed to text server-side and
   *                   injected into the model context before the prompt runs.
   *                 items:
   *                   type: string
   *                   format: binary
   *     responses:
   *       200:
   *         description: |
   *           SSE stream of `token`, `done`, and `error` events. Inspect the
   *           terminal frame to determine success or failure — the HTTP
   *           status is 200 for both outcomes once the stream is open.
   *         content:
   *           text/event-stream:
   *             schema:
   *               oneOf:
   *                 - $ref: '#/components/schemas/ChatTokenFrame'
   *                 - $ref: '#/components/schemas/ChatDoneFrame'
   *                 - $ref: '#/components/schemas/ChatErrorFrame'
   *       400:
   *         description: |
   *           Invalid request (missing `content`, content over the 100 000
   *           character cap, too many files, file too large, total
   *           attachment payload over 25 MB, or an attachment whose MIME
   *           type is not allowed). Returned as `application/json` before
   *           the SSE stream opens.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       401:
   *         description: Authentication required
   */
  router.post(
    '/api/chat/message',
    RequireAuthentication,
    chatUpload.array('files', 5),
    (req, res) => controller.sendMessage(req, res)
  );

  /**
   * @swagger
   * /api/chat/deck:
   *   post:
   *     summary: Generate an Anki deck from chat cards
   *     description: |
   *       Builds an `.apkg` from a client-supplied card list. Each card may
   *       be either the basic shape (`front` + `back`) or the MCQ shape
   *       (`front` + 4 `options` + `correctIndex`, with optional `rationale`
   *       and `tags`); the two shapes can be mixed in a single request. Per
   *       card, `tags` is an optional array of short subject tags
   *       (lower-case, hyphenated, up to 8 per card).
   *     tags: [Chat]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [cards, deckName]
   *             properties:
   *               deckName:
   *                 type: string
   *                 maxLength: 120
   *               templateSlug:
   *                 type: string
   *                 nullable: true
   *                 description: |
   *                   Card template slug (`basic`, `basic-and-reversed`,
   *                   `cloze`, `mcq`). The server still chooses the actual
   *                   note model based on card shape — MCQ-shape cards
   *                   render as MCQ regardless of this value.
   *               cards:
   *                 type: array
   *                 maxItems: 200
   *                 items:
   *                   oneOf:
   *                     - $ref: '#/components/schemas/ChatBasicCard'
   *                     - $ref: '#/components/schemas/ChatMcqCard'
   *     responses:
   *       200:
   *         description: Anki .apkg file
   *         content:
   *           application/octet-stream:
   *             schema:
   *               type: string
   *               format: binary
   *       400:
   *         description: |
   *           Invalid input. `deckName` is required and must be 120
   *           characters or fewer. `cards` must be a non-empty array of at
   *           most 200 items. Each card must be either a basic card
   *           (string `front` and string `back`) or a valid MCQ card (string
   *           `front`, an `options` array of exactly 4 non-empty strings,
   *           and an integer `correctIndex` in range `[0, 3]`). Cards that
   *           match neither shape produce
   *           `each card must have string front and back fields, or a
   *           valid MCQ shape`.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       401:
   *         description: Authentication required
   */
  router.post('/api/chat/deck', RequireAuthentication, (req, res) =>
    deckController.generate(req, res)
  );

  /**
   * @swagger
   * /api/chat/tag-cards:
   *   post:
   *     summary: Generate short subject tags for an existing set of chat cards
   *     tags: [Chat]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [cards]
   *             properties:
   *               cards:
   *                 type: array
   *                 maxItems: 200
   *                 items:
   *                   type: object
   *                   required: [front]
   *                   properties:
   *                     front: { type: string }
   *                     back: { type: string }
   *     responses:
   *       200:
   *         description: Tags per card, parallel to the input array
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 tags:
   *                   type: array
   *                   items:
   *                     type: array
   *                     items: { type: string }
   *       400:
   *         description: Invalid input
   */
  router.post('/api/chat/tag-cards', RequireAuthentication, (req, res) =>
    tagCardsController.tag(req, res)
  );

  /**
   * @swagger
   * /api/chat/usage:
   *   get:
   *     summary: Get chat usage for the current month
   *     tags: [Chat]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Usage data
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 used:
   *                   type: integer
   *                 limit:
   *                   type: integer
   *                   nullable: true
   */
  router.get('/api/chat/usage', RequireAuthentication, async (req, res) => {
    const owner = res.locals.owner as number;
    const patreon = (res.locals.patreon as boolean) ?? false;
    const subscriber = (res.locals.subscriber as boolean) ?? false;
    const count = await messagesRepo.countThisMonth(owner);
    res.status(200).json({
      used: count,
      limit: patreon || subscriber ? null : 20,
    });
  });

  /**
   * @swagger
   * /api/chat/conversations:
   *   get:
   *     summary: List the user's chat conversations
   *     tags: [Chat]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Conversation summaries, newest first
   */
  router.get('/api/chat/conversations', RequireAuthentication, (req, res) =>
    conversationsController.list(req, res)
  );

  /**
   * @swagger
   * /api/chat/conversations:
   *   delete:
   *     summary: Permanently delete every conversation and message for the user
   *     tags: [Chat]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       204:
   *         description: All conversations and messages deleted
   */
  router.delete('/api/chat/conversations', RequireAuthentication, (req, res) =>
    conversationsController.deleteAll(req, res)
  );

  /**
   * @swagger
   * /api/chat/conversations/{id}:
   *   get:
   *     summary: Load a conversation and its messages
   *     tags: [Chat]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200:
   *         description: Conversation with messages
   *       404:
   *         description: Conversation not found
   *   patch:
   *     summary: Rename a conversation
   *     tags: [Chat]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [title]
   *             properties:
   *               title:
   *                 type: string
   *                 maxLength: 120
   *     responses:
   *       204:
   *         description: Renamed
   *       400:
   *         description: Invalid title
   *       404:
   *         description: Conversation not found
   *   delete:
   *     summary: Soft-delete a conversation
   *     tags: [Chat]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       204:
   *         description: Deleted
   *       404:
   *         description: Conversation not found
   */
  router.get('/api/chat/conversations/:id', RequireAuthentication, (req, res) =>
    conversationsController.get(req, res)
  );
  router.patch(
    '/api/chat/conversations/:id',
    RequireAuthentication,
    (req, res) => conversationsController.rename(req, res)
  );
  router.delete(
    '/api/chat/conversations/:id',
    RequireAuthentication,
    (req, res) => conversationsController.delete(req, res)
  );

  /**
   * @swagger
   * /api/chat/conversations/{id}/draft:
   *   patch:
   *     summary: Save the in-progress draft for a conversation
   *     tags: [Chat]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [content]
   *             properties:
   *               content:
   *                 type: string
   *                 nullable: true
   *                 maxLength: 100000
   *     responses:
   *       204:
   *         description: Draft saved (or cleared if content is null)
   *       400:
   *         description: Invalid input
   *       404:
   *         description: Conversation not found
   */
  router.patch(
    '/api/chat/conversations/:id/draft',
    RequireAuthentication,
    (req, res) => conversationsController.saveDraft(req, res)
  );

  /**
   * @swagger
   * /api/chat/conversations/{id}/template:
   *   patch:
   *     summary: Set the card template for a conversation
   *     tags: [Chat]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [templateSlug]
   *             properties:
   *               templateSlug:
   *                 type: string
   *                 nullable: true
   *                 enum: [basic, basic-and-reversed, cloze, mcq]
   *     responses:
   *       204:
   *         description: Template saved
   *       400:
   *         description: Invalid input
   *       404:
   *         description: Conversation not found
   */
  router.patch(
    '/api/chat/conversations/:id/template',
    RequireAuthentication,
    (req, res) => conversationsController.saveTemplate(req, res)
  );

  /**
   * @swagger
   * /api/chat/conversations/{id}/regenerate:
   *   post:
   *     summary: Regenerate the last assistant turn in place (Server-Sent Events stream)
   *     description: |
   *       Deletes the most recent assistant message in the conversation and
   *       re-runs the prior user prompt against Claude under the supplied
   *       `templateSlug`, streaming the new turn back with the same SSE event
   *       shape as `POST /api/chat/message` (`token` / `done` / `error`). The
   *       prior user message is kept as-is, so the conversation does not grow a
   *       duplicate turn on reload. The per-call `templateSlug` is independent
   *       of the conversation's stored default template set via
   *       `PATCH /api/chat/conversations/{id}/template`.
   *     tags: [Chat]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               templateSlug:
   *                 type: string
   *                 nullable: true
   *                 enum: [basic, basic-and-reversed, cloze, mcq]
   *     responses:
   *       200:
   *         description: |
   *           SSE stream of `token`, `done`, and `error` events, identical to
   *           `POST /api/chat/message`.
   *         content:
   *           text/event-stream:
   *             schema:
   *               oneOf:
   *                 - $ref: '#/components/schemas/ChatTokenFrame'
   *                 - $ref: '#/components/schemas/ChatDoneFrame'
   *                 - $ref: '#/components/schemas/ChatErrorFrame'
   *       400:
   *         description: Invalid conversation id
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       401:
   *         description: Authentication required
   */
  router.post(
    '/api/chat/conversations/:id/regenerate',
    RequireAuthentication,
    (req, res) => controller.regenerateMessage(req, res)
  );

  return router;
};

export default ChatRouter;
