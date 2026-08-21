import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NoteTypeStarter,
  aiModifyNoteType,
  downloadNoteTypeApkg,
  saveUserTemplate,
} from './templates';

const starter: NoteTypeStarter = {
  id: 'basic-clean',
  name: 'Clean Basic',
  description: 'A minimal note type',
  baseType: 'basic',
  noteType: {
    id: 1,
    name: 'Clean Basic',
    type: 0,
    tmpls: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{Back}}' }],
    flds: [
      { name: 'Front', ord: 0 },
      { name: 'Back', ord: 1 },
    ],
    css: '.card { color: black; }',
  },
  previewData: { Front: 'Q', Back: 'A' },
  tags: [],
};

function htmlResponse(status: number, statusText: string): Response {
  return new Response('<html>Proxy Error</html>', {
    status,
    statusText,
    headers: { 'Content-Type': 'text/html' },
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('aiModifyNoteType error handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([500, 502, 503, 504])(
    'returns the briefly-unavailable copy for status %i',
    async (status) => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        htmlResponse(status, 'Proxy Error')
      );

      await expect(aiModifyNoteType(starter, 'change it', [])).rejects.toThrow(
        'The AI is briefly unavailable — try again in a moment.'
      );
    }
  );

  it.each([400, 404, 422])(
    'returns the rephrase copy for client error %i',
    async (status) => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        htmlResponse(status, 'Bad Request')
      );

      await expect(aiModifyNoteType(starter, 'change it', [])).rejects.toThrow(
        "The change couldn't be applied. Try rephrasing your request."
      );
    }
  );

  it('uses the server-sent error message when one is present', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse(400, { error: 'Instruction is too long (max 2000 chars)' })
    );

    await expect(aiModifyNoteType(starter, 'x', [])).rejects.toThrow(
      'Instruction is too long (max 2000 chars)'
    );
  });

  it('surfaces the 402 paid-plan message as a plain error', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse(402, { error: 'upgrade required' })
    );

    await expect(aiModifyNoteType(starter, 'x', [])).rejects.toThrow(
      'upgrade required'
    );
  });

  it('never leaks the raw status code or "Proxy Error" to the user', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      htmlResponse(502, 'Proxy Error')
    );

    await expect(aiModifyNoteType(starter, 'x', [])).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringMatching(/502|Proxy Error/),
      })
    );
  });
});

describe('saveUserTemplate field-validation error', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('surfaces the server-sent error message when the API returns 400 with JSON', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { templates: [], hiddenIds: [] })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        error:
          "Template references a field that doesn't exist: text2 image. Add the field or remove the reference.",
        missing: ['text2 image'],
        templateId: 'user-basic',
      })
    );

    await expect(saveUserTemplate(starter)).rejects.toThrow(
      "Template references a field that doesn't exist: text2 image. Add the field or remove the reference."
    );
  });
});

describe('downloadNoteTypeApkg field-validation error', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('surfaces the server-sent error message on 400', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse(400, {
        error:
          "Template references a field that doesn't exist: text2 image. Add the field or remove the reference.",
        missing: ['text2 image'],
      })
    );

    await expect(
      downloadNoteTypeApkg(starter.noteType, starter.previewData)
    ).rejects.toThrow(
      "Template references a field that doesn't exist: text2 image. Add the field or remove the reference."
    );
  });
});
