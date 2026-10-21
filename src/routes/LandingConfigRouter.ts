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
   *       Returns the display toggles the public landing pages read before
   *       rendering optional blocks. Unauthenticated and cacheable. Today the
   *       only field is showPassPrices, resolved from the landing_pass_prices
   *       feature flag; it is false unless the flag is explicitly on, so a
   *       missing flag never changes what visitors see.
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
