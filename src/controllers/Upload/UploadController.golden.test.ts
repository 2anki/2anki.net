import { vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import jwt from 'jsonwebtoken';

const s3Puts = vi.hoisted(() => [] as string[]);
const s3Objects = vi.hoisted(() => new Map<string, Buffer>());

vi.mock('@aws-sdk/client-s3', async (importActual) => {
  const actual = await importActual<typeof import('@aws-sdk/client-s3')>();
  class RecordingS3Client {
    async send(command: { input?: { Key?: string; Body?: unknown } }) {
      const key = command.input?.Key ?? '';
      if (command instanceof actual.PutObjectCommand) {
        s3Puts.push(key);
        s3Objects.set(key, Buffer.from(command.input?.Body as Buffer));
      }
      if (command instanceof actual.GetObjectCommand && s3Objects.has(key)) {
        const bytes = s3Objects.get(key) as Buffer;
        return { Body: { transformToByteArray: async () => bytes } };
      }
      if (command instanceof actual.DeleteObjectCommand) {
        s3Objects.delete(key);
      }
      return {};
    }
  }
  return { ...actual, S3Client: RecordingS3Client };
});

const passCredits = vi.hoisted(() => ({ spentUsd: 0 }));

vi.mock(
  '../../data_layer/createAnonymousPassCreditReaders',
  async (importActual) => {
    const actual =
      await importActual<
        typeof import('../../data_layer/createAnonymousPassCreditReaders')
      >();
    return {
      createAnonymousPassCreditReaders: (
        ...args: Parameters<typeof actual.createAnonymousPassCreditReaders>
      ) => ({
        ...actual.createAnonymousPassCreditReaders(...args),
        passCostSince: () => Promise.resolve(passCredits.spentUsd),
      }),
    };
  }
);

vi.mock('../../lib/anki/CardGenerator', () => ({
  __esModule: true,
  default: class FakePythonCardGenerator {
    constructor(private readonly currentDirectory: string) {}
    async run(): Promise<string> {
      const deckInfo = JSON.parse(
        fs.readFileSync(
          path.join(this.currentDirectory, 'deck_info.json'),
          'utf8'
        )
      ) as { cards: unknown[] }[];
      const cards = deckInfo.reduce((sum, deck) => sum + deck.cards.length, 0);
      const apkgPath = path.join(this.currentDirectory, 'golden.apkg');
      fs.writeFileSync(apkgPath, `golden-apkg cards=${cards}`);
      return apkgPath;
    }
  },
}));

vi.mock('../../lib/conversionPool', async (importActual) => {
  const actual =
    await importActual<typeof import('../../lib/conversionPool')>();
  const worker = await import('../../usecases/uploads/worker');
  return {
    ...actual,
    runUploadGeneration: worker.runUploadGenerationInWorker,
  };
});

const claudeReplies = vi.hoisted(() => ({
  conversion: '',
  preview: '',
  vision: '',
}));

vi.mock('@anthropic-ai/sdk', async (importActual) => {
  const actual = await importActual<typeof import('@anthropic-ai/sdk')>();
  const reply = (text: string) => ({
    model: 'claude-golden',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  });
  const isVisionRequest = (params: {
    messages: { content: unknown }[];
  }): boolean =>
    params.messages.some(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some(
          (block: { type?: string }) => block.type === 'image'
        )
    );
  class StubAnthropic {
    messages = {
      stream: () => {
        const stream = {
          on: () => stream,
          finalMessage: () => Promise.resolve(reply(claudeReplies.conversion)),
        };
        return stream;
      },
      create: (params: { messages: { content: unknown }[] }) =>
        Promise.resolve(
          reply(
            isVisionRequest(params)
              ? claudeReplies.vision
              : claudeReplies.preview
          )
        ),
    };
  }
  return { ...actual, default: StubAnthropic };
});

vi.mock('node:child_process', async (importActual) => {
  const actual = await importActual<typeof import('node:child_process')>();
  const { EventEmitter } = await import('node:events');
  function spawnDeckBridge(deckInfoPath: string) {
    const proc = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    const deckInfo = JSON.parse(fs.readFileSync(deckInfoPath, 'utf8')) as {
      cards: unknown[];
    }[];
    const cards = deckInfo.reduce((sum, deck) => sum + deck.cards.length, 0);
    const apkgPath = path.join(path.dirname(deckInfoPath), 'golden.apkg');
    fs.writeFileSync(apkgPath, `golden-apkg cards=${cards}`);
    setImmediate(() => {
      proc.stdout.emit('data', Buffer.from(`${apkgPath}\n`));
      proc.emit('close', 0);
    });
    return proc;
  }
  const spawn = (
    command: string,
    args: readonly string[] = [],
    options: Record<string, unknown> = {}
  ) =>
    args[0]?.endsWith('create_deck.py') === true
      ? spawnDeckBridge(args[1])
      : actual.spawn(command, args, options);
  return { ...actual, spawn };
});

vi.mock('../../data_layer', async (importActual) => {
  const actual = await importActual<typeof import('../../data_layer')>();
  const { default: knex } = await import('knex');
  const database = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  return { ...actual, getDatabase: () => database };
});

const driveDownload = vi.hoisted(() => ({ body: '' }));

vi.mock(
  '../../services/observability/instrumentedAxios',
  async (importActual) => {
    const actual =
      await importActual<
        typeof import('../../services/observability/instrumentedAxios')
      >();
    return {
      ...actual,
      default: {
        ...actual.default,
        get: (
          ...args: Parameters<typeof actual.default.get>
        ): ReturnType<typeof actual.default.get> =>
          args[0] === 'google_drive'
            ? (Promise.resolve({
                data: Buffer.from(driveDownload.body),
              }) as ReturnType<typeof actual.default.get>)
            : actual.default.get(...args),
      },
    };
  }
);

vi.mock('../../services/events/eventsSinkInstance', () => ({
  getEventsSink: () => ({
    record: () => undefined,
    flushDurable: () => Promise.resolve(),
  }),
  resetEventsSinkForTesting: () => undefined,
}));

import UploadController from './UploadController';
import UploadService from '../../services/UploadService';
import type NotionService from '../../services/NotionService';
import type JobRepository from '../../data_layer/JobRepository';
import type UsersRepository from '../../data_layer/UsersRepository';
import type { IUploadRepository } from '../../data_layer/UploadRespository';
import type Uploads from '../../data_layer/public/Uploads';
import type { IFeatureFlagsRepository } from '../../data_layer/FeatureFlagsRepository';
import {
  __resetFeatureFlagModuleForTests,
  __setFeatureFlagDependencies,
} from '../../lib/featureFlags/getFeatureFlag';
import { ANONYMOUS_DAY_PASS_CARD_FLAG } from '../../lib/upload/anonymousDayPassCard';
import { LIMIT_WALL_PASS_FIRST_FLAG } from '../../lib/featureFlags/limitWallPassFirst';
import { fakeUploadServiceDeps } from '../../test/fakes/uploadServiceDeps';
import { ANONYMOUS_AI_PREVIEW_FLAG } from '../../lib/upload/anonymousAiPreview';
import { PhotoToFlashcardsUseCase } from '../../usecases/imageOcclusion/PhotoToFlashcardsUseCase';
import type { IEventsRepository } from '../../data_layer/EventsRepository';
import { getDatabase } from '../../data_layer';
import RequireAllowedOrigin from '../../routes/middleware/RequireAllowedOrigin';
import { tellUploadOwner } from '../../routes/middleware/tellUploadOwner';
import { anonIdMiddleware } from '../../routes/middleware/anonIdMiddleware';
import { InMemoryHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import { AnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import { AiPreviewResumeController } from './AiPreviewResumeController';
import { ResumeAnonymousAiPreviewUseCase } from '../../usecases/uploads/ResumeAnonymousAiPreviewUseCase';
import { getCheckoutSessionBinding } from '../../usecases/checkout/getCheckoutSessionBinding';
import StorageHandler from '../../lib/storage/StorageHandler';

const SMALL_DECK_CARDS = 5;
const LARGE_DECK_CARDS = 120;
const OWNER = 4242;
const SESSION_SECRET = 'golden-session-secret';
const ALLOWED_ORIGIN = 'https://2anki.net';
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const AI_CARDS = [
  { q: 'What is a golden test?', a: 'A snapshot of what users get back' },
  { q: 'What does it guard?', a: 'The upload response for each population' },
  { q: 'Who reads it?', a: 'Every PR that touches uploads' },
];
const CLAUDE_REPLIES = {
  conversion: JSON.stringify([{ deck: 'Golden Small', cards: AI_CARDS }]),
  preview: JSON.stringify(AI_CARDS.map(({ q, a }) => ({ front: q, back: a }))),
  vision: JSON.stringify([{ deck: 'Golden Photo', cards: AI_CARDS }]),
};

function notionToggleExport(title: string, cardCount: number): string {
  const toggles = Array.from(
    { length: cardCount },
    (_, i) =>
      `<ul class="toggle"><li><details open=""><summary>Question ${i + 1}</summary><p>Answer ${i + 1}</p></details></li></ul>`
  ).join('');
  return `<html><head><title>${title}</title></head><body><article class="page sans"><header><h1 class="page-title">${title}</h1></header><div class="page-body">${toggles}</div></article></body></html>`;
}

const UPLOADS = {
  small: {
    filename: 'Golden Small.html',
    body: notionToggleExport('Golden Small', SMALL_DECK_CARDS),
    type: 'text/html',
  },
  large: {
    filename: 'Golden Large.html',
    body: notionToggleExport('Golden Large', LARGE_DECK_CARDS),
    type: 'text/html',
  },
  photo: {
    filename: 'Golden Photo.png',
    body: ONE_PIXEL_PNG,
    type: 'image/png',
  },
};

interface Population {
  locals: Record<string, unknown>;
  cookies: Record<string, string>;
  headers: Record<string, string>;
  cardsUsed: number;
  flags: Record<string, boolean>;
  fields?: Record<string, string>;
  photosUsedThisMonth?: number;
  previewReply?: string;
  realAuth?: boolean;
  mintsAnonId?: boolean;
  passSpentUsd?: number;
}

const signedOut: Population = {
  locals: {},
  cookies: { anon_id: 'golden-anon' },
  headers: {},
  cardsUsed: 0,
  flags: {},
};

const signedInFree: Population = {
  locals: { owner: OWNER, patreon: false, subscriber: false },
  cookies: { token: 'session', anon_id: 'golden-anon' },
  headers: {},
  cardsUsed: 0,
  flags: {},
};

const signedOutPassHolderWithRecoveryToken: Population = {
  ...signedOut,
  locals: { subscriber: true, passKind: '24h', anonymousPassId: 7 },
  headers: {
    'x-pass-token': 'golden-pass-token',
    'x-recovery-token': '0b6f2c1e-3a4d-4e5f-8a9b-1c2d3e4f5a6b',
  },
};

const cases: [string, keyof typeof UPLOADS, Population][] = [
  ['signed-out under the anonymous cap', 'small', signedOut],
  ['signed-out over the cap', 'large', signedOut],
  [
    'signed-out over the cap, day pass card on',
    'large',
    { ...signedOut, flags: { [ANONYMOUS_DAY_PASS_CARD_FLAG]: true } },
  ],
  [
    'signed-out over the cap, pass-first wall on',
    'large',
    { ...signedOut, flags: { [LIMIT_WALL_PASS_FIRST_FLAG]: true } },
  ],
  [
    'signed-out over the cap, no anon id',
    'large',
    { ...signedOut, cookies: {} },
  ],
  [
    'signed-out over the cap, no anon id, day pass card on',
    'large',
    {
      ...signedOut,
      cookies: {},
      flags: { [ANONYMOUS_DAY_PASS_CARD_FLAG]: true },
    },
  ],
  [
    'signed-out over the cap, anon id cookie minted on the upload itself',
    'large',
    { ...signedOut, cookies: {}, mintsAnonId: true },
  ],
  [
    'signed-out over the cap, anon id cookie minted on the upload itself, day pass card on',
    'large',
    {
      ...signedOut,
      cookies: {},
      mintsAnonId: true,
      flags: { [ANONYMOUS_DAY_PASS_CARD_FLAG]: true },
    },
  ],
  [
    'signed-out with an expired session cookie, under the cap',
    'small',
    {
      ...signedOut,
      cookies: { token: 'expired-session', anon_id: 'golden-anon' },
    },
  ],
  [
    'signed-out with an expired session cookie, over the cap',
    'large',
    {
      ...signedOut,
      cookies: { token: 'expired-session', anon_id: 'golden-anon' },
    },
  ],
  [
    'signed-out with an expired session cookie, over the cap, no anon id',
    'large',
    {
      ...signedOut,
      cookies: { token: 'expired-session' },
    },
  ],
  [
    'signed-out with an expired session cookie, over the cap, day pass card on',
    'large',
    {
      ...signedOut,
      cookies: { token: 'expired-session', anon_id: 'golden-anon' },
      flags: { [ANONYMOUS_DAY_PASS_CARD_FLAG]: true },
    },
  ],
  [
    'signed-out with an expired session cookie, over the cap, no anon id, pass-first wall on',
    'large',
    {
      ...signedOut,
      cookies: { token: 'expired-session' },
      flags: { [LIMIT_WALL_PASS_FIRST_FLAG]: true },
    },
  ],
  [
    'signed-out pass holder with an expired session cookie',
    'large',
    {
      ...signedOut,
      cookies: { token: 'expired-session', anon_id: 'golden-anon' },
      locals: { subscriber: true, passKind: '24h', anonymousPassId: 7 },
      headers: { 'x-pass-token': 'golden-pass-token' },
    },
  ],
  ['signed-in free under the monthly limit', 'small', signedInFree],
  [
    'signed-in free whose upload exceeds the monthly limit',
    'large',
    signedInFree,
  ],
  [
    'signed-in free with 10 cards left this month',
    'large',
    { ...signedInFree, cardsUsed: 90 },
  ],
  [
    'signed-in free with the monthly limit used up',
    'small',
    { ...signedInFree, cardsUsed: 100 },
  ],
  [
    'paying subscriber',
    'large',
    {
      ...signedInFree,
      locals: { owner: OWNER, patreon: false, subscriber: true },
      cardsUsed: 100,
    },
  ],
  [
    'lifetime (patreon) user',
    'large',
    {
      ...signedInFree,
      locals: { owner: OWNER, patreon: true, subscriber: false },
      cardsUsed: 100,
    },
  ],
  [
    'signed-in pass holder',
    'large',
    {
      ...signedInFree,
      locals: {
        owner: OWNER,
        patreon: false,
        subscriber: true,
        passKind: '24h',
      },
      cardsUsed: 100,
    },
  ],
  [
    'signed-out pass holder',
    'large',
    {
      ...signedOut,
      locals: { subscriber: true, passKind: '24h', anonymousPassId: 7 },
      headers: { 'x-pass-token': 'golden-pass-token' },
    },
  ],
  [
    'signed-out pass holder with a recovery token',
    'large',
    signedOutPassHolderWithRecoveryToken,
  ],
];

const AI_ON = { 'claude-ai-flashcards': 'true' };
const PAYING_OWNER = 4343;
const PASS_SESSION_ID = 'cs_golden_pass';
const LOCALS_PASS_ID = 7;
const FREE_SESSION = jwt.sign({ userId: OWNER }, SESSION_SECRET);
const PAYING_SESSION = jwt.sign({ userId: PAYING_OWNER }, SESSION_SECRET);
const SIGNED_OUT_SESSION = jwt.sign(
  { userId: OWNER, session: 'signed-out' },
  SESSION_SECRET
);

const aiCases: [string, keyof typeof UPLOADS, Population][] = [
  [
    'paying subscriber with AI on',
    'small',
    {
      ...signedInFree,
      locals: { owner: OWNER, patreon: false, subscriber: true },
      fields: AI_ON,
    },
  ],
  [
    'lifetime (patreon) user with AI on',
    'small',
    {
      ...signedInFree,
      locals: { owner: OWNER, patreon: true, subscriber: false },
      fields: AI_ON,
    },
  ],
  [
    'signed-in pass holder with AI on',
    'small',
    {
      ...signedInFree,
      locals: {
        owner: OWNER,
        patreon: false,
        subscriber: true,
        passKind: '24h',
      },
      fields: AI_ON,
    },
  ],
  ['signed-in free with AI on', 'small', { ...signedInFree, fields: AI_ON }],
  [
    'signed-out with AI on, AI preview off',
    'small',
    { ...signedOut, fields: AI_ON },
  ],
  [
    'signed-out with AI on, AI preview on',
    'small',
    {
      ...signedOut,
      fields: AI_ON,
      flags: { [ANONYMOUS_AI_PREVIEW_FLAG]: true },
    },
  ],
  [
    'signed-out with AI on, AI preview on, no sample came back',
    'small',
    {
      ...signedOut,
      fields: AI_ON,
      flags: { [ANONYMOUS_AI_PREVIEW_FLAG]: true },
      previewReply: '[]',
    },
  ],
  [
    'signed-out with AI on, AI preview off, over the cap',
    'large',
    { ...signedOut, fields: AI_ON },
  ],
  [
    'signed-out with AI on, AI preview on, no sample came back, over the cap',
    'large',
    {
      ...signedOut,
      fields: AI_ON,
      flags: { [ANONYMOUS_AI_PREVIEW_FLAG]: true },
      previewReply: '[]',
    },
  ],
  [
    'signed-out with AI on, AI preview off, over the cap, anon id cookie minted on the upload itself',
    'large',
    { ...signedOut, cookies: {}, mintsAnonId: true, fields: AI_ON },
  ],
  [
    'signed-out with AI on, AI preview on, no sample came back, over the cap, anon id cookie minted on the upload itself',
    'large',
    {
      ...signedOut,
      cookies: {},
      mintsAnonId: true,
      fields: AI_ON,
      flags: { [ANONYMOUS_AI_PREVIEW_FLAG]: true },
      previewReply: '[]',
    },
  ],
  [
    'signed-out with AI on, AI preview on, no anon id',
    'small',
    {
      ...signedOut,
      cookies: {},
      fields: AI_ON,
      flags: { [ANONYMOUS_AI_PREVIEW_FLAG]: true },
    },
  ],
  [
    'signed-out pass holder with AI on',
    'small',
    {
      ...signedOut,
      locals: {
        subscriber: true,
        passKind: '24h',
        anonymousPassId: LOCALS_PASS_ID,
      },
      headers: { 'x-pass-token': 'golden-pass-token' },
      fields: AI_ON,
    },
  ],
  [
    'signed-out pass holder with AI on, AI credits spent',
    'small',
    {
      ...signedOut,
      locals: {
        subscriber: true,
        passKind: '24h',
        anonymousPassId: LOCALS_PASS_ID,
      },
      headers: { 'x-pass-token': 'golden-pass-token' },
      fields: AI_ON,
      passSpentUsd: 1000,
    },
  ],
];

const photoCases: [string, keyof typeof UPLOADS, Population][] = [
  [
    'signed-in free photo upload',
    'photo',
    { ...signedInFree, photosUsedThisMonth: 0 },
  ],
  [
    'signed-in free photo upload with the monthly photo quota used up',
    'photo',
    { ...signedInFree, photosUsedThisMonth: 5 },
  ],
  [
    'paying subscriber photo upload past the free photo quota',
    'photo',
    {
      ...signedInFree,
      locals: { owner: OWNER, patreon: false, subscriber: true },
      photosUsedThisMonth: 5,
    },
  ],
  ['signed-out photo upload', 'photo', signedOut],
];

const realAuthCases: [string, keyof typeof UPLOADS, Population][] = [
  [
    'real session: signed-in free under the monthly limit',
    'small',
    { ...signedOut, realAuth: true, cookies: { token: FREE_SESSION } },
  ],
  [
    'real session: paying subscriber with AI on',
    'small',
    {
      ...signedOut,
      realAuth: true,
      cookies: { token: PAYING_SESSION },
      fields: AI_ON,
    },
  ],
  [
    'real session: signed out since, over the cap',
    'large',
    {
      ...signedOut,
      realAuth: true,
      cookies: { token: SIGNED_OUT_SESSION, anon_id: 'golden-anon' },
    },
  ],
  [
    'real pass token: lapsed, signed-out over the cap',
    'large',
    {
      ...signedOut,
      realAuth: true,
      headers: { 'x-pass-token': 'cs_golden_lapsed' },
    },
  ],
  [
    'real pass token: lapsed, signed-out over the cap with AI on',
    'large',
    {
      ...signedOut,
      realAuth: true,
      headers: { 'x-pass-token': 'cs_golden_lapsed' },
      fields: AI_ON,
    },
  ],
  [
    'real pass token: signed-out Day Pass holder',
    'large',
    {
      ...signedOut,
      realAuth: true,
      headers: { 'x-pass-token': PASS_SESSION_ID },
    },
  ],
  [
    'real pass token: signed-out Day Pass holder with AI on',
    'small',
    {
      ...signedOut,
      realAuth: true,
      headers: { 'x-pass-token': PASS_SESSION_ID },
      fields: AI_ON,
    },
  ],
  [
    'real middleware: origin not on the allowlist',
    'small',
    {
      ...signedOut,
      realAuth: true,
      headers: { origin: 'https://not-2anki.example' },
    },
  ],
];

function inMemoryFlags(
  values: Record<string, boolean>
): IFeatureFlagsRepository {
  return {
    getAll: () => Promise.resolve([]),
    get: (key: string) => Promise.resolve(values[key] ?? null),
    set: () => Promise.resolve(null),
  };
}

const cardUsageCharges: number[] = [];

function inMemoryUsers(initialCardsUsed: number): UsersRepository {
  let cardsUsed = initialCardsUsed;
  return {
    getCardUsage: () =>
      Promise.resolve({
        cards_used: cardsUsed,
        month_started_at: new Date('2026-10-01T00:00:00Z'),
      }),
    incrementCardUsage: (_owner: number, count: number) => {
      cardsUsed += count;
      cardUsageCharges.push(count);
      return Promise.resolve(1);
    },
    getCardOptions: () => Promise.resolve(null),
  } as unknown as UsersRepository;
}

function inMemoryUploads(): IUploadRepository {
  const unsupported = () => Promise.reject(new Error('not used by upload'));
  return {
    deleteUpload: () => Promise.resolve(1),
    getUploadsByOwner: () => Promise.resolve([] as Uploads[]),
    findByIdAndOwner: () => Promise.resolve(null),
    findByObjectId: () => Promise.resolve(null),
    findByKey: () => Promise.resolve(null),
    findAllByObjectIdAndOwner: () => Promise.resolve([] as Uploads[]),
    update: () => Promise.resolve([] as Uploads[]),
    getLastUploadForUser: () => Promise.resolve(null),
    getLastReconvertibleUpload: () => Promise.resolve(null),
    findByOwnerAndDedupeKey: () => Promise.resolve(null),
    insertNativeDeck: unsupported,
    insertConvertedDeck: unsupported,
  };
}

interface JobTimeline {
  title: string;
  type: string;
  statuses: string[];
  outcome?: string;
}

const jobTimelines: JobTimeline[] = [];
let settleJob: () => void = () => undefined;

function inMemoryJobs(): JobRepository {
  const byId = new Map<string, JobTimeline>();
  const settle = (id: string, outcome: string) => {
    const timeline = byId.get(id);
    if (timeline != null) {
      timeline.outcome = outcome.replaceAll(id, '<job-id>');
    }
    settleJob();
  };
  return {
    create: (id: string, _owner: string, title: string, type: string) => {
      const timeline = { title, type, statuses: [] };
      byId.set(id, timeline);
      jobTimelines.push(timeline);
      return Promise.resolve();
    },
    updateJobStatus: (
      id: string,
      _owner: string,
      status: string,
      reason?: string
    ) => {
      byId.get(id)?.statuses.push(status);
      if (status === 'failed') {
        settle(id, `failed: ${reason ?? ''}`);
      }
      return Promise.resolve();
    },
    findJobById: (id: string) =>
      Promise.resolve(byId.has(id) ? { id, object_id: id } : null),
    deleteJob: (id: string) => {
      settle(id, 'moved to My Decks');
      return Promise.resolve();
    },
  } as unknown as JobRepository;
}

function inMemoryPhotoEvents(photosUsedThisMonth: number): IEventsRepository {
  return {
    countByNameForUser: () => Promise.resolve(photosUsedThisMonth),
  } as unknown as IEventsRepository;
}

async function seedAuthDatabase() {
  const database = getDatabase();
  await database.schema.createTable('users', (t) => {
    t.integer('id').primary();
    t.text('email').notNullable();
    t.boolean('patreon').defaultTo(false);
  });
  await database.schema.createTable('access_tokens', (t) => {
    t.integer('owner').notNullable();
    t.text('token').notNullable();
    t.timestamp('created_at').defaultTo(database.fn.now());
  });
  await database.schema.createTable('subscriptions', (t) => {
    t.increments('id').primary();
    t.text('email');
    t.text('linked_email');
    t.boolean('active').defaultTo(false);
  });
  await database.schema.createTable('user_passes', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable();
    t.text('kind').notNullable();
    t.timestamp('expires_at').notNullable();
    t.text('stripe_payment_intent_id');
  });
  await database.schema.createTable('anonymous_passes', (t) => {
    t.increments('id').primary();
    t.text('stripe_session_id').notNullable();
    t.text('kind').notNullable();
    t.timestamp('expires_at').notNullable();
    t.text('payment_intent_id');
    t.integer('claimed_by_user_id');
    t.text('buyer_email_hash');
    t.timestamp('activated_at');
  });
  await database('users').insert([
    { id: OWNER, email: 'free@example.com', patreon: false },
    { id: PAYING_OWNER, email: 'paying@example.com', patreon: false },
  ]);
  await database('access_tokens').insert([
    { owner: OWNER, token: FREE_SESSION },
    { owner: PAYING_OWNER, token: PAYING_SESSION },
  ]);
  await database('subscriptions').insert({
    email: 'paying@example.com',
    active: true,
  });
  const dayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await database('anonymous_passes').insert({
    stripe_session_id: PASS_SESSION_ID,
    kind: '24h',
    expires_at: dayFromNow,
    payment_intent_id: 'pi_golden',
    activated_at: new Date(),
  });
  await database('anonymous_passes').insert({
    id: LOCALS_PASS_ID,
    stripe_session_id: 'cs_golden_locals_pass',
    kind: '24h',
    expires_at: dayFromNow,
    payment_intent_id: 'pi_golden_locals',
    activated_at: new Date(),
  });
}

const CLIENT_HEADERS = [
  'location',
  'file-name',
  'content-disposition',
  'access-control-expose-headers',
];

function clientHeaders(response: Response): Record<string, string> {
  const picked: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    const userFacing =
      (name.startsWith('x-') && name !== 'x-powered-by') ||
      CLIENT_HEADERS.includes(name);
    if (userFacing) {
      picked[name] = name === 'x-download-key' ? '<download-key>' : value;
    }
  });
  return Object.fromEntries(
    Object.entries(picked).sort(([a], [b]) => a.localeCompare(b))
  );
}

