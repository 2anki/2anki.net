import express from 'express';

import FavoritesController from '../controllers/FavoritesController';
import { getDatabase } from '../data_layer';
import { FavoritesRepository } from '../data_layer/FavoritesRepository';
import FavoriteService from '../services/FavoriteService';
import RequireAuthentication from './middleware/RequireAuthentication';

const FavoriteRouter = () => {
  const router = express.Router();
  const controller = new FavoritesController(
    new FavoriteService(new FavoritesRepository(getDatabase()))
  );

  /**
   * @swagger
   * /api/favorite/create:
   *   post:
   *     summary: Create favorite
   *     description: Add a new item to the user's favorites list
   *     tags: [Favorites]
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
   *               - type
   *               - data
   *             properties:
   *               type:
   *                 type: string
   *                 enum: [upload, template, notion_page]
   *                 description: Type of item to favorite
   *               data:
   *                 type: object
   *                 description: Data about the favorite item
   *               title:
   *                 type: string
   *                 description: Display title for the favorite
   *     responses:
   *       201:
   *         description: Favorite created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: integer
   *                   description: Favorite ID
   *                 message:
   *                   type: string
   *                   description: Success message
   *       400:
   *         description: Invalid request data
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
  router.post('/api/favorite/create', RequireAuthentication, (req, res) =>
    controller.createFavorite(req, res)
  );

  /**
   * @swagger
   * /api/favorite/remove:
   *   post:
   *     summary: Remove favorite
   *     description: Remove an item from the user's favorites list
   *     tags: [Favorites]
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
   *               - id
   *             properties:
   *               id:
   *                 type: integer
   *                 description: Favorite ID to remove
   *     responses:
   *       200:
   *         description: Favorite removed successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Success'
   *       400:
   *         description: Invalid favorite ID
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
  router.post('/api/favorite/remove', RequireAuthentication, (req, res) =>
    controller.deleteFavorite(req, res)
  );

  /**
   * @swagger
   * /api/favorite:
   *   get:
   *     summary: Get user favorites
   *     description: Retrieve all favorite items for the authenticated user
   *     tags: [Favorites]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Favorites retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id:
   *                     type: integer
   *                     description: Favorite ID
   *                   type:
   *                     type: string
   *                     enum: [upload, template, notion_page]
   *                     description: Type of favorite item
   *                   title:
   *                     type: string
   *                     description: Display title
   *                   data:
   *                     type: object
   *                     description: Item data
   *                   created_at:
   *                     type: string
   *                     format: date-time
   *                     description: When the favorite was created
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get(
    '/api/favorite',
    RequireAuthentication,
    (request: express.Request, response: express.Response) => {
      controller.getFavorites(request, response);
    }
  );

  return router;
};

export default FavoriteRouter;
