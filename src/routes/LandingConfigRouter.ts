import express from 'express';
import LandingConfigController from '../controllers/LandingConfigController';

const LandingConfigRouter = () => {
  const controller = new LandingConfigController();
  const router = express.Router();

  /**
   * @swagger
   * /api/landing/config:
   *   get:
   *     summary: Public landing-page display config
   *     description: |
   *       Kept for tabs loaded before the landing pages always showed pass
   *       prices; the current web app does not call it. Unauthenticated and
   *       cacheable. showPassPrices is always true.
   *     tags: [Frontend]
   *     responses:
   *       200:
   *         description: Landing display config
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 showPassPrices:
   *                   type: boolean
   */
  router.get('/api/landing/config', (req, res) =>
    controller.getConfig(req, res)
  );

  return router;
};

export default LandingConfigRouter;
