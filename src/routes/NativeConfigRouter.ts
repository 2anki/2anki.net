import express from 'express';
import NativeConfigController from '../controllers/NativeConfigController';

const NativeConfigRouter = () => {
  const controller = new NativeConfigController();
  const router = express.Router();

  /**
   * @swagger
   * /api/native/config:
   *   get:
   *     summary: Public config for the native app
   *     description: |
   *       Unauthenticated and cacheable for 60 seconds; the native app reads it
   *       signed in or not. cardLimitEnabled is the native_card_limit feature
   *       flag, the kill switch for the on-device monthly card limit; it is
   *       true unless the flag is explicitly off. monthlyCardLimit is the free
   *       monthly card cap the web enforces, and previewCardCount is how many
   *       cards a deck over the cap exports before the rest is held.
   *     tags: [System]
   *     responses:
   *       200:
   *         description: Native app config
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 cardLimitEnabled:
   *                   type: boolean
   *                   example: true
   *                 monthlyCardLimit:
   *                   type: integer
   *                   example: 100
   *                 previewCardCount:
   *                   type: integer
   *                   example: 21
   */
  router.get('/api/native/config', (req, res) =>
    controller.getConfig(req, res)
  );

  return router;
};

export default NativeConfigRouter;
