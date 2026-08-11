import { Request, Response } from 'express';
import ChatController from './ChatController';
import {
  ChatRateLimitError,
  ChatConversationNotFoundError,
  ChatAttachmentsNotReplayableError,
  McqExtractionFailedError,
} from '../usecases/chat/ChatUseCase';

function buildRes(
  owner = 42,
  patreon = false,
  subscriber = false,
  chatConsentAt: Date | null = new Date()
): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    locals: { owner, patreon, subscriber, chat_consent_at: chatConsentAt },
  } as unknown as Response;
}

function buildMocks(
  owner = 42,
  patreon = false,
  subscriber = false,
  chatConsentAt: Date | null = new Date()
) {
  const execute = jest.fn();
  const regenerate = jest.fn();
  const controller = new ChatController({ execute, regenerate } as never);
  const res = buildRes(owner, patreon, subscriber, chatConsentAt);
  return { execute, regenerate, controller, res };
}

function buildReq(body: unknown, files?: Express.Multer.File[]): Request {
  return { body, files: files ?? [] } as unknown as Request;
}

function buildReqWithParams(
  body: unknown,
  params: Record<string, string>
): Request {
  return { body, params } as unknown as Request;
}

function makeFile(
  overrides: Partial<Express.Multer.File> = {}
): Express.Multer.File {
  return {
    fieldname: 'files',
    originalname: 'test.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.concat([
      Buffer.from([0x25, 0x50, 0x44, 0x46]),
      Buffer.alloc(20),
    ]),
    stream: null as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
}

function writtenEvents(res: Response): Array<{ event: string; data: unknown }> {
  const calls = (res.write as jest.Mock).mock.calls as Array<[string]>;
  return calls.map(([raw]) => {
    const eventMatch = /^event: (.+)$/m.exec(raw);
    const dataMatch = /^data: (.+)$/m.exec(raw);
    return {
      event: eventMatch?.[1] ?? '',
      data: dataMatch != null ? JSON.parse(dataMatch[1]) : null,
    };
  });
}

