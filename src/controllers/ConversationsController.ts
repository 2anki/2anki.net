import { Request, Response } from 'express';
import {
  ConversationsUseCase,
  InvalidTitleError,
  InvalidDraftError,
  InvalidTemplateError,
} from '../usecases/chat/ConversationsUseCase';
import { DeleteAllConversationsUseCase } from '../usecases/chat/DeleteAllConversationsUseCase';

function parseConversationId(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

class ConversationsController {
  constructor(
    private readonly useCase: ConversationsUseCase,
    private readonly deleteAllUseCase: DeleteAllConversationsUseCase
  ) {}

  async list(req: Request, res: Response): Promise<void> {
    const owner = res.locals.owner as number;
    const items = await this.useCase.list(owner);
    res.status(200).json({
      conversations: items.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updated_at.toISOString(),
      })),
    });
  }

  async get(req: Request, res: Response): Promise<void> {
    const owner = res.locals.owner as number;
    const id = parseConversationId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: 'invalid conversation id' });
      return;
    }
    const conv = await this.useCase.get({ userId: owner, conversationId: id });
    if (conv == null) {
      res.status(404).json({ error: 'conversation not found' });
      return;
    }
    res.status(200).json({
      id: conv.id,
      title: conv.title,
      draft: conv.draft,
      templateSlug: conv.templateSlug,
      createdAt: conv.created_at.toISOString(),
      updatedAt: conv.updated_at.toISOString(),
      messages: conv.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at.toISOString(),
        ...(m.cards != null ? { cards: m.cards } : {}),
        ...(m.contentBefore != null ? { contentBefore: m.contentBefore } : {}),
        ...(m.contentAfter != null ? { contentAfter: m.contentAfter } : {}),
      })),
    });
  }

  async rename(req: Request, res: Response): Promise<void> {
    const owner = res.locals.owner as number;
    const id = parseConversationId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: 'invalid conversation id' });
      return;
    }
    const rawTitle = req.body?.title;
    if (typeof rawTitle !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    try {
      const updated = await this.useCase.rename({
        userId: owner,
        conversationId: id,
        title: rawTitle,
      });
      if (!updated) {
        res.status(404).json({ error: 'conversation not found' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      if (err instanceof InvalidTitleError) {
        res.status(400).json({ error: 'title must be 1 to 120 characters' });
        return;
      }
      throw err;
    }
  }

  async saveDraft(req: Request, res: Response): Promise<void> {
    const owner = res.locals.owner as number;
    const id = parseConversationId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: 'invalid conversation id' });
      return;
    }
    const rawContent = req.body?.content;
    let content: string | null;
    if (rawContent === null) {
      content = null;
    } else if (typeof rawContent === 'string') {
      content = rawContent;
    } else {
      res.status(400).json({ error: 'content must be a string or null' });
      return;
    }
    try {
      const updated = await this.useCase.saveDraft({
        userId: owner,
        conversationId: id,
        content,
      });
      if (!updated) {
        res.status(404).json({ error: 'conversation not found' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      if (err instanceof InvalidDraftError) {
        res.status(400).json({ error: 'draft is too long' });
        return;
      }
      throw err;
    }
  }

  async saveTemplate(req: Request, res: Response): Promise<void> {
    const owner = res.locals.owner as number;
    const id = parseConversationId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: 'invalid conversation id' });
      return;
    }
    const rawSlug = req.body?.templateSlug;
    const templateSlug =
      rawSlug === null || rawSlug === undefined ? null : rawSlug;
    if (templateSlug !== null && typeof templateSlug !== 'string') {
      res.status(400).json({ error: 'templateSlug must be a string or null' });
      return;
    }
    try {
      const updated = await this.useCase.saveTemplate({
        userId: owner,
        conversationId: id,
        templateSlug,
      });
      if (!updated) {
        res.status(404).json({ error: 'conversation not found' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      if (err instanceof InvalidTemplateError) {
        res.status(400).json({
          error: 'templateSlug must be basic, basic-and-reversed, or cloze',
        });
        return;
      }
      throw err;
    }
  }

  async delete(req: Request, res: Response): Promise<void> {
    const owner = res.locals.owner as number;
    const id = parseConversationId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: 'invalid conversation id' });
      return;
    }
    const deleted = await this.useCase.delete({
      userId: owner,
      conversationId: id,
    });
    if (!deleted) {
      res.status(404).json({ error: 'conversation not found' });
      return;
    }
    res.status(204).end();
  }

  async deleteAll(req: Request, res: Response): Promise<void> {
    const owner = res.locals.owner as number;
    await this.deleteAllUseCase.execute(owner);
    res.status(204).end();
  }
}

export default ConversationsController;
