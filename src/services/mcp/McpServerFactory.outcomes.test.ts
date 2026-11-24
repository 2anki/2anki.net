import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import express from 'express';
import { vi } from 'vitest';

import type UsersRepository from '../../data_layer/UsersRepository';
import type { JobWithDownloadKey } from '../../data_layer/JobRepository';
import type ApkgPreviewService from '../ApkgPreviewService/ApkgPreviewService';
import type DownloadService from '../DownloadService';
import type StorageHandler from '../../lib/storage/StorageHandler';
import type { IEventsRepository } from '../../data_layer/EventsRepository';
import {
  FREE_PHOTO_QUOTA_PER_MONTH,
  PhotoToFlashcardsUseCase,
} from '../../usecases/imageOcclusion/PhotoToFlashcardsUseCase';
import type { DeckPersistence } from './McpDeckPersistence';
import { buildMcpServer } from './McpServerFactory';
import { McpToolsService, type UploadEntrypoint } from './McpToolsService';

vi.mock('../events/track', () => ({ track: vi.fn() }));

const anthropicCreate = vi.hoisted(() => vi.fn());
const anthropicConstructed = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: anthropicCreate };
    constructor() {
      anthropicConstructed();
    }
  },
}));

const PLANS_URL = 'https://2anki.net/pricing/?ref=mcp&k=limit&a=a';
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

interface RecordedResult {
  tool: string;
  success: boolean;
  errorCode?: string;
  props?: Record<string, unknown>;
}

interface ToolsServiceFakes {
  owner?: string;
  jobs?: () => Promise<JobWithDownloadKey[]>;
  uploadEntry?: UploadEntrypoint;
  photoToFlashcards?: PhotoToFlashcardsUseCase;
}

function job(overrides: Partial<JobWithDownloadKey>): JobWithDownloadKey {
  return {
    id: 1,
    object_id: 'job-1',
    owner: '7',
    status: 'started',
    title: 'Biology',
    type: 'upload',
    download_key: null,
    upload_id: null,
    ...overrides,
  } as JobWithDownloadKey;
}

function realToolsService(fakes: ToolsServiceFakes): McpToolsService {
  const uploadEntry: UploadEntrypoint =
    fakes.uploadEntry ??
    ((_req: express.Request, res: express.Response) => {
      res.redirect('/limit?kind=card_count');
    });
  return new McpToolsService(
    { getJobsByOwner: fakes.jobs ?? (async () => []) },
    {} as DownloadService,
    {} as ApkgPreviewService,
    uploadEntry,
    {} as StorageHandler,
    { persist: vi.fn() } as unknown as DeckPersistence,
    fakes.photoToFlashcards ?? ({} as PhotoToFlashcardsUseCase),
    {} as UsersRepository,
    { holdForPlan: async () => null },
    'https://mcp.test'
  );
}

async function connect(fakes: ToolsServiceFakes = {}) {
  const results: RecordedResult[] = [];
  const server = buildMcpServer({
    owner: fakes.owner ?? '7',
    locals: {},
    toolsService: realToolsService(fakes),
    recordToolCall: () => {},
    recordToolResult: (tool, success, errorCode, props) =>
      results.push({ tool, success, errorCode, props }),
  });
  const client = new Client({ name: 'test-host', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  await client.listTools();
  return { client, results };
}

type CallResult = {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<CallResult> {
  return (await client.callTool({ name, arguments: args })) as CallResult;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a reached monthly card limit over the connector', () => {
  const limitMessage = `This deck would go over the free plan's 100 cards for this month, so it wasn't created. 2 cards were held back. The count resets on November 1. Plan details: ${PLANS_URL}`;

  it.each([
    ['7', 'a'],
    ['8', 'b'],
  ])(
    'answers create_deck for user %s (arm %s) with an ordinary result carrying the same text and the reason',
    async (owner, arm) => {
      const plansUrl = `https://2anki.net/pricing/?ref=mcp&k=limit&a=${arm}`;
      const message = `This deck would go over the free plan's 100 cards for this month, so it wasn't created. 2 cards were held back. The count resets on November 1. Plan details: ${plansUrl}`;
      const { client } = await connect({ owner });

      const result = await call(client, 'create_deck', {
        cards: [
          { front: 'What is ATP?', back: 'Energy currency.' },
          { front: 'What is DNA?', back: 'Heredity molecule.' },
        ],
      });

      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: message }]);
      expect(result.structuredContent).toEqual({
        code: 'monthly_limit',
        message,
        status: 'not_created',
        reason: 'monthly_limit',
        next_step: {
          plans_url: plansUrl,
          upgrade_url: plansUrl,
          cards_held_back: 2,
        },
      });
    }
  );

  it('records that no deck was made, why, and that it was not returned as an error', async () => {
    const { client, results } = await connect();

    await call(client, 'create_deck', {
      cards: [
        { front: 'What is ATP?', back: 'Energy currency.' },
        { front: 'What is DNA?', back: 'Heredity molecule.' },
      ],
    });

    expect(results).toEqual([
      {
        tool: 'create_deck',
        success: false,
        errorCode: 'monthly_limit',
        props: {
          cards_held_back: 2,
          held_for_plan: false,
          cards_delivered: 0,
          returned_as_error: false,
        },
      },
    ]);
  });

  it('answers convert_to_deck the same way', async () => {
    const { client, results } = await connect();

    const result = await call(client, 'convert_to_deck', {
      text: 'Q :: A',
    });

    const message = `This deck would go over the free plan's 100 cards for this month, so it wasn't created. The count resets on November 1. Plan details: ${PLANS_URL}`;
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: message }]);
    expect(result.structuredContent).toEqual({
      code: 'monthly_limit',
      message,
      status: 'not_created',
      reason: 'monthly_limit',
      next_step: { plans_url: PLANS_URL, upgrade_url: PLANS_URL },
    });
    expect(results).toEqual([
      {
        tool: 'convert_to_deck',
        success: false,
        errorCode: 'monthly_limit',
        props: {
          inputSource: 'text',
          inputFormat: 'none',
          cards_held_back: 0,
          held_for_plan: false,
          cards_delivered: 0,
          returned_as_error: false,
        },
      },
    ]);
  });
});