describe('ChatController.sendMessage', () => {
  it('emits consent_required SSE error when chat_consent_at is null', async () => {
    const { controller, res } = buildMocks(42, false, false, null);
    await controller.sendMessage(buildReq({ content: 'Hello' }), res);
    const events = writtenEvents(res);
    expect(events).toContainEqual({
      event: 'error',
      data: { type: 'consent_required' },
    });
    expect(res.end).toHaveBeenCalled();
  });

  it('returns 400 when content is missing', async () => {
    const { controller, res } = buildMocks();
    await controller.sendMessage(buildReq({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when content is empty string', async () => {
    const { controller, res } = buildMocks();
    await controller.sendMessage(buildReq({ content: '' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('allows content up to 100 000 chars for free users', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'ok' });
    await controller.sendMessage(
      buildReq({ content: 'x'.repeat(100_000) }),
      res
    );
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(execute).toHaveBeenCalled();
  });

  it('allows content up to 100 000 chars for patreon users', async () => {
    const { execute, controller, res } = buildMocks(42, true, false);
    execute.mockResolvedValueOnce({ content: 'ok' });
    await controller.sendMessage(
      buildReq({ content: 'x'.repeat(100_000) }),
      res
    );
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(execute).toHaveBeenCalled();
  });

  it('allows content up to 100 000 chars for subscriber users', async () => {
    const { execute, controller, res } = buildMocks(42, false, true);
    execute.mockResolvedValueOnce({ content: 'ok' });
    await controller.sendMessage(
      buildReq({ content: 'x'.repeat(100_000) }),
      res
    );
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(execute).toHaveBeenCalled();
  });

  it('returns 400 when content exceeds 100 000 chars for any tier', async () => {
    const { controller, res } = buildMocks(42, true, false);
    await controller.sendMessage(
      buildReq({ content: 'x'.repeat(100_001) }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('sends error SSE event with rate_limit type on ChatRateLimitError', async () => {
    const { execute, controller, res } = buildMocks();
    const resetDate = '2026-06-01T00:00:00.000Z';
    execute.mockRejectedValueOnce(new ChatRateLimitError(resetDate));
    await controller.sendMessage(buildReq({ content: 'Hello' }), res);
    const events = writtenEvents(res);
    expect(events).toContainEqual({
      event: 'error',
      data: { type: 'rate_limit', resetDate },
    });
  });

  it('sends done SSE event with content on happy path', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'Nice answer' });
    await controller.sendMessage(
      buildReq({ content: 'Tell me about mitosis' }),
      res
    );
    const events = writtenEvents(res);
    expect(events).toContainEqual({
      event: 'done',
      data: expect.objectContaining({ content: 'Nice answer' }),
    });
    expect(res.end).toHaveBeenCalled();
  });

  it('includes cards in done SSE event when use case returns them', async () => {
    const { execute, controller, res } = buildMocks();
    const cards = [{ front: 'Q', back: 'A' }];
    execute.mockResolvedValueOnce({ content: 'Here are cards', cards });
    await controller.sendMessage(buildReq({ content: 'Make flashcards' }), res);
    const events = writtenEvents(res);
    expect(events).toContainEqual({
      event: 'done',
      data: expect.objectContaining({ cards }),
    });
  });

  it('passes conversationId from body through to the use case', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'ok', conversationId: 7 });
    await controller.sendMessage(
      buildReq({ content: 'Hi', conversationId: 7 }),
      res
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 7 })
    );
  });

  it('rejects non-positive or non-integer conversationId values by sending null', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'ok', conversationId: 1 });
    await controller.sendMessage(
      buildReq({ content: 'Hi', conversationId: 'abc' }),
      res
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: null })
    );
  });

  it('emits conversationId in done event', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'reply', conversationId: 42 });
    await controller.sendMessage(buildReq({ content: 'Hi' }), res);
    const events = writtenEvents(res);
    expect(events).toContainEqual({
      event: 'done',
      data: expect.objectContaining({ conversationId: 42 }),
    });
  });

  it('sends mcq_extraction_failed error event when use case throws McqExtractionFailedError', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockRejectedValueOnce(new McqExtractionFailedError());
    await controller.sendMessage(
      buildReq({ content: 'Quiz me on Albania', templateSlug: 'mcq' }),
      res
    );
    const events = writtenEvents(res);
    expect(events).toContainEqual({
      event: 'error',
      data: { type: 'mcq_extraction_failed' },
    });
    expect(res.end).toHaveBeenCalled();
  });

  it('sends conversation_not_found error event when use case throws ChatConversationNotFoundError', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockRejectedValueOnce(new ChatConversationNotFoundError());
    await controller.sendMessage(
      buildReq({ content: 'Hi', conversationId: 999 }),
      res
    );
    const events = writtenEvents(res);
    expect(events).toContainEqual({
      event: 'error',
      data: { type: 'conversation_not_found' },
    });
  });
});

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('ChatController.sendMessage — file attachments', () => {
  it('returns 400 when more than 5 files are attached', async () => {
    const { controller, res } = buildMocks();
    const files = Array.from({ length: 6 }, () => makeFile());
    await controller.sendMessage(buildReq({ content: 'Hi' }, files), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when a file exceeds 10 MB', async () => {
    const { controller, res } = buildMocks();
    const bigFile = makeFile({ size: 11 * 1024 * 1024 });
    await controller.sendMessage(buildReq({ content: 'Hi' }, [bigFile]), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when total file size exceeds 25 MB', async () => {
    const { controller, res } = buildMocks();
    const files = Array.from({ length: 3 }, () =>
      makeFile({ size: 9 * 1024 * 1024, buffer: Buffer.alloc(9 * 1024 * 1024) })
    );
    await controller.sendMessage(buildReq({ content: 'Hi' }, files), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when MIME type is not allowlisted', async () => {
    const { controller, res } = buildMocks();
    const file = makeFile({
      mimetype: 'application/msword',
      originalname: 'doc.doc',
    });
    await controller.sendMessage(buildReq({ content: 'Hi' }, [file]), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when magic bytes do not match declared MIME', async () => {
    const { controller, res } = buildMocks();
    const file = makeFile({
      mimetype: 'image/png',
      originalname: 'fake.png',
      buffer: Buffer.concat([
        Buffer.from([0x25, 0x50, 0x44, 0x46]),
        Buffer.alloc(20),
      ]),
    });
    await controller.sendMessage(buildReq({ content: 'Hi' }, [file]), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('passes validated attachments to the use case on happy path', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'ok', conversationId: 1 });

    const file = makeFile({
      mimetype: 'image/png',
      originalname: 'diagram.png',
      buffer: Buffer.concat([PNG_MAGIC, Buffer.alloc(20)]),
    });
    await controller.sendMessage(buildReq({ content: 'Hi' }, [file]), res);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: expect.arrayContaining([
          expect.objectContaining({ mimeType: 'image/png' }),
        ]),
      })
    );
  });

  it('allows send with no files attached (backward-compatible)', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'ok', conversationId: 1 });
    await controller.sendMessage(
      buildReq({ content: 'Plain text message' }),
      res
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [] })
    );
  });
});

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('ChatController.sendMessage — expanded attachment types', () => {
  it('accepts a Notion .zip whose bytes start with the zip signature', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'ok', conversationId: 1 });
    const file = makeFile({
      mimetype: 'application/zip',
      originalname: 'export.zip',
      buffer: Buffer.concat([ZIP_MAGIC, Buffer.alloc(40)]),
    });
    await controller.sendMessage(buildReq({ content: 'Cards' }, [file]), res);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            mimeType: 'application/zip',
            fileName: 'export.zip',
          }),
        ],
      })
    );
  });

  it('accepts a .docx whose bytes start with the zip signature', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'ok', conversationId: 1 });
    const file = makeFile({
      mimetype: DOCX_MIME,
      originalname: 'essay.docx',
      buffer: Buffer.concat([ZIP_MAGIC, Buffer.alloc(40)]),
    });
    await controller.sendMessage(
      buildReq({ content: 'Summarize' }, [file]),
      res
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [expect.objectContaining({ mimeType: DOCX_MIME })],
      })
    );
  });

  it('accepts a .md attachment of UTF-8 text', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'ok', conversationId: 1 });
    const file = makeFile({
      mimetype: 'text/markdown',
      originalname: 'notes.md',
      buffer: Buffer.from('# Heading\n\nbody', 'utf8'),
    });
    await controller.sendMessage(
      buildReq({ content: 'Make cards' }, [file]),
      res
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            mimeType: 'text/markdown',
            fileName: 'notes.md',
          }),
        ],
      })
    );
  });

  it('accepts a .txt attachment of UTF-8 text', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'ok', conversationId: 1 });
    const file = makeFile({
      mimetype: 'text/plain',
      originalname: 'scratch.txt',
      buffer: Buffer.from('plain notes', 'utf8'),
    });
    await controller.sendMessage(
      buildReq({ content: 'Summarize' }, [file]),
      res
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [expect.objectContaining({ mimeType: 'text/plain' })],
      })
    );
  });

  it('rejects a declared .zip whose bytes are not a real zip', async () => {
    const { controller, res } = buildMocks();
    const file = makeFile({
      mimetype: 'application/zip',
      originalname: 'fake.zip',
      buffer: Buffer.from('not really a zip', 'utf8'),
    });
    await controller.sendMessage(buildReq({ content: 'Hi' }, [file]), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a declared .txt that contains binary NUL bytes', async () => {
    const { controller, res } = buildMocks();
    const file = makeFile({
      mimetype: 'text/plain',
      originalname: 'binary.txt',
      buffer: Buffer.from([0x68, 0x69, 0x00, 0xff, 0xfe]),
    });
    await controller.sendMessage(buildReq({ content: 'Hi' }, [file]), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('ChatController.sendMessage — multipart history parsing', () => {
  it('parses history when serialized as a JSON string by multer (multipart/form-data)', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'ok', conversationId: 1 });

    const history = [
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
    ];

    const file = makeFile({
      mimetype: 'image/png',
      originalname: 'diagram.png',
      buffer: Buffer.concat([PNG_MAGIC, Buffer.alloc(20)]),
    });

    await controller.sendMessage(
      buildReq(
        { content: 'follow-up question', history: JSON.stringify(history) },
        [file]
      ),
      res
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationHistory: [
          { role: 'user', content: 'previous question' },
          { role: 'assistant', content: 'previous answer' },
        ],
      })
    );
  });

  it('returns an empty history when the multipart string is not valid JSON', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'ok', conversationId: 1 });

    await controller.sendMessage(
      buildReq({ content: 'Hi', history: 'not-json[' }),
      res
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ conversationHistory: [] })
    );
  });

  it('still accepts history as a real array (JSON request body)', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'ok', conversationId: 1 });

    await controller.sendMessage(
      buildReq({
        content: 'Hi',
        history: [{ role: 'user', content: 'prior' }],
      }),
      res
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationHistory: [{ role: 'user', content: 'prior' }],
      })
    );
  });
});