async function clientBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = (await response.json()) as Record<string, unknown>;
    return typeof body.jobId === 'string'
      ? { ...body, jobId: '<job-id>' }
      : body;
  }
  if (response.headers.get('content-disposition')?.startsWith('attachment')) {
    return { apkg: await response.text() };
  }
  return { text: await response.text() };
}

let population: Population = signedOut;
let server: http.Server;
let baseUrl: string;
let uploadBase: string;
const GOLDEN_ENV: Record<string, string | undefined> = {
  SKIP_CREATE_DECK: undefined,
  SPACES_ENDPOINT: 'https://golden-storage.invalid',
  SPACES_DEFAULT_BUCKET_NAME: 'golden-bucket',
  SECRET: SESSION_SECRET,
  STRIPE_KEY: undefined,
  LOCAL_DEV: undefined,
};
const originalEnv = Object.fromEntries(
  [...Object.keys(GOLDEN_ENV), 'UPLOAD_BASE'].map((key) => [
    key,
    process.env[key],
  ])
);

function applyEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function storedObjectKind(key: string): string {
  if (key.startsWith('held/')) {
    return 'held source file';
  }
  return key.startsWith('recover/') ? 'recovery copy' : 'deck';
}

let heldDecks = new InMemoryHeldDeckRepository();

