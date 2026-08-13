import { Request, Response } from 'express';

import StorageHandler from '../lib/storage/StorageHandler';
import {
  CreateMindmapUseCase,
  MindmapLimitError,
} from '../usecases/mindmaps/CreateMindmapUseCase';
import { UpdateMindmapUseCase } from '../usecases/mindmaps/UpdateMindmapUseCase';
import { DeleteMindmapUseCase } from '../usecases/mindmaps/DeleteMindmapUseCase';
import { ListMindmapsUseCase } from '../usecases/mindmaps/ListMindmapsUseCase';
import { GetMindmapUseCase } from '../usecases/mindmaps/GetMindmapUseCase';
import {
  ExportMindmapUseCase,
  MindmapCardType,
  MindmapNotFoundError,
} from '../usecases/mindmaps/ExportMindmapUseCase';
import {
  UploadMindmapImageUseCase,
  MindmapImageTooLargeError,
  MindmapImageTypeError,
} from '../usecases/mindmaps/UploadMindmapImageUseCase';
import { MindmapsId } from '../data_layer/public/Mindmaps';
import { UsersId } from '../data_layer/public/Users';
import {
  AnkifyAccessUser,
  AnkifyAccessSubscription,
} from '../lib/ankify/access';
import { isPaying } from '../lib/isPaying';
import SubscriptionService from '../services/SubscriptionService';

export class MindmapController {
  constructor(
    private readonly createUseCase: CreateMindmapUseCase,
    private readonly updateUseCase: UpdateMindmapUseCase,
    private readonly deleteUseCase: DeleteMindmapUseCase,
    private readonly listUseCase: ListMindmapsUseCase,
    private readonly getUseCase: GetMindmapUseCase,
    private readonly exportUseCase: ExportMindmapUseCase,
    private readonly storage: StorageHandler
  ) {}

  private async resolveUserContext(res: Response): Promise<{
    userId: UsersId;
    user: AnkifyAccessUser;
    subscriptions: AnkifyAccessSubscription[];
    autoSyncProductId: string;
    isPaying: boolean;
  }> {
    const email = res.locals.email as string | undefined;
    const subscriptions = email
      ? await SubscriptionService.getUserActiveSubscriptions(email)
      : [];
    return {
      userId: res.locals.owner as UsersId,
      user: {
        patreon: (res.locals.patreon as boolean | null | undefined) ?? null,
      },
      subscriptions,
      autoSyncProductId: process.env.AUTO_SYNC_PRODUCT_ID ?? '',
      isPaying: isPaying(res.locals),
    };
  }

  private resolveCardType(raw: unknown): MindmapCardType {
    if (raw === 'cloze') return 'cloze';
    if (raw === 'markmap') return 'markmap';
    return 'basic';
  }

  async list(_req: Request, res: Response) {
    const { userId, user, subscriptions, autoSyncProductId, isPaying } =
      await this.resolveUserContext(res);

    const result = await this.listUseCase.execute({
      userId,
      user,
      subscriptions,
      autoSyncProductId,
      isPaying,
    });
    res.status(200).json(result);
  }

  async create(req: Request, res: Response) {
    const { userId, user, subscriptions, autoSyncProductId, isPaying } =
      await this.resolveUserContext(res);
    const rawTitle =
      typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const title = rawTitle.length > 0 ? rawTitle : 'Untitled';

    try {
      const map = await this.createUseCase.execute({
        userId,
        title,
        user,
        subscriptions,
        autoSyncProductId,
        isPaying,
      });
      res.status(201).json(map);
    } catch (error) {
      if (error instanceof MindmapLimitError) {
        res.status(402).json({ message: error.message });
        return;
      }
      throw error;
    }
  }

  async getById(req: Request, res: Response) {
    const userId = res.locals.owner as UsersId;
    const id = req.params.id as MindmapsId;
    const map = await this.getUseCase.execute(id, userId);
    if (map == null) {
      res.status(404).json({ message: 'Mind map not found' });
      return;
    }
    res.status(200).json(map);
  }

  async update(req: Request, res: Response) {
    const { userId, user, subscriptions, autoSyncProductId, isPaying } =
      await this.resolveUserContext(res);
    const id = req.params.id as MindmapsId;
    const title =
      req.body?.title != null ? String(req.body.title).trim() : undefined;
    const data = req.body?.data ?? undefined;

    try {
      const map = await this.updateUseCase.execute({
        id,
        userId,
        title,
        data,
        user,
        subscriptions,
        autoSyncProductId,
        isPaying,
      });
      if (map == null) {
        res.status(404).json({ message: 'Mind map not found' });
        return;
      }
      res.status(200).json(map);
    } catch (error) {
      if (error instanceof MindmapLimitError) {
        res.status(402).json({ message: error.message });
        return;
      }
      throw error;
    }
  }

  async remove(req: Request, res: Response) {
    const userId = res.locals.owner as UsersId;
    const id = req.params.id as MindmapsId;
    await this.deleteUseCase.execute(id, userId);
    res.status(204).send();
  }

  async exportDeck(req: Request, res: Response) {
    const userId = res.locals.owner as UsersId;
    const id = req.params.id as MindmapsId;
    const deckName =
      typeof req.body?.deck_name === 'string' &&
      req.body.deck_name.trim().length > 0
        ? req.body.deck_name.trim()
        : undefined;
    const cardType = this.resolveCardType(req.body?.card_type);

    try {
      const { buffer, excludedNodeCount } = await this.exportUseCase.execute({
        id,
        userId,
        deckName,
        cardType,
      });
      const fileName = `${(deckName ?? id).replace(/[^a-zA-Z0-9._-]/g, '_')}.apkg`;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileName}"`
      );
      res.setHeader('X-Excluded-Node-Count', String(excludedNodeCount));
      res.status(200).send(buffer);
    } catch (error) {
      if (error instanceof MindmapNotFoundError) {
        res.status(404).json({ message: 'Mind map not found' });
        return;
      }
      throw error;
    }
  }

  async uploadImage(req: Request, res: Response) {
    const userId = String(res.locals.owner as UsersId);
    const mapId = req.params.id;
    const file = req.file;

    if (file == null) {
      res.status(400).json({ message: 'No image file provided' });
      return;
    }

    const useCase = new UploadMindmapImageUseCase(this.storage);

    try {
      const result = await useCase.execute({
        userId,
        mapId,
        file: { buffer: file.buffer, mimetype: file.mimetype, size: file.size },
      });
      res.status(201).json({
        url: result.presignedUrl,
        width: result.width,
        height: result.height,
      });
    } catch (error) {
      if (error instanceof MindmapImageTypeError) {
        res.status(415).json({ message: error.message });
        return;
      }
      if (error instanceof MindmapImageTooLargeError) {
        res.status(413).json({ message: error.message });
        return;
      }
      throw error;
    }
  }

  async serveImage(req: Request, res: Response): Promise<void> {
    const { userId, mapId, file } = req.params;
    const authenticatedUserId = res.locals.owner as number;

    if (Number(userId) !== authenticatedUserId) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }

    const s3Key = `mindmaps/${userId}/${mapId}/${file}`;

    const exists = await this.storage.objectExists(s3Key);
    if (exists) {
      const presignedUrl = await this.storage.getPresignedUrl(s3Key);
      res.redirect(302, presignedUrl);
      return;
    }

    res
      .status(410)
      .json({ code: 'image_missing', message: 'Image no longer available' });
  }
}