describe('ChatController.regenerateMessage', () => {
  it('emits consent_required SSE error when chat_consent_at is null', async () => {
    const { controller, res } = buildMocks(42, false, false, null);
    await controller.regenerateMessage(
      buildReqWithParams({}, { id: '7' }),
      res
    );
    const events = writtenEvents(res);
    expect(events).toContainEqual({
      event: 'error',
      data: { type: 'consent_required' },
    });
    expect(res.end).toHaveBeenCalled();
  });

  it('returns 400 when the conversation id is not a positive integer', async () => {
    const { regenerate, controller, res } = buildMocks();
    await controller.regenerateMessage(
      buildReqWithParams({}, { id: 'abc' }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(regenerate).not.toHaveBeenCalled();
  });

  it('passes the conversation id and per-call templateSlug to the use case', async () => {
    const { regenerate, controller, res } = buildMocks();
    regenerate.mockResolvedValueOnce({ content: 'fresh', conversationId: 7 });

    await controller.regenerateMessage(
      buildReqWithParams({ templateSlug: 'cloze' }, { id: '7' }),
      res
    );

    expect(regenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 7,
        templateSlug: 'cloze',
        user: { owner: 42, patreon: false },
      })
    );
  });

  it('streams a done frame with the regenerated content', async () => {
    const { regenerate, controller, res } = buildMocks();
    regenerate.mockResolvedValueOnce({ content: 'fresh', conversationId: 7 });

    await controller.regenerateMessage(
      buildReqWithParams({ templateSlug: null }, { id: '7' }),
      res
    );

    const events = writtenEvents(res);
    expect(events).toContainEqual({
      event: 'done',
      data: { content: 'fresh', conversationId: 7 },
    });
  });

  it('emits a conversation_not_found SSE error when the use case rejects', async () => {
    const { regenerate, controller, res } = buildMocks();
    regenerate.mockRejectedValueOnce(new ChatConversationNotFoundError());

    await controller.regenerateMessage(
      buildReqWithParams({}, { id: '7' }),
      res
    );

    const events = writtenEvents(res);
    expect(events).toContainEqual({
      event: 'error',
      data: { type: 'conversation_not_found' },
    });
  });
});

