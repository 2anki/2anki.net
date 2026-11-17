import express from 'express';

import RequireAuthentication from './middleware/RequireAuthentication';
import RulesController from '../controllers/ParserRulesController';
import ParserRulesRepository from '../data_layer/ParserRulesRepository';
import ParserRulesService from '../services/ParserRulesService';
import { getDatabase } from '../data_layer';

const ParserRulesRouter = () => {
  const database = getDatabase();
  const repository = new ParserRulesRepository(database);
  const service = new ParserRulesService(repository);
  const controller = new RulesController(service);
  const router = express.Router();

  /**
   * @swagger
   * /api/rules/find/{id}:
   *   get:
   *     summary: Find parser rule
   *     description: Retrieve a specific parser rule by ID for the authenticated user
   *     tags: [Parser Rules]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Parser rule ID
   *     responses:
   *       200:
   *         description: The signed-in account's rules for the page, or an empty body when it has none
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 flashcard_is:
   *                   type: string
   *                   description: Comma-separated block types turned into flashcards
   *                 deck_is:
   *                   type: string
   *                   description: Comma-separated block types that start a deck
   *                 sub_deck_is:
   *                   type: string
   *                   description: Comma-separated block types that start a sub-deck
   *                 tags_is:
   *                   type: string
   *                   description: Where tags come from
   *                 email_notification:
   *                   type: boolean
   *                   description: Whether to email when the conversion finishes
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get('/api/rules/find/:id', RequireAuthentication, (req, res) =>
    controller.findRule(req, res)
  );

  /**
   * @swagger
   * /api/rules/create/{id}:
   *   post:
   *     summary: Create parser rule
   *     description: Create a new parser rule for text processing and card generation
   *     tags: [Parser Rules]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Context ID for the rule
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - pattern
   *               - replacement
   *             properties:
   *               name:
   *                 type: string
   *                 description: Rule name
   *               pattern:
   *                 type: string
   *                 description: Regular expression pattern to match
   *               replacement:
   *                 type: string
   *                 description: Replacement text or pattern
   *               enabled:
   *                 type: boolean
   *                 default: true
   *                 description: Whether rule is enabled
   *               priority:
   *                 type: integer
   *                 description: Rule execution priority
   *     responses:
   *       201:
   *         description: Parser rule created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   *                   description: Created rule ID
   *                 message:
   *                   type: string
   *                   description: Success message
   *       400:
   *         description: No flashcard types, or a flashcard type the Rules page does not offer
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
  router.post('/api/rules/create/:id', RequireAuthentication, (req, res) =>
    controller.createRule(req, res)
  );

  /**
   * @swagger
   * /api/rules/{id}:
   *   delete:
   *     summary: Delete parser rule
   *     description: Remove the parser rule row for the given object ID, scoped to the authenticated owner. Idempotent — returns 204 whether or not a row was deleted.
   *     tags: [Parser Rules]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Object ID whose parser rule should be removed
   *     responses:
   *       204:
   *         description: Parser rule deleted (or did not exist)
   *       400:
   *         description: Missing object ID
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
  router.delete('/api/rules/:id', RequireAuthentication, (req, res) =>
    controller.deleteRule(req, res)
  );

  return router;
};

export default ParserRulesRouter;