describe('genuine deck failures over the connector', () => {
  it('keeps bad create_deck input a tool error and records it as one', async () => {
    const { client, results } = await connect();

    const result = await call(client, 'create_deck', {
      cards: [{ front: '   ', back: 'A' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Every card needs a non-empty front.');
    expect(results).toEqual([
      {
        tool: 'create_deck',
        success: false,
        errorCode: undefined,
        props: { returned_as_error: true },
      },
    ]);
  });

  it.each([
    ['convert_to_deck', { text: 'x' }, 'convert_failed'],
    ['create_deck', { cards: [{ front: 'Q', back: 'A' }] }, 'create_failed'],
  ])(
    'records a %s call whose service throws as a tool error',
    async (tool, args, errorCode) => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { client, results } = await connect({
        uploadEntry: () => {
          throw new Error('upload pipeline down');
        },
      });

      const result = await call(client, tool, args);
      errorSpy.mockRestore();

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('upload pipeline down');
      expect(results).toEqual([
        {
          tool,
          success: false,
          errorCode,
          props: expect.objectContaining({ returned_as_error: true }),
        },
      ]);
    }
  );

  it('keeps a markdown file with no cards a tool error', async () => {
    const { client, results } = await connect({
      uploadEntry: (_req, res) => {
        res.status(400).json({
          code: 'markdown_likely_lossy',
          message: 'lossy',
          filename: 'notes.md',
        });
      },
    });

    const result = await call(client, 'convert_to_deck', {
      text: 'just prose',
      filename: 'notes.md',
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'markdown_likely_lossy',
    });
    expect(results[0]).toMatchObject({
      success: false,
      errorCode: 'markdown_likely_lossy',
      props: { returned_as_error: true },
    });
  });
});

describe('get_deck_preview over the connector', () => {
  it('answers a deck with no .apkg yet with an ordinary result and the same text', async () => {
    const { client, results } = await connect({
      jobs: async () => [job({ object_id: 'job-1', download_key: null })],
    });

    const result = await call(client, 'get_deck_preview', { jobId: 'job-1' });

    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'This deck has no .apkg to preview yet.' },
    ]);
    expect(result.structuredContent).toEqual({
      code: 'preview_failed',
      message: 'This deck has no .apkg to preview yet.',
      status: 'not_ready',
      reason: 'no_apkg_yet',
    });
    expect(results).toEqual([
      {
        tool: 'get_deck_preview',
        success: false,
        errorCode: 'no_apkg_yet',
        props: { returned_as_error: false },
      },
    ]);
  });

  it.each([
    ['failed', 'job_failed'],
    ['interrupted', 'job_interrupted'],
    ['cancelled', 'job_cancelled'],
  ])(
    'answers a %s job with no .apkg as an ordinary result saying no deck was made',
    async (status, reason) => {
      const { client, results } = await connect({
        jobs: async () => [job({ status, download_key: null })],
      });

      const result = await call(client, 'get_deck_preview', {
        jobId: 'job-1',
      });

      const message =
        'This conversion ended without a deck, so there is nothing to preview.';
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: message }]);
      expect(result.structuredContent).toEqual({
        code: 'preview_failed',
        message,
        status: 'failed',
        reason,
      });
      expect(results).toEqual([
        {
          tool: 'get_deck_preview',
          success: false,
          errorCode: reason,
          props: { returned_as_error: false },
        },
      ]);
    }
  );

  it('keeps an unknown deck a tool error and records it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, results } = await connect();

    const result = await call(client, 'get_deck_preview', {
      jobId: 'missing',
    });
    errorSpy.mockRestore();

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Deck not found.');
    expect(results).toEqual([
      {
        tool: 'get_deck_preview',
        success: false,
        errorCode: 'preview_failed',
        props: { returned_as_error: true },
      },
    ]);
  });

  it('records a missing identifier as a tool error', async () => {
    const { client, results } = await connect();

    const result = await call(client, 'get_deck_preview', {});

    expect(result.isError).toBe(true);
    expect(results).toEqual([
      {
        tool: 'get_deck_preview',
        success: false,
        errorCode: 'no_input',
        props: { returned_as_error: true },
      },
    ]);
  });
});

