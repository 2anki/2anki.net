import { Request, Response } from 'express';

import { buildContentDisposition } from '../lib/buildContentDisposition';
import { getOwner } from '../lib/User/getOwner';
import {
  AnkiNoteType,
  exportNoteTypeToApkg,
} from '../lib/templates/exportNoteTypeToApkg';
import { validateTemplateFields } from '../lib/templates/validateTemplateFields';
import {
  Starter,
  listConversionStarters,
  listEditorStarters,
} from '../services/starters';
import {
  AINoteTypeUseCase,
  ChatMessage,
  NoteTypeStarterInput,
} from '../usecases/ai/AINoteTypeUseCase';
import {
  AiTemplateQuotaService,
  QuotaKind,
  UserPaymentLocals,
} from '../services/ai/AiTemplateQuotaService';
import TemplatesService from '../services/TemplatesService';

const EMPTY_USER_PAYLOAD = { templates: [], hiddenIds: [] } as const;

function toStarterResponse(starter: Starter): Omit<Starter, 'surface'> {
  return {
    id: starter.id,
    name: starter.name,
    description: starter.description,
    baseType: starter.baseType,
    noteType: starter.noteType,
    previewData: starter.previewData,
    tags: starter.tags,
  };
}

function isValidNoteType(value: unknown): value is AnkiNoteType {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AnkiNoteType>;
  if (typeof candidate.name !== 'string') return false;
  if (!Array.isArray(candidate.tmpls) || candidate.tmpls.length === 0) {
    return false;
  }
  if (!Array.isArray(candidate.flds) || candidate.flds.length === 0) {
    return false;
  }
  return true;
}

interface InvalidSavedTemplate {
  templateId: string | undefined;
  missing: string[];
  message: string;
}

function findInvalidSavedTemplate(
  templates: unknown[]
): InvalidSavedTemplate | null {
  for (const entry of templates) {
    if (!entry || typeof entry !== 'object') continue;
    const noteType = (entry as { noteType?: unknown }).noteType;
    if (!isValidNoteType(noteType)) continue;
    const result = validateTemplateFields(noteType);
    if (result.ok) continue;
    return {
      templateId: (entry as { id?: string }).id,
      missing: result.missing,
      message: result.message,
    };
  }
  return null;
}

function safeApkgFilename(name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  const safe = trimmed.replace(/[^\p{L}\p{N}\-_ ]/gu, '_');
  const base = safe.length === 0 ? 'template' : safe;
  return `${base}.apkg`;
}

class TemplatesController {
  constructor(
    private readonly service: TemplatesService,
    private readonly aiUseCase: AINoteTypeUseCase = new AINoteTypeUseCase(),
    private readonly quotaService: AiTemplateQuotaService | null = null
  ) {}

  private async enforceQuota(
    req: Request,
    res: Response,
    kind: QuotaKind
  ): Promise<boolean> {
    if (!this.quotaService) return true;
    const owner = getOwner(res);
    if (owner == null) {
      res.status(401).json({ error: 'Authentication required' });
      return false;
    }
    const check = await this.quotaService.check(
      owner,
      kind,
      res.locals as UserPaymentLocals
    );
    if (!check.allowed) {
      res.status(429).json({
        error:
          kind === 'generate'
            ? `You've used your ${check.limit} free Claude drafts. Upgrade for unlimited.`
            : `You've used your ${check.limit} free Claude edits. Upgrade for unlimited.`,
        kind,
        limit: check.limit,
        used: check.used,
        upgradeUrl: '/pricing',
      });
      return false;
    }
    return true;
  }

  async createTemplate(req: Request, res: Response) {
    const { templates } = req.body;
    const owner = getOwner(res);

    try {
      await this.service.create(owner, templates);
      res.status(200).send();
    } catch {
      res.status(400).send();
    }
  }

  async deleteTemplate(_req: Request, res: Response) {
    const owner = getOwner(res);

    try {
      await this.service.delete(owner);
      res.status(200).send();
    } catch {
      res.status(400).send();
    }
  }

  async getUserData(_req: Request, res: Response) {
    const owner = getOwner(res);

    try {
      const payload = await this.service.findByOwner(owner);
      res.json(payload ?? EMPTY_USER_PAYLOAD);
    } catch {
      res.status(500).json({ error: 'Failed to load templates' });
    }
  }

  async saveUserData(req: Request, res: Response) {
    const owner = getOwner(res);
    const body = req.body ?? {};
    const templates = Array.isArray(body.templates) ? body.templates : [];
    const hiddenIds = Array.isArray(body.hiddenIds) ? body.hiddenIds : [];

    const invalid = findInvalidSavedTemplate(templates);
    if (invalid) {
      res.status(400).json({
        error: invalid.message,
        missing: invalid.missing,
        templateId: invalid.templateId,
      });
      return;
    }

    try {
      await this.service.create(owner, { templates, hiddenIds });
      res.status(200).json({ ok: true });
    } catch {
      res.status(400).json({ error: 'Failed to save templates' });
    }
  }

  listDefaultTemplates(_req: Request, res: Response) {
    res.json(listEditorStarters().map(toStarterResponse));
  }

  listOfficialTemplates(_req: Request, res: Response) {
    res.json(listConversionStarters().map(toStarterResponse));
  }

  async aiGenerate(req: Request, res: Response) {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
    if (prompt.trim().length === 0) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }
    const ok = await this.enforceQuota(req, res, 'generate');
    if (!ok) return;
    try {
      const result = await this.aiUseCase.generate(
        prompt,
        Number(getOwner(res)) || null
      );
      if (this.quotaService) {
        await this.quotaService.record(getOwner(res), 'generate');
      }
      res.json(result);
    } catch (error) {
      console.error('AI generation failed:', error);
      res.status(500).json({ error: 'AI generation failed' });
    }
  }

  async aiModify(req: Request, res: Response) {
    const body = req.body ?? {};
    const instruction =
      typeof body.instruction === 'string' ? body.instruction : '';
    if (instruction.trim().length === 0) {
      res.status(400).json({ error: 'instruction is required' });
      return;
    }
    const starter = body.starter as NoteTypeStarterInput | undefined;
    if (!starter || typeof starter !== 'object') {
      res.status(400).json({ error: 'starter is required' });
      return;
    }
    const history: ChatMessage[] = Array.isArray(body.history)
      ? (body.history as ChatMessage[])
      : [];
    const ok = await this.enforceQuota(req, res, 'modify');
    if (!ok) return;
    try {
      const result = await this.aiUseCase.modify(
        starter,
        instruction,
        history,
        Number(getOwner(res)) || null
      );
      if (this.quotaService) {
        await this.quotaService.record(getOwner(res), 'modify');
      }
      res.json(result);
    } catch (error) {
      console.error('AI modify failed:', error);
      res.status(500).json({ error: 'AI modify failed' });
    }
  }

  async exportTemplate(req: Request, res: Response) {
    const { noteType, previewData } = req.body ?? {};

    if (!isValidNoteType(noteType)) {
      res.status(400).json({ error: 'Invalid note type' });
      return;
    }

    const validation = validateTemplateFields(noteType);
    if (!validation.ok) {
      res.status(400).json({
        error: validation.message,
        missing: validation.missing,
      });
      return;
    }

    const safePreview =
      previewData && typeof previewData === 'object' ? previewData : {};

    try {
      const buffer = await exportNoteTypeToApkg(noteType, safePreview);
      const filename = safeApkgFilename(noteType.name);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', buildContentDisposition(filename));
      res.send(buffer);
    } catch {
      res.status(500).json({ error: 'Failed to generate APKG' });
    }
  }
}

export default TemplatesController;