function goldenService(): UploadService {
  return new UploadService(
    inMemoryUploads(),
    inMemoryJobs(),
    inMemoryUsers(population.cardsUsed),
    ...fakeUploadServiceDeps({
      photoToFlashcards: new PhotoToFlashcardsUseCase(
        inMemoryPhotoEvents(population.photosUsedThisMonth ?? 0)
      ),
      heldDeck: heldDecks,
    })
  );
}

function goldenController(): UploadController {
  return new UploadController(goldenService(), {} as unknown as NotionService);
}

const checkoutMetadata = new Map<string, Record<string, string>>();
const stubStripe = {
  checkout: {
    sessions: {
      retrieve: (sessionId: string) =>
        Promise.resolve({ metadata: checkoutMetadata.get(sessionId) ?? {} }),
    },
  },
} as unknown as Parameters<typeof getCheckoutSessionBinding>[0];

function goldenResumeController(): AiPreviewResumeController {
  return new AiPreviewResumeController(
    new ResumeAnonymousAiPreviewUseCase(
      heldDecks,
      new StorageHandler(),
      goldenService(),
      new AnonymousPassRepository(getDatabase()),
      (sessionId) => getCheckoutSessionBinding(stubStripe, sessionId)
    )
  );
}

beforeAll(async () => {
  await seedAuthDatabase();
  uploadBase = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-golden-'));
  applyEnv({ ...GOLDEN_ENV, UPLOAD_BASE: uploadBase });
  const app = express();
  app.use(cookieParser());
  app.post(
    '/api/upload/file',
    (req, res, next) => {
      res.locals.requestId = 'golden-request';
      if (population.realAuth === true) {
        return RequireAllowedOrigin(req, res, () =>
          tellUploadOwner(req, res, next)
        );
      }
      Object.assign(res.locals, population.locals);
      if (population.mintsAnonId === true) {
        return anonIdMiddleware(req, res, next);
      }
      next();
    },
    (req, res) => {
      goldenController().file(req, res);
    }
  );
  app.post(
    '/api/upload/google_drive',
    (req, res, next) => {
      res.locals.requestId = 'golden-request';
      if (population.mintsAnonId === true) {
        return anonIdMiddleware(req, res, next);
      }
      next();
    },
    multer().none(),
    (req, res) => goldenController().googleDrive(req, res)
  );
  app.post(
    '/api/upload/ai-preview/resume',
    (req, res, next) => {
      res.locals.requestId = 'golden-request';
      if (population.realAuth === true) {
        return RequireAllowedOrigin(req, res, next);
      }
      Object.assign(res.locals, population.locals);
      next();
    },
    (req, res) => goldenResumeController().resume(req, res)
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(uploadBase, { recursive: true, force: true });
  applyEnv(originalEnv);
});

afterEach(() => {
  __resetFeatureFlagModuleForTests();
  heldDecks = new InMemoryHeldDeckRepository();
  checkoutMetadata.clear();
  passCredits.spentUsd = 0;
  s3Objects.clear();
  s3Puts.length = 0;
  cardUsageCharges.length = 0;
  jobTimelines.length = 0;
});

async function upload(file: keyof typeof UPLOADS, who: Population) {
  population = who;
  passCredits.spentUsd = who.passSpentUsd ?? 0;
  __setFeatureFlagDependencies({ repository: inMemoryFlags(who.flags) });
  Object.assign(claudeReplies, CLAUDE_REPLIES, {
    preview: who.previewReply ?? CLAUDE_REPLIES.preview,
  });
  const form = new FormData();
  for (const [name, value] of Object.entries(who.fields ?? {})) {
    form.append(name, value);
  }
  form.append(
    'pakker',
    new Blob([UPLOADS[file].body], { type: UPLOADS[file].type }),
    UPLOADS[file].filename
  );
  const cookie = Object.entries(who.cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  const jobSettled = new Promise<void>((resolve) => {
    settleJob = resolve;
  });
  const response = await fetch(`${baseUrl}/api/upload/file`, {
    method: 'POST',
    body: form,
    redirect: 'manual',
    headers: {
      ...(who.realAuth === true ? { origin: ALLOWED_ORIGIN } : {}),
      ...who.headers,
      ...(cookie === '' ? {} : { cookie }),
    },
  });
  return goldenResult(response, jobSettled);
}

async function goldenResult(response: Response, jobSettled: Promise<void>) {
  const status = response.status;
  const contentType = (response.headers.get('content-type') ?? '').split(
    ';'
  )[0];
  const headers = clientHeaders(response);
  const body = await clientBody(response);
  if (status === 202) {
    await jobSettled;
  }
  return {
    status,
    contentType,
    headers,
    body,
    ...(jobTimelines.length > 0 ? { backgroundJobs: [...jobTimelines] } : {}),
    storedObjects: s3Puts.map(storedObjectKind),
    cardsCharged: [...cardUsageCharges],
  };
}

async function driveImport(file: keyof typeof UPLOADS, who: Population) {
  population = who;
  __setFeatureFlagDependencies({ repository: inMemoryFlags(who.flags) });
  driveDownload.body = String(UPLOADS[file].body);
  const form = new FormData();
  form.append(
    'files',
    JSON.stringify([
      {
        id: 'golden-drive-file',
        name: UPLOADS[file].filename,
        mimeType: UPLOADS[file].type,
        sizeBytes: Buffer.byteLength(String(UPLOADS[file].body)),
      },
    ])
  );
  form.append('googleDriveAuth', 'golden-drive-token');
  const cookie = Object.entries(who.cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  const jobSettled = new Promise<void>((resolve) => {
    settleJob = resolve;
  });
  const response = await fetch(`${baseUrl}/api/upload/google_drive`, {
    method: 'POST',
    body: form,
    redirect: 'manual',
    headers: cookie === '' ? {} : { cookie },
  });
  return goldenResult(response, jobSettled);
}

const driveCases: [string, keyof typeof UPLOADS, Population][] = [
  ['signed-out Google Drive import over the cap', 'large', signedOut],
  [
    'signed-out Google Drive import over the cap, no anon id',
    'large',
    { ...signedOut, cookies: {} },
  ],
  [
    'signed-out Google Drive import over the cap, anon id cookie minted on the import itself',
    'large',
    { ...signedOut, cookies: {}, mintsAnonId: true },
  ],
];

describe('what each population gets back from a Google Drive import', () => {
  it.each(driveCases)(
    '%s',
    async (_label, file, who) => {
      expect(await driveImport(file, who)).toMatchSnapshot();
    },
    20_000
  );
});

describe('what each population gets back from /api/upload/file', () => {
  it.each(cases)(
    '%s',
    async (_label, file, who) => {
      expect(await upload(file, who)).toMatchSnapshot();
    },
    20_000
  );
});

describe('a signed-out upload held over the cap', () => {
  it('says the anon id cookie was minted on this request, so the browser may not keep it', async () => {
    const result = await upload('large', {
      ...signedOut,
      cookies: {},
      mintsAnonId: true,
    });
    expect(result.body).toMatchObject({ kind: 'held', cookieMinted: true });
  });

  it('says nothing about the cookie when the browser presented its anon id', async () => {
    const result = await upload('large', { ...signedOut, mintsAnonId: true });
    expect(result.body).toMatchObject({ kind: 'held' });
    expect(result.body).not.toHaveProperty('cookieMinted');
  });
});

describe('a signed-out pass holder can fetch the paid deck again', () => {
  it('stores a recovery copy of the full deck under recover/', async () => {
    const result = await upload('large', signedOutPassHolderWithRecoveryToken);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      apkg: `golden-apkg cards=${LARGE_DECK_CARDS}`,
    });
    expect(s3Puts).toEqual([
      expect.stringMatching(/^recover\/[0-9a-f]{64}\.apkg$/),
    ]);
  }, 20_000);
});

describe('what each population gets back from an AI upload', () => {
  it.each(aiCases)(
    '%s',
    async (_label, file, who) => {
      expect(await upload(file, who)).toMatchSnapshot();
    },
    20_000
  );
});

describe('what each population gets back from a photo upload', () => {
  it.each(photoCases)(
    '%s',
    async (_label, file, who) => {
      expect(await upload(file, who)).toMatchSnapshot();
    },
    20_000
  );
});

describe('what the real auth middleware resolves before the upload', () => {
  it.each(realAuthCases)(
    '%s',
    async (_label, file, who) => {
      expect(await upload(file, who)).toMatchSnapshot();
    },
    20_000
  );
});

const AI_PREVIEW_VISITOR: Population = {
  ...signedOut,
  fields: AI_ON,
  flags: { [ANONYMOUS_AI_PREVIEW_FLAG]: true },
};

const dayPassHolderOnThisBrowser: Population = {
  ...signedOut,
  realAuth: true,
  headers: { 'x-pass-token': PASS_SESSION_ID },
};

interface ResumeCase {
  previewedFirst: boolean;
  boughtOnAnonId: string;
  who: Population;
}

const resumeCases: [string, ResumeCase][] = [
  [
    'Day Pass holder resuming the AI preview this browser started',
    {
      previewedFirst: true,
      boughtOnAnonId: 'golden-anon',
      who: dayPassHolderOnThisBrowser,
    },
  ],
  [
    'Day Pass bought from another browser',
    {
      previewedFirst: true,
      boughtOnAnonId: 'another-anon',
      who: dayPassHolderOnThisBrowser,
    },
  ],
  [
    'Day Pass holder with no AI preview waiting',
    {
      previewedFirst: false,
      boughtOnAnonId: 'golden-anon',
      who: dayPassHolderOnThisBrowser,
    },
  ],
  [
    'Day Pass holder with no anon id cookie',
    {
      previewedFirst: true,
      boughtOnAnonId: 'golden-anon',
      who: { ...dayPassHolderOnThisBrowser, cookies: {} },
    },
  ],
  [
    'signed-out visitor with no pass',
    {
      previewedFirst: true,
      boughtOnAnonId: 'golden-anon',
      who: { ...signedOut, realAuth: true },
    },
  ],
  [
    'Day Pass holder resuming with the AI credits spent',
    {
      previewedFirst: true,
      boughtOnAnonId: 'golden-anon',
      who: { ...dayPassHolderOnThisBrowser, passSpentUsd: 1000 },
    },
  ],
];

async function resumeAiPreview(who: Population) {
  population = who;
  passCredits.spentUsd = who.passSpentUsd ?? 0;
  __setFeatureFlagDependencies({ repository: inMemoryFlags(who.flags) });
  Object.assign(claudeReplies, CLAUDE_REPLIES);
  s3Puts.length = 0;
  const cookie = Object.entries(who.cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  const response = await fetch(`${baseUrl}/api/upload/ai-preview/resume`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...(who.realAuth === true ? { origin: ALLOWED_ORIGIN } : {}),
      ...who.headers,
      ...(cookie === '' ? {} : { cookie }),
    },
  });
  const result = await goldenResult(response, Promise.resolve());
  return {
    ...result,
    heldPreviewsLeft: heldDecks.rows.length,
    heldObjectsLeft: [...s3Objects.keys()].filter((key) =>
      key.startsWith('held/')
    ).length,
  };
}

