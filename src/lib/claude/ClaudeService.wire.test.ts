import { vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../services/events/track', () => ({ track: vi.fn() }));

vi.mock('./aiSpendGuard', async () => {
  const actual =
    await vi.importActual<typeof import('./aiSpendGuard')>('./aiSpendGuard');
  return {
    ...actual,
    assertAiBudget: vi.fn(async () => undefined),
    withAiBudget: vi.fn((_subject: unknown, run: () => Promise<unknown>) =>
      run()
    ),
  };
});

import { generateDeckInfo, getAnthropicClient } from './ClaudeService';
import { generateDeckInfoFromPdfImages } from './generateDeckInfoFromPdfImages';
import { generateAiPreview } from './aiPreview';
import { convertImageToHTML } from '../../infrastracture/adapters/fileConversion/convertImageToHTML';
import { ChatUseCase } from '../../usecases/chat/ChatUseCase';
import { TagCardsUseCase } from '../../usecases/chat/TagCardsUseCase';
import { AINoteTypeUseCase } from '../../usecases/ai/AINoteTypeUseCase';
import { PhotoToFlashcardsUseCase } from '../../usecases/imageOcclusion/PhotoToFlashcardsUseCase';
import { InMemoryChatMessagesRepository } from '../../data_layer/ChatMessagesRepository';
import { InMemoryConversationsRepository } from '../../data_layer/ConversationsRepository';

const TEST_API_KEY = 'sk-ant-test-wire';
const EPHEMERAL = { type: 'ephemeral' };
const COMPACT_DECK_REPLY = JSON.stringify([
  { deck: 'Biology', cards: [{ q: 'What does a leaf make?', a: 'Sugar' }] },
]);

interface CapturedRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

const captured: CapturedRequest[] = [];
let replyText = '';

function messageJson(model: string, text: string) {
  return {
    id: 'msg_wire_test',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

function streamedMessage(model: string, text: string): string {
  const events: Array<[string, unknown]> = [
    [
      'message_start',
      {
        type: 'message_start',
        message: { ...messageJson(model, ''), content: [], stop_reason: null },
      },
    ],
    [
      'content_block_start',
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
    ],
    [
      'content_block_delta',
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text },
      },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 5 },
      },
    ],
    ['message_stop', { type: 'message_stop' }],
  ];
  return events
    .map(
      ([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    )
    .join('');
}

async function fakeAnthropicEdge(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  captured.push({
    url: String(input),
    headers: new Headers(init?.headers),
    body,
  });
  const model = String(body.model);
  if (body.stream === true) {
    return new Response(streamedMessage(model, replyText), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }
  return new Response(JSON.stringify(messageJson(model, replyText)), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

interface CacheMarker {
  path: string;
  cache_control: unknown;
}

function cacheControlMarkers(value: unknown, at = ''): CacheMarker[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      cacheControlMarkers(item, `${at}[${index}]`)
    );
  }
  if (value == null || typeof value !== 'object') return [];
  const entries = Object.entries(value);
  const own: CacheMarker[] = entries
    .filter(([key]) => key === 'cache_control')
    .map(([, marker]) => ({ path: at, cache_control: marker }));
  const nested = entries
    .filter(([key]) => key !== 'cache_control')
    .flatMap(([key, child]) =>
      cacheControlMarkers(child, at === '' ? key : `${at}.${key}`)
    );
  return [...own, ...nested];
}

const sampleStarter = {
  id: 'basic-clean',
  name: 'Clean Basic',
  description: 'A minimal note type',
  baseType: 'basic',
  noteType: {
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

let pdfBaseDir: string;

interface Surface {
  name: string;
  reply: string;
  run: () => Promise<unknown>;
  cacheMarkers: CacheMarker[];
}

const surfaces: Surface[] = [
  {
    name: 'conversion',
    reply: COMPACT_DECK_REPLY,
    run: () =>
      generateDeckInfo(
        '<h1>Leaves</h1><p>A leaf turns light, water and carbon dioxide into sugar.</p>',
        []
      ),
    cacheMarkers: [
      { path: 'messages[0].content[0]', cache_control: EPHEMERAL },
    ],
  },
  {
    name: 'PDF page vision',
    reply: COMPACT_DECK_REPLY,
    run: () =>
      generateDeckInfoFromPdfImages(
        '<html><body><img src="pdf-wire/page-1.png"/></body></html>',
        { mediaBaseDir: pdfBaseDir }
      ),
    cacheMarkers: [
      { path: 'messages[0].content[1]', cache_control: EPHEMERAL },
    ],
  },
  {
    name: 'file conversion',
    reply: '```html\n<ul class="toggle"><li>Q</li></ul>\n```',
    run: () =>
      convertImageToHTML(Buffer.from('fake image bytes').toString('base64')),
    cacheMarkers: [{ path: 'system[0]', cache_control: EPHEMERAL }],
  },
  {
    name: 'chat',
    reply: 'Here is an answer.',
    run: () =>
      new ChatUseCase(
        new InMemoryChatMessagesRepository(),
        new InMemoryConversationsRepository(),
        getAnthropicClient()
      ).execute({
        user: { owner: 1 },
        content: 'Explain photosynthesis',
        conversationHistory: [],
      }),
    cacheMarkers: [{ path: 'system[0]', cache_control: EPHEMERAL }],
  },
  {
    name: 'chat tagging',
    reply: '[["biology"]]',
    run: () =>
      new TagCardsUseCase(getAnthropicClient()).execute({
        cards: [{ front: 'What does a leaf make?', back: 'Sugar' }],
      }),
    cacheMarkers: [{ path: 'system[0]', cache_control: EPHEMERAL }],
  },
  {
    name: 'note type AI',
    reply: `\`\`\`json\n${JSON.stringify({ reply: 'Done.', starter: sampleStarter })}\n\`\`\``,
    run: () => new AINoteTypeUseCase().generate('a clean basic card'),
    cacheMarkers: [{ path: 'system[0]', cache_control: EPHEMERAL }],
  },
  {
    name: 'AI preview',
    reply: JSON.stringify([{ front: 'What does a leaf make?', back: 'Sugar' }]),
    run: () => generateAiPreview('A leaf turns light into sugar.'),
    cacheMarkers: [],
  },
  {
    name: 'photo to deck',
    reply: COMPACT_DECK_REPLY,
    run: () =>
      new PhotoToFlashcardsUseCase().generateCards({
        imageBase64: Buffer.from('fake photo bytes').toString('base64'),
        mediaType: 'image/png',
        deckName: 'Photo',
        owner: 'anonymous-visitor',
        isPaying: true,
        imageDimensions: { width: 200, height: 200 },
      }),
    cacheMarkers: [],
  },
];

async function firstRequestOf(surface: Surface): Promise<CapturedRequest> {
  captured.length = 0;
  replyText = surface.reply;
  await surface.run();
  expect(captured.length).toBeGreaterThan(0);
  return captured[0];
}

describe('Anthropic client requests at the HTTP edge', () => {
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = TEST_API_KEY;
    vi.stubGlobal('fetch', vi.fn(fakeAnthropicEdge));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    pdfBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-wire-'));
    fs.mkdirSync(path.join(pdfBaseDir, 'pdf-wire'));
    fs.writeFileSync(
      path.join(pdfBaseDir, 'pdf-wire', 'page-1.png'),
      Buffer.from('fake page bytes')
    );
  });

  afterAll(() => {
    fs.rmSync(pdfBaseDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(surfaces)(
    '$name sends no anthropic-beta header and keeps the client defaults',
    async (surface) => {
      const request = await firstRequestOf(surface);

      expect(request.url).toMatch(/\/v1\/messages$/);
      expect({
        beta: request.headers.get('anthropic-beta'),
        authorization: request.headers.get('authorization'),
      }).toEqual({
        beta: null,
        authorization: `Bearer ${TEST_API_KEY}`,
      });
    }
  );

  it.each(surfaces)(
    '$name keeps its cache_control markers where they were',
    async (surface) => {
      const request = await firstRequestOf(surface);

      expect(cacheControlMarkers(request.body)).toEqual(surface.cacheMarkers);
    }
  );
});
