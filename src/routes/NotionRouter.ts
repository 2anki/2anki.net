import express from 'express';

import RequireAuthentication, {
  OptionalAuthentication,
} from './middleware/RequireAuthentication';
import RequirePaying from './middleware/RequirePaying';
import NotionController from '../controllers/NotionController';
import NotionRepository from '../data_layer/NotionRespository';
import NotionTopLevelPagesRepository from '../data_layer/NotionTopLevelPagesRepository';
import BlocksCacheRepository from '../data_layer/BlocksCacheRepository';
import NotionService from '../services/NotionService';
import { getDatabase } from '../data_layer';
import UsersRepository from '../data_layer/UsersRepository';
import { getDefaultEmailService } from '../services/EmailService/EmailService';

const NotionRouter = () => {
  const router = express.Router();

  const database = getDatabase();
  const repository = new NotionRepository(database);
  const topLevelPagesRepository = new NotionTopLevelPagesRepository(database);
  const blocksCacheRepository = new BlocksCacheRepository(database);
  const controller = new NotionController(
    new NotionService(
      repository,
      topLevelPagesRepository,
      blocksCacheRepository
    ),
    repository,
    new UsersRepository(database),
    getDefaultEmailService()
  );

  /**
   * Endpoint for establishing a connection to Notion. We need a token for this.
   * Reference: https://developers.notion.so/
   */
  /**
   * @swagger
   * /api/notion/connect:
   *   get:
   *     summary: Connect to Notion
   *     description: Establish a connection to Notion using OAuth. Redirects to Notion authorization page.
   *     tags: [Notion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       302:
   *         description: Redirect to Notion OAuth authorization
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get('/api/notion/connect', OptionalAuthentication, (req, res) =>
    controller.connect(req, res)
  );

  /**
   * @swagger
   * /api/notion/connect/init:
   *   get:
   *     summary: Start a web Notion connect
   *     description: Sets a ten-minute notion_connect_state cookie and redirects to Notion's authorize page with state connect:<nonce>. /api/notion/connect refuses a web callback whose state does not match the cookie.
   *     tags: [Notion]
   *     responses:
   *       302:
   *         description: Redirect to Notion OAuth, or to /notion when Notion is not configured
   */
  router.get('/api/notion/connect/init', (req, res) =>
    controller.startConnect(req, res)
  );

  /**
   * @swagger
   * /api/notion/pages:
   *   post:
   *     summary: Search Notion pages
   *     description: Search for pages in the user's connected Notion workspace
   *     tags: [Notion]
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
   *               query:
   *                 type: string
   *                 description: Search query for pages
   *               filter:
   *                 type: object
   *                 description: Filter criteria for pages
   *     responses:
   *       200:
   *         description: Pages found successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/NotionSearchResults'
   *       401:
   *         description: Authentication required or Notion not connected
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post('/api/notion/pages', RequireAuthentication, (req, res) =>
    controller.search(req, res)
  );

  /**
   * @swagger
   * /api/notion/top-level-pages:
   *   post:
   *     summary: Search Notion for top-level titled pages only
   *     description: Excludes databases, database rows, and untitled pages. Paginates Notion's search until up to 50 useful entries are collected. Used by the Ankify "Find pages" and "Where should we put it?" pickers so users see real container pages instead of a wall of database rows.
   *     tags: [Notion]
   *     responses:
   *       200:
   *         description: Top-level pages
   *       401:
   *         description: Authentication required or Notion not connected
   */
  router.post(
    '/api/notion/top-level-pages',
    RequireAuthentication,
    (req, res) => controller.searchTopLevelPages(req, res)
  );

  /**
   * @swagger
   * /api/notion/login:
   *   get:
   *     deprecated: true
   *     summary: Deprecated — use GET /api/notion/get-notion-link
   *     description: |
   *       There is no `/api/notion/login` endpoint. Integrators sometimes
   *       guess this URL because OAuth flows are commonly called "login"
   *       elsewhere; hitting it returns 404. The endpoint that returns the
   *       Notion OAuth authorization URL is `GET /api/notion/get-notion-link`.
   *     tags: [Notion]
   *     responses:
   *       404:
   *         description: Not found. Call GET /api/notion/get-notion-link instead.
   */

  /**
   * @swagger
   * /api/notion/get-notion-link:
   *   get:
   *     summary: Get the Notion connect link
   *     description: |
   *       Returns the link that starts a Notion connect: the same-origin
   *       path /api/notion/connect/init for web callers, or the Notion
   *       OAuth authorization URL for client=native. The link itself is
   *       public — anonymous and expired-session users still get back a
   *       working URL so the "Connect to Notion" button never goes inert.
   *       `isConnected` and `workspace` are only populated when the caller
   *       has a valid session.
   *
   *       Note: there is no `/api/notion/login` endpoint. Some integrators
   *       guess that path because OAuth flows are commonly called "login";
   *       this endpoint is the canonical one.
   *     tags: [Notion]
   *     parameters:
   *       - in: query
   *         name: client
   *         required: false
   *         schema:
   *           type: string
   *           enum: [native]
   *         description: |
   *           Pass `native` to get a link whose OAuth state is bound to the
   *           authenticated user for the native app flow. Requires a valid
   *           session — anonymous callers receive 401.
   *     responses:
   *       200:
   *         description: Notion link retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 link:
   *                   type: string
   *                   description: |
   *                     Web: the same-origin path /api/notion/connect/init,
   *                     which binds the OAuth state to the browser and
   *                     redirects to Notion. client=native: the Notion OAuth
   *                     authorization URL with a signed native state.
   *                 isConnected:
   *                   type: boolean
   *                   description: Whether user is connected to Notion
   *                 workspace:
   *                   type: string
   *                   nullable: true
   *                   description: Connected workspace name
   *       401:
   *         description: |
   *           Returned only for `client=native` without a valid session. The
   *           native OAuth state is bound to the user, so authentication is
   *           required. Body carries `code: auth_required_for_native`.
   */
  router.get(
    '/api/notion/get-notion-link',
    OptionalAuthentication,
    (req, res) => controller.getNotionLink(req, res)
  );

  /**
   * @swagger
   * /api/notion/convert/:
   *   post:
   *     summary: Convert Notion page to Anki
   *     description: Convert a Notion page to Anki flashcards
   *     tags: [Notion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - pageId
   *             properties:
   *               pageId:
   *                 type: string
   *                 description: Notion page ID to convert
   *               options:
   *                 type: object
   *                 description: Conversion options
   *                 properties:
   *                   deckName:
   *                     type: string
   *                     description: Name for the Anki deck
   *                   basicReversed:
   *                     type: boolean
   *                     description: Create reversed cards
   *                   tags:
   *                     type: array
   *                     items:
   *                       type: string
   *                     description: Tags to add to cards
   *     responses:
   *       200:
   *         description: Conversion started successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 jobId:
   *                   type: string
   *                   description: Conversion job ID
   *                 message:
   *                   type: string
   *                   description: Success message
   *       400:
   *         description: Invalid page ID or conversion failed
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post('/api/notion/convert/', RequireAuthentication, (req, res) =>
    controller.convert(req, res)
  );

  /**
   * @swagger
   * /api/notion/page/{id}:
   *   get:
   *     summary: Get Notion page
   *     description: Retrieve a specific Notion page by ID
   *     tags: [Notion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Notion page ID
   *     responses:
   *       200:
   *         description: Page retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/NotionPage'
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Page not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get('/api/notion/page/:id', RequireAuthentication, (req, res) =>
    controller.getPage(req, res)
  );

  /**
   * @swagger
   * /api/notion/preview/{id}:
   *   get:
   *     summary: Stream a preview of a Notion page
   *     description: Cursor-paginated preview of a Notion page. Pre-rendered HTML per block for fast first-paint. Call with no cursor for the first batch (includes pageTitle); subsequent calls pass the returned nextCursor.
   *     tags: [Notion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: cursor
   *         schema: { type: string }
   *       - in: query
   *         name: page_size
   *         schema: { type: integer, default: 15, maximum: 50 }
   *     responses:
   *       200:
   *         description: Preview batch
   *       404:
   *         description: Page not found
   */
  router.get('/api/notion/preview/:id', RequireAuthentication, (req, res) =>
    controller.previewPage(req, res)
  );

  /**
   * @swagger
   * /api/notion/blocks/{id}:
   *   get:
   *     summary: Get page blocks
   *     description: Retrieve all blocks from a Notion page
   *     tags: [Notion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Notion page ID
   *     responses:
   *       200:
   *         description: Blocks retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 results:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                         description: Block ID
   *                       type:
   *                         type: string
   *                         description: Block type (paragraph, heading_1, etc.)
   *                       content:
   *                         type: object
   *                         description: Block content
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get('/api/notion/blocks/:id', RequireAuthentication, (req, res) =>
    controller.getBlocks(req, res)
  );

  /**
   * @swagger
   * /api/notion/block/{id}:
   *   get:
   *     summary: Get specific block
   *     description: Retrieve a specific block by ID
   *     tags: [Notion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Notion block ID
   *     responses:
   *       200:
   *         description: Block retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   *                   description: Block ID
   *                 type:
   *                   type: string
   *                   description: Block type
   *                 content:
   *                   type: object
   *                   description: Block content
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Block not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *   post:
   *     summary: Create or update block
   *     description: Create or update a Notion block with new content
   *     tags: [Notion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Block ID to create or update
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               content:
   *                 type: object
   *                 description: Block content data
   *               type:
   *                 type: string
   *                 description: Block type (paragraph, heading, etc.)
   *     responses:
   *       200:
   *         description: Block created or updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   *                   description: Block ID
   *                 message:
   *                   type: string
   *                   description: Success message
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Block not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *   delete:
   *     summary: Delete block
   *     description: Delete a Notion block (requires paid subscription)
   *     tags: [Notion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Block ID to delete
   *     responses:
   *       200:
   *         description: Block deleted successfully
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
   *       403:
   *         description: Paid subscription required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Block not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get('/api/notion/block/:id', RequireAuthentication, (req, res) =>
    controller.getBlock(req, res)
  );

  router.post('/api/notion/block/:id', RequireAuthentication, (req, res) =>
    controller.createBlock(req, res)
  );

  router.delete('/api/notion/block/:id', RequirePaying, (req, res) =>
    controller.deleteBlock(req, res)
  );

  /**
   * @swagger
   * /api/notion/render-block/{id}:
   *   get:
   *     summary: Render block as HTML
   *     description: Render a Notion block as HTML (requires paid subscription)
   *     tags: [Notion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Block ID to render
   *     responses:
   *       200:
   *         description: Block rendered successfully
   *         content:
   *           text/html:
   *             schema:
   *               type: string
   *               description: Rendered HTML content
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       403:
   *         description: Paid subscription required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Block not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get('/api/notion/render-block/:id', RequirePaying, (req, res) =>
    controller.renderBlock(req, res)
  );

  /**
   * @swagger
   * /api/notion/database/{id}:
   *   get:
   *     summary: Get Notion database
   *     description: Retrieve information about a Notion database
   *     tags: [Notion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Database ID
   *     responses:
   *       200:
   *         description: Database retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/NotionDatabase'
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Database not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get('/api/notion/database/:id', RequireAuthentication, (req, res) =>
    controller.getDatabase(req, res)
  );

  /**
   * @swagger
   * /api/notion/database/{id}/preview:
   *   get:
   *     summary: Read-only preview of a Notion database
   *     description: Returns the database title, column names, server-inferred Front/Back mapping, and up to 10 sample rows. Used by the /preview/database/:id page so users can inspect a database before queueing a conversion.
   *     tags: [Notion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Preview payload
   *       404:
   *         description: Database not found
   */
  router.get(
    '/api/notion/database/:id/preview',
    RequireAuthentication,
    (req, res) => controller.previewDatabase(req, res)
  );

  /**
   * @swagger
   * /api/notion/database/query/{id}:
   *   get:
   *     summary: Query Notion database
   *     description: Query a Notion database to retrieve pages/entries
   *     tags: [Notion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Database ID to query
   *       - in: query
   *         name: filter
   *         schema:
   *           type: string
   *         description: Filter criteria (JSON string)
   *       - in: query
   *         name: sorts
   *         schema:
   *           type: string
   *         description: Sort criteria (JSON string)
   *       - in: query
   *         name: page_size
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 50
   *         description: Number of results per page
   *     responses:
   *       200:
   *         description: Database queried successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 results:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                         description: Page ID
   *                       properties:
   *                         type: object
   *                         description: Page properties
   *                 has_more:
   *                   type: boolean
   *                   description: Whether there are more results
   *                 next_cursor:
   *                   type: string
   *                   description: Cursor for next page
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Database not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get(
    '/api/notion/database/query/:id',
    RequireAuthentication,
    (req, res) => controller.queryDatabase(req, res)
  );

  /**
   * @swagger
   * /api/notion/disconnect:
   *   post:
   *     summary: Disconnect from Notion
   *     description: Disconnect the user's Notion integration and remove stored tokens
   *     tags: [Notion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Disconnected from Notion successfully
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
  router.post('/api/notion/disconnect', RequireAuthentication, (req, res) =>
    controller.disconnect(req, res)
  );

  return router;
};

export default NotionRouter;
