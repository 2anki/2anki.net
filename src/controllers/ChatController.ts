import { Request, Response } from 'express';
import {
  ChatUseCase,
  ChatRateLimitError,
  ChatConversationNotFoundError,
  ChatAttachmentsNotReplayableError,
  McqExtractionFailedError,
} from '../usecases/chat/ChatUseCase';
import type { ChatAttachment } from '../usecases/chat/buildAttachmentBlocks';
import { detectFileMime } from '../lib/detectFileMime';
import { getSafeFilename } from '../lib/getSafeFilename';

const MAX_CONTENT_LENGTH = 100_000;
const MAX_FILE_COUNT = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE = 25 * 1024 * 1024;

const ZIP_MIME = 'application/zip';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MARKDOWN_MIME = 'text/markdown';
const PLAIN_TEXT_MIME = 'text/plain';

const BINARY_VERIFIED_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

const ZIP_BASED_MIMES = new Set([ZIP_MIME, DOCX_MIME]);
const TEXT_MIMES = new Set([MARKDOWN_MIME, PLAIN_TEXT_MIME]);

const ALLOWED_MIMES = new Set([
  ...BINARY_VERIFIED_MIMES,
  ...ZIP_BASED_MIMES,
  ...TEXT_MIMES,
]);

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function hasZipSignature(buffer: Buffer): boolean {
  if (buffer.length < ZIP_SIGNATURE.length) return false;
  return ZIP_SIGNATURE.every((byte, i) => buffer[i] === byte);
}

function looksLikeUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0x00)) return false;
  const sample = buffer.subarray(0, 8192).toString('utf8');
  return !sample.includes('�');
}

function contentMatchesMime(buffer: Buffer, mimeType: string): boolean {
  if (BINARY_VERIFIED_MIMES.has(mimeType)) {
    return detectFileMime(buffer) === mimeType;
  }
  if (ZIP_BASED_MIMES.has(mimeType)) {
    return hasZipSignature(buffer);
  }
  if (TEXT_MIMES.has(mimeType)) {
    return looksLikeUtf8Text(buffer);
  }
  return false;
}

const ATTACH_REJECTED_MESSAGE =
  'Files work here as PDF, image, .zip, .docx, .md, or .txt.';

const FILE_ONLY_INSTRUCTION_SINGLE =
  'Create flashcards from the attached file.';
const FILE_ONLY_INSTRUCTION_MULTI =
  'Create flashcards from the attached files.';

function sseWrite(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function parseConversationId(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0)
    return raw;
  if (typeof raw === 'string' && /^[1-9]\d*$/.test(raw)) {
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

type AttachmentValidation =
  | { ok: true; attachments: ChatAttachment[] }
  | { ok: false; error: string };

function validateAttachments(
  rawFiles: Express.Multer.File[]
): AttachmentValidation {
  if (rawFiles.length > MAX_FILE_COUNT) {
    return {
      ok: false,
      error: `Too many files. Maximum is ${MAX_FILE_COUNT} per message.`,
    };
  }

  for (const file of rawFiles) {
    const safeName = getSafeFilename(file.originalname);
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      return {
        ok: false,
        error: `${safeName} is ${sizeMB} MB. The per-file limit is 10 MB.`,
      };
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      return {
        ok: false,
        error: `Can't attach ${safeName}. ${ATTACH_REJECTED_MESSAGE}`,
      };
    }
  }

  const totalSize = rawFiles.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    const totalMB = (totalSize / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `That's ${totalMB} MB total. A message can carry up to 25 MB across all files.`,
    };
  }

  const attachments: ChatAttachment[] = [];
  for (const file of rawFiles) {
    const safeName = getSafeFilename(file.originalname);
    if (!contentMatchesMime(file.buffer, file.mimetype)) {
      return {
        ok: false,
        error: `Can't attach ${safeName}. ${ATTACH_REJECTED_MESSAGE}`,
      };
    }
    attachments.push({
      mimeType: file.mimetype,
      data: file.buffer,
      fileName: safeName,
    });
  }

  return { ok: true, attachments };
}

type HistoryEntry = { role: 'user' | 'assistant'; content: string };

function isHistoryEntry(m: unknown): m is HistoryEntry {
  if (m == null || typeof m !== 'object') return false;
  const record = m as Record<string, unknown>;
  const roleOk = record.role === 'user' || record.role === 'assistant';
  return roleOk && typeof record.content === 'string';
}

function parseHistory(raw: unknown): HistoryEntry[] {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(isHistoryEntry)
    .map((m) => ({ role: m.role, content: m.content }));
}