async function previewThenResume({
  previewedFirst,
  boughtOnAnonId,
  who,
}: ResumeCase) {
  checkoutMetadata.set(PASS_SESSION_ID, {
    anon_id: boughtOnAnonId,
    surface: 'ai-preview',
  });
  if (previewedFirst) {
    const preview = await upload('small', AI_PREVIEW_VISITOR);
    expect(preview.status).toBe(200);
  }
  return resumeAiPreview(who);
}

describe('what each population gets back from the Day Pass AI preview resume', () => {
  it.each(resumeCases)(
    '%s',
    async (_label, resumeCase) => {
      expect(await previewThenResume(resumeCase)).toMatchSnapshot();
    },
    20_000
  );

  it('bills a resumed preview once: a second resume finds nothing waiting', async () => {
    const first = await previewThenResume(resumeCases[0][1]);
    const second = await resumeAiPreview(dayPassHolderOnThisBrowser);

    expect(first.status).toBe(200);
    expect(second.status).toBe(404);
    expect(second.body).toEqual({ code: 'no_ai_preview' });
  }, 20_000);

  it('refuses a resume on spent credits and keeps the held file for a retry', async () => {
    const spent = await previewThenResume({
      previewedFirst: true,
      boughtOnAnonId: 'golden-anon',
      who: { ...dayPassHolderOnThisBrowser, passSpentUsd: 1000 },
    });

    expect(spent).toMatchObject({
      status: 402,
      body: { code: 'ai_credits_exhausted' },
      heldPreviewsLeft: 1,
      heldObjectsLeft: 1,
    });

    const retried = await resumeAiPreview(dayPassHolderOnThisBrowser);
    expect(retried.status).toBe(200);
    expect(retried.heldPreviewsLeft).toBe(0);
  }, 20_000);
});
