import express from 'express';
import multer from 'multer';
import RequireAuthentication, {
  OptionalAuthentication,
} from './middleware/RequireAuthentication';
import ImageOcclusionController from '../controllers/ImageOcclusionController';
import { IoDraftController } from '../controllers/IoDraftController';
import { PhotoToFlashcardsController } from '../controllers/PhotoToFlashcardsController';
import { CreateImageOcclusionDeckUseCase } from '../usecases/imageOcclusion/CreateImageOcclusionDeckUseCase';
import { PhotoToFlashcardsUseCase } from '../usecases/imageOcclusion/PhotoToFlashcardsUseCase';
import { IoDraftRepository } from '../data_layer/IoDraftRepository';
import NotionRepository from '../data_layer/NotionRespository';
import { EventsRepository } from '../data_layer/EventsRepository';
import { getDatabase } from '../data_layer';
import StorageHandler from '../lib/storage/StorageHandler';

const ImageOcclusionRouter = () => {
  const router = express.Router();
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const upload = multer({
    dest: '/tmp',
    fileFilter: (_req, file, cb) => {
      cb(null, ALLOWED.includes(file.mimetype));
    },
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  const oc = new ImageOcclusionController(
    new CreateImageOcclusionDeckUseCase()
  );
  const dc = new IoDraftController(
    new IoDraftRepository(getDatabase()),
    new StorageHandler(),
    new NotionRepository(getDatabase())
  );
  const ptf = new PhotoToFlashcardsController(
    new PhotoToFlashcardsUseCase(new EventsRepository(getDatabase()))
  );

  /**
   * @swagger
   * /api/image-occlusion:
   *   post:
   *     summary: Generate an image occlusion Anki deck
   *     tags: [ImageOcclusion]
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               images:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *     responses:
   *       200:
   *         description: Anki deck generated
   */
  // Open to guests, but the paying gate in the controller reads res.locals,
  // which only the auth middleware populates. Without it every download was
  // free-capped at 3 images, subscribers included (#4287).
  router.post(
    '/api/image-occlusion',
    OptionalAuthentication,
    upload.array('images', 20),
    (req, res) => oc.create(req, res)
  );

  /**
   * @swagger
   * /api/image-occlusion/draft/image:
   *   post:
   *     summary: Upload an image for an occlusion draft
   *     tags: [ImageOcclusion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               image:
   *                 type: string
   *                 format: binary
   *     responses:
   *       200:
   *         description: Image uploaded, returns s3Key and presignedUrl
   *       401:
   *         description: Authentication required
   */
  router.post(
    '/api/image-occlusion/draft/image',
    RequireAuthentication,
    upload.single('image'),
    (req, res) => dc.uploadImage(req, res)
  );

  /**
   * @swagger
   * /api/image-occlusion/draft:
   *   post:
   *     summary: Create a new occlusion draft
   *     tags: [ImageOcclusion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       201:
   *         description: Draft created, returns id
   *       401:
   *         description: Authentication required
   */
  router.post(
    '/api/image-occlusion/draft',
    RequireAuthentication,
    express.json(),
    (req, res) => dc.create(req, res)
  );

  /**
   * @swagger
   * /api/image-occlusion/draft/{id}:
   *   put:
   *     summary: Update an occlusion draft
   *     tags: [ImageOcclusion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Draft updated
   *       401:
   *         description: Authentication required
   */
  router.put(
    '/api/image-occlusion/draft/:id',
    RequireAuthentication,
    express.json(),
    (req, res) => dc.update(req, res)
  );

  /**
   * @swagger
   * /api/image-occlusion/drafts:
   *   get:
   *     summary: List occlusion drafts for the authenticated user
   *     tags: [ImageOcclusion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: List of drafts
   *       401:
   *         description: Authentication required
   */
  router.get('/api/image-occlusion/drafts', RequireAuthentication, (req, res) =>
    dc.list(req, res)
  );

  /**
   * @swagger
   * /api/image-occlusion/draft/{id}:
   *   get:
   *     summary: Get a single occlusion draft
   *     tags: [ImageOcclusion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Draft data with presigned image URLs
   *       401:
   *         description: Authentication required
   *       404:
   *         description: Draft not found
   */
  router.get(
    '/api/image-occlusion/draft/:id',
    RequireAuthentication,
    (req, res) => dc.get(req, res)
  );

  /**
   * @swagger
   * /api/image-occlusion/draft/{id}:
   *   delete:
   *     summary: Delete an occlusion draft and its S3 images
   *     tags: [ImageOcclusion]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Draft deleted
   *       401:
   *         description: Authentication required
   */
  router.delete(
    '/api/image-occlusion/draft/:id',
    RequireAuthentication,
    (req, res) => dc.remove(req, res)
  );

  /**
   * @swagger
   * /api/image-occlusion/photo-to-deck:
   *   post:
   *     summary: Generate an Anki deck from a photo via Claude Vision
   *     tags: [ImageOcclusion]
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
   *               imageBase64:
   *                 type: string
   *               mediaType:
   *                 type: string
   *               deckName:
   *                 type: string
   *               width:
   *                 type: number
   *               height:
   *                 type: number
   *     responses:
   *       200:
   *         description: Anki deck generated
   *       400:
   *         description: Invalid input
   *       401:
   *         description: Authentication required
   *       403:
   *         description: Ankify access required
   *       413:
   *         description: Image too large
   */
  router.post(
    '/api/image-occlusion/photo-to-deck',
    RequireAuthentication,
    express.json({ limit: '20mb' }),
    (req, res) => ptf.create(req, res)
  );

  /**
   * @swagger
   * /api/image-occlusion/draft/notion-image:
   *   post:
   *     summary: Import images from Notion blocks into an occlusion draft
   *     tags: [ImageOcclusion]
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
   *               blockIds:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       200:
   *         description: Array of uploaded images with s3Key and presignedUrl
   *       400:
   *         description: Invalid blockIds
   *       401:
   *         description: Authentication required or Notion not connected
   */
  router.post(
    '/api/image-occlusion/draft/notion-image',
    RequireAuthentication,
    express.json(),
    (req, res) => dc.importFromNotion(req, res)
  );

  return router;
};
export default ImageOcclusionRouter;