describe('list_my_decks over the connector', () => {
  it('records one successful result', async () => {
    const { client, results } = await connect({
      jobs: async () => [job({ download_key: 'deck.apkg' })],
    });

    const result = await call(client, 'list_my_decks', {});

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ total: 1 });
    expect(results).toEqual([
      {
        tool: 'list_my_decks',
        success: true,
        errorCode: undefined,
        props: { returned_as_error: false },
      },
    ]);
  });

  it('answers a failed lookup with a generic tool error and records it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, results } = await connect({
      jobs: async () => {
        throw new Error('relation "jobs" does not exist');
      },
    });

    const result = await call(client, 'list_my_decks', {});
    errorSpy.mockRestore();

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Could not load your decks.');
    expect(results).toEqual([
      {
        tool: 'list_my_decks',
        success: false,
        errorCode: 'list_failed',
        props: { returned_as_error: true },
      },
    ]);
  });
});

describe('deck_capabilities over the connector', () => {
  it('records one successful result', async () => {
    const { client, results } = await connect();

    const result = await call(client, 'deck_capabilities', {});

    expect(result.isError).not.toBe(true);
    expect(results).toEqual([
      {
        tool: 'deck_capabilities',
        success: true,
        errorCode: undefined,
        props: { returned_as_error: false },
      },
    ]);
  });
});

function photoUseCaseAtQuota(): PhotoToFlashcardsUseCase {
  const events = {
    countByNameForUser: async () => FREE_PHOTO_QUOTA_PER_MONTH,
  } as unknown as IEventsRepository;
  return new PhotoToFlashcardsUseCase(events);
}

describe('photo_to_deck over the connector', () => {
  beforeEach(() => {
    anthropicCreate.mockReset();
    anthropicConstructed.mockReset();
  });

  it.each([
    ['7', 'a'],
    ['8', 'b'],
  ])(
    'answers the free photo limit for user %s (arm %s) as an ordinary result with no model call',
    async (owner, arm) => {
      const { client, results } = await connect({
        owner,
        photoToFlashcards: photoUseCaseAtQuota(),
      });

      const result = await call(client, 'photo_to_deck', {
        image: ONE_PIXEL_PNG_BASE64,
      });

      const message = `You've used all 5 free photos for this month. The count resets on November 1. Plan details: https://2anki.net/pricing/?ref=mcp&k=photo&a=${arm}`;
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: message }]);
      expect(result.structuredContent).toEqual({
        code: 'photo_failed',
        message,
        status: 'not_created',
        reason: 'monthly_photo_limit',
      });
      expect(results).toEqual([
        {
          tool: 'photo_to_deck',
          success: false,
          errorCode: 'monthly_photo_limit',
          props: { returned_as_error: false },
        },
      ]);
      expect(anthropicConstructed).not.toHaveBeenCalled();
      expect(anthropicCreate).not.toHaveBeenCalled();
    }
  );

  it('keeps an unreadable photo a tool error with no model call and records it', async () => {
    const generateCards = vi.fn();
    const { client, results } = await connect({
      photoToFlashcards: {
        generateCards,
      } as unknown as PhotoToFlashcardsUseCase,
    });

    const result = await call(client, 'photo_to_deck', { image: '   ' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Provide a photo as a base64 string or data URL.'
    );
    expect(generateCards).not.toHaveBeenCalled();
    expect(results).toEqual([
      {
        tool: 'photo_to_deck',
        success: false,
        errorCode: 'photo_failed',
        props: { returned_as_error: true },
      },
    ]);
  });

  it('records a successful photo result', async () => {
    const { client, results } = await connect({
      photoToFlashcards: {
        generateCards: async () => ({
          cards: [{ front: 'Q', back: 'A' }],
          cardCount: 1,
        }),
      } as unknown as PhotoToFlashcardsUseCase,
    });

    const result = await call(client, 'photo_to_deck', {
      image: ONE_PIXEL_PNG_BASE64,
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ count: 1 });
    expect(results).toEqual([
      {
        tool: 'photo_to_deck',
        success: true,
        errorCode: undefined,
        props: { returned_as_error: false },
      },
    ]);
  });
});