function emitChatError(res: Response, err: unknown): void {
  if (err instanceof ChatRateLimitError) {
    sseWrite(res, 'error', { type: 'rate_limit', resetDate: err.resetDate });
  } else if (err instanceof ChatConversationNotFoundError) {
    sseWrite(res, 'error', { type: 'conversation_not_found' });
  } else if (err instanceof McqExtractionFailedError) {
    sseWrite(res, 'error', { type: 'mcq_extraction_failed' });
  } else if (err instanceof ChatAttachmentsNotReplayableError) {
    sseWrite(res, 'error', { type: 'attachments_not_replayable' });
  } else {
    sseWrite(res, 'error', { type: 'server_error' });
  }
}

function hasConsented(locals: Record<string, unknown>): boolean {
  return locals.chat_consent_at != null;
}

function resolveContent(
  rawContent: unknown,
  attachmentCount: number
): string | null {
  const content = typeof rawContent === 'string' ? rawContent.trim() : '';
  if (content.length > 0) return content;
  if (attachmentCount === 0) return null;
  return attachmentCount === 1
    ? FILE_ONLY_INSTRUCTION_SINGLE
    : FILE_ONLY_INSTRUCTION_MULTI;
}

class ChatController {
  constructor(private readonly chatUseCase: ChatUseCase) {}

  async sendMessage(req: Request, res: Response) {
    if (!hasConsented(res.locals as Record<string, unknown>)) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      sseWrite(res, 'error', { type: 'consent_required' });
      res.end();
      return;
    }

    const rawFiles = Array.isArray(req.files)
      ? (req.files as Express.Multer.File[])
      : [];
    const validation = validateAttachments(rawFiles);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const content = resolveContent(
      req.body?.content,
      validation.attachments.length
    );
    if (content == null) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const owner = res.locals.owner as number;
    const patreon = (res.locals.patreon as boolean) ?? false;
    const subscriber = (res.locals.subscriber as boolean) ?? false;
    const isPremium = patreon || subscriber;

    if (content.length > MAX_CONTENT_LENGTH) {
      res.status(400).json({
        error: `content must be ${MAX_CONTENT_LENGTH} characters or fewer`,
      });
      return;
    }

    const conversationId = parseConversationId(req.body?.conversationId);
    const conversationHistory = parseHistory(req.body?.history);
    const rawTemplateSlug = req.body?.templateSlug;
    const templateSlug =
      typeof rawTemplateSlug === 'string' ? rawTemplateSlug : null;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      const result = await this.chatUseCase.execute({
        user: { owner, patreon: isPremium },
        content,
        conversationHistory,
        conversationId,
        attachments: validation.attachments,
        templateSlug,
        onToken: (text) => sseWrite(res, 'token', text),
      });

      sseWrite(res, 'done', {
        content: result.content,
        conversationId: result.conversationId,
        ...(result.cards != null ? { cards: result.cards } : {}),
        ...(result.contentBefore != null
          ? { contentBefore: result.contentBefore }
          : {}),
        ...(result.contentAfter != null
          ? { contentAfter: result.contentAfter }
          : {}),
        ...(result.deckName != null ? { deckName: result.deckName } : {}),
      });
    } catch (err) {
      emitChatError(res, err);
    } finally {
      res.end();
    }
  }

  async regenerateMessage(req: Request, res: Response) {
    if (!hasConsented(res.locals as Record<string, unknown>)) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      sseWrite(res, 'error', { type: 'consent_required' });
      res.end();
      return;
    }

    const conversationId = parseConversationId(req.params?.id);
    if (conversationId == null) {
      res.status(400).json({ error: 'conversationId is required' });
      return;
    }

    const owner = res.locals.owner as number;
    const patreon = (res.locals.patreon as boolean) ?? false;
    const subscriber = (res.locals.subscriber as boolean) ?? false;
    const isPremium = patreon || subscriber;

    const rawTemplateSlug = req.body?.templateSlug;
    const templateSlug =
      typeof rawTemplateSlug === 'string' ? rawTemplateSlug : null;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      const result = await this.chatUseCase.regenerate({
        user: { owner, patreon: isPremium },
        conversationId,
        templateSlug,
        onToken: (text) => sseWrite(res, 'token', text),
      });

      sseWrite(res, 'done', {
        content: result.content,
        conversationId: result.conversationId,
        ...(result.cards != null ? { cards: result.cards } : {}),
        ...(result.contentBefore != null
          ? { contentBefore: result.contentBefore }
          : {}),
        ...(result.contentAfter != null
          ? { contentAfter: result.contentAfter }
          : {}),
        ...(result.deckName != null ? { deckName: result.deckName } : {}),
      });
    } catch (err) {
      emitChatError(res, err);
    } finally {
      res.end();
    }
  }
}

export default ChatController;