describe('ChatController.sendMessage — file-only messages', () => {
  it('accepts a file with no text and substitutes the default instruction', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'ok', conversationId: 1 });

    await controller.sendMessage(buildReq({ content: '' }, [makeFile()]), res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Create flashcards from the attached file.',
        attachments: [expect.objectContaining({ mimeType: 'application/pdf' })],
      })
    );
  });

  it('substitutes the plural instruction when several files are attached', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'ok', conversationId: 1 });

    await controller.sendMessage(
      buildReq({ content: '' }, [makeFile(), makeFile()]),
      res
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Create flashcards from the attached files.',
      })
    );
  });

  it('treats whitespace-only content with a file as file-only', async () => {
    const { execute, controller, res } = buildMocks();
    execute.mockResolvedValueOnce({ content: 'ok', conversationId: 1 });

    await controller.sendMessage(
      buildReq({ content: '   ' }, [makeFile()]),
      res
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Create flashcards from the attached file.',
      })
    );
  });

  it('reports the attachment problem, not missing content, when the only file is invalid', async () => {
    const { controller, res } = buildMocks();
    const bigFile = makeFile({ size: 11 * 1024 * 1024 });

    await controller.sendMessage(buildReq({ content: '' }, [bigFile]), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.stringContaining('10 MB'),
    });
  });
});

describe('ChatController.regenerateMessage — attachments not replayable', () => {
  it('emits an attachments_not_replayable SSE error when the use case refuses', async () => {
    const { regenerate, controller, res } = buildMocks();
    regenerate.mockRejectedValueOnce(new ChatAttachmentsNotReplayableError());

    await controller.regenerateMessage(
      buildReqWithParams({}, { id: '7' }),
      res
    );

    const events = writtenEvents(res);
    expect(events).toContainEqual({
      event: 'error',
      data: { type: 'attachments_not_replayable' },
    });
  });
});
