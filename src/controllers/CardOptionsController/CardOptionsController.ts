import { Request, Response } from 'express';
import { getNotionObjectTitle } from 'get-notion-object-title';
import { IServiceSettings } from '../../services/SettingsService';
import { NotionService } from '../../services/NotionService/NotionService';
import { getOwner } from '../../lib/User/getOwner';
import supportedOptions from './supportedOptions';
import CardOption from '../../lib/parser/Settings/CardOption';
import { unwrapStoredSettingsPayload } from '../../lib/parser/Settings/unwrapStoredSettingsPayload';
import { CardOptionDetail } from './CardOptionDetail';
import { sanitizeForLog } from '../../lib/log/sanitizeForLog';

interface DeleteAllUseCase {
  execute(owner: string): Promise<void>;
}

class CardOptionsController {
  constructor(
    private readonly service: IServiceSettings,
    private readonly notionService?: NotionService,
    private readonly deleteAllUseCase?: DeleteAllUseCase
  ) {}

  async createSetting(req: Request, res: Response) {
    console.info(`/settings/create ${sanitizeForLog(req.params.id)}`);
    const { settings } = req.body;
    const owner = getOwner(res);

    try {
      await this.service.create({
        owner: owner,
        payload: settings.payload,
        object_id: settings.object_id,
        title: settings.title ?? null,
      });
      res.status(200).send();
    } catch (error) {
      console.info('Create setting failed');
      console.error(error);
      res.status(400).send();
    }
  }

  async deleteSetting(req: Request, res: Response) {
    const owner = getOwner(res);
    const { id } = req.params;

    try {
      await this.service.delete(owner, id);
      res.status(200).send();
    } catch (error) {
      console.info('Delete setting failed');
      console.error(error);
      res.status(400).send();
    }
  }

  async findSetting(req: Request, res: Response) {
    console.debug(`find settings ${req.params.id}`);
    const { id } = req.params;
    const owner = getOwner(res);

    if (!id) {
      return res.status(400).send();
    }

    try {
      const storedSettings = await this.service.getById(owner, id);
      if (storedSettings?.payload == null) {
        return res.json({ payload: null });
      }
      return res.json({
        payload: unwrapStoredSettingsPayload(storedSettings.payload),
      });
    } catch (error) {
      console.info('Get setting failed');
      console.error(error);
      res.status(400).send();
    }
  }

  async listSettings(req: Request, res: Response) {
    const owner = getOwner(res);
    try {
      const rows = await this.service.getAllByOwner(owner);

      const enriched = await Promise.all(
        rows.map(async (r) => {
          if (r.title != null || !this.notionService) return r;
          try {
            const api = await this.notionService.getNotionAPI(owner);
            const page = await api.getPage(r.object_id.replaceAll('-', ''));
            const title = page
              ? (getNotionObjectTitle(page, { emoji: false }) ?? null)
              : null;
            if (title) {
              await this.service.updateTitle(r.object_id, title);
            }
            return { ...r, title };
          } catch {
            return r;
          }
        })
      );

      res.json({
        items: enriched.map((r) => ({
          pageId: r.object_id,
          title: r.title ?? null,
          updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
        })),
      });
    } catch (error) {
      console.error(error);
      res.status(500).send();
    }
  }

  async deleteAllUserSettings(req: Request, res: Response) {
    const owner = getOwner(res);
    try {
      await this.deleteAllUseCase?.execute(owner);
      res.status(204).send();
    } catch (error) {
      console.error(error);
      res.status(500).send();
    }
  }

  getDefaultCardOptions(source: 'client' | 'server') {
    if (source === 'client') {
      return this.getDefaultCardOptionDetails()
        .map((option: CardOptionDetail) => {
          return { [option.key]: option.value.toString() };
        })
        .reduce((accumulator, current) => {
          return { ...accumulator, ...current };
        }, {});
    }
    return CardOption.LoadDefaultOptions();
  }

  getDefaultCardOptionDetails() {
    return supportedOptions();
  }
}

export default CardOptionsController;
