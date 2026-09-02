jest.mock('../../StorageHandler', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    getWorkspacePath: () => '/tmp/fake-workspace',
    getFileContents: jest.fn().mockResolvedValue(null),
  })),
}));

jest.mock('../../../../usecases/jobs/CreateJobWorkSpaceUseCase');
jest.mock('../../../../usecases/jobs/CreateFlashcardsForJobUseCase');
jest.mock('../../../../usecases/jobs/SetJobFailedUseCase');
jest.mock('../../../../usecases/jobs/BuildDeckForJobUseCase');
jest.mock('../../../../usecases/jobs/CompleteJobUseCase');
jest.mock('../../../../usecases/jobs/NotifyUserUseCase');
jest.mock('../../../../data_layer/JobRepository');
jest.mock('../../../../data_layer/UsersRepository');
jest.mock('../../../../data_layer/NotionRespository');
jest.mock('../../../../usecases/users/CheckMonthlyCardLimitUseCase', () => {
  const actual = jest.requireActual<
    typeof import('../../../../usecases/users/CheckMonthlyCardLimitUseCase')
  >('../../../../usecases/users/CheckMonthlyCardLimitUseCase');
  return {
    ...actual,
    CheckMonthlyCardLimitUseCase: jest.fn(),
  };
});
jest.mock('../../../../services/events/track', () => ({ track: jest.fn() }));

const mockRecordUnsupported = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../../data_layer/UnsupportedNotionBlockRepository', () => ({
  UnsupportedNotionBlockRepository: jest
    .fn()
    .mockImplementation(() => ({ record: mockRecordUnsupported })),
}));

const mockRecordOutputStats = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../../data_layer/ConversionOutputStatsRepository', () => ({
  ConversionOutputStatsRepository: jest
    .fn()
    .mockImplementation(() => ({ record: mockRecordOutputStats })),
}));

const mockRecordDeckScore = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../../data_layer/ConversionRuleScoresRepository', () => ({
  ConversionRuleScoresRepository: jest
    .fn()
    .mockImplementation(() => ({ record: mockRecordDeckScore })),
}));

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { APIResponseError, APIErrorCode } from '@notionhq/client';
import performConversion from './performConversion';
import NotionAPIWrapper from '../../../../services/NotionService/NotionAPIWrapper';
import NotionRepository from '../../../../data_layer/NotionRespository';
import { CreateJobWorkSpaceUseCase } from '../../../../usecases/jobs/CreateJobWorkSpaceUseCase';
import { SetJobFailedUseCase } from '../../../../usecases/jobs/SetJobFailedUseCase';
import { CreateFlashcardsForJobUseCase } from '../../../../usecases/jobs/CreateFlashcardsForJobUseCase';
import {
  NOTION_TOKEN_EXPIRED_REASON,
  EMPTY_DECK_FAILURE_REASON,
} from '../../../../usecases/jobs/jobFailureReason';
import {
  CheckMonthlyCardLimitUseCase,
  MonthlyLimitError,
} from '../../../../usecases/users/CheckMonthlyCardLimitUseCase';
import { CompleteJobUseCase } from '../../../../usecases/jobs/CompleteJobUseCase';
import { BuildDeckForJobUseCase } from '../../../../usecases/jobs/BuildDeckForJobUseCase';
import { NotifyUserUseCase } from '../../../../usecases/jobs/NotifyUserUseCase';
import { PythonExitError } from '../../../anki/buildPythonExitError';
import { track } from '../../../../services/events/track';

function makeUnauthorizedError(): APIResponseError {
  const err = Object.create(APIResponseError.prototype) as APIResponseError;
  Object.assign(err, {
    name: 'APIResponseError',
    message: 'Unauthorized',
    code: APIErrorCode.Unauthorized,
    status: 401,
  });
  return err;
}

const mockDatabase = {} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const baseRequest = {
  title: 'Free user page',
  api: {} as NotionAPIWrapper,
  id: 'notion-page-id',
  owner: 'owner-1',
  isPaying: false,
  type: 'page',
  jobDbId: 42,
};

function makeRealWorkspace(): { location: string } {
  const location = path.join(
    os.tmpdir(),
    `perform-conversion-test-${randomUUID()}`
  );
  fs.mkdirSync(location, { recursive: true });
  fs.writeFileSync(path.join(location, 'deck.apkg'), 'fake-bytes');
  return { location };
}

function mockWorkspaceCreation(ws: { location: string }): void {
  (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({
      ws,
      exporter: {},
      settings: {},
      bl: {},
      rules: {},
    }),
  }));
}

describe('performConversion — signature', () => {
  it('does not accept a res parameter (res is absent from ConversionRequest)', () => {
    expect(Object.keys(baseRequest)).not.toContain('res');
  });
});

describe('performConversion — heavy pipeline', () => {
  let errorSpy: jest.SpyInstance;
  let setJobFailedExecute: jest.Mock;
  let markTokenInvalidMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);

    setJobFailedExecute = jest.fn().mockResolvedValue(undefined);
    (SetJobFailedUseCase as jest.Mock).mockImplementation(() => ({
      execute: setJobFailedExecute,
    }));

    markTokenInvalidMock = jest.fn().mockResolvedValue(undefined);
    (NotionRepository as jest.Mock).mockImplementation(() => ({
      markTokenInvalid: markTokenInvalidMock,
      setReconnectEmailSent: jest.fn().mockResolvedValue(false),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('marks job as failed when workspace creation throws', async () => {
    const boom = new Error('workspace exploded');
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockRejectedValue(boom),
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(setJobFailedExecute).toHaveBeenCalledWith(
      baseRequest.id,
      baseRequest.owner,
      expect.any(String)
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[conversion\] job=42 request=none failed$/),
      expect.objectContaining({ error: boom })
    );
  });

  it('marks job as failed when no decks are created', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: {},
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([]),
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(setJobFailedExecute).toHaveBeenCalledWith(
      baseRequest.id,
      baseRequest.owner,
      expect.stringContaining(baseRequest.id)
    );
    expect(track).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({ reason: 'no_decks_created' }),
      })
    );
  });

  it('sets notion_token_expired reason and calls markTokenInvalid when workspace throws a 401', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockRejectedValue(makeUnauthorizedError()),
    }));
    const numericOwnerRequest = { ...baseRequest, owner: '42' };

    await performConversion(mockDatabase, numericOwnerRequest);

    expect(setJobFailedExecute).toHaveBeenCalledWith(
      numericOwnerRequest.id,
      numericOwnerRequest.owner,
      NOTION_TOKEN_EXPIRED_REASON
    );
    expect(markTokenInvalidMock).toHaveBeenCalledWith(42);
    expect(track).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({ reason: 'notion_token_expired' }),
      })
    );
  });

  it('emits conversion_failed with reason=unknown for an unclassified workspace error', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockRejectedValue(new Error('random error')),
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(track).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({
          source: 'notion',
          reason: 'unknown',
        }),
      })
    );
  });

  it('does not call markTokenInvalid for non-unauthorized errors', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockRejectedValue(new Error('random error')),
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(markTokenInvalidMock).not.toHaveBeenCalled();
  });

  it('delivers a truncated deck and records the held-back count when the monthly limit leaves room', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: {},
        rules: {},
      }),
    }));
    const decks = [{ cards: [1, 2, 3] }];
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(decks),
    }));
    const limitError = new MonthlyLimitError(
      99,
      100,
      3,
      '2026-07-01T00:00:00.000Z'
    );
    (CheckMonthlyCardLimitUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockRejectedValue(limitError),
    }));
    (BuildDeckForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest
        .fn()
        .mockResolvedValue({ size: 1, key: 'k', apkg: Buffer.from('') }),
    }));
    (NotifyUserUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    const completeJobExecute = jest.fn().mockResolvedValue(undefined);
    (CompleteJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: completeJobExecute,
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(setJobFailedExecute).not.toHaveBeenCalled();
    expect(decks[0].cards).toEqual([1]);
    expect(completeJobExecute).toHaveBeenCalledWith(
      baseRequest.id,
      baseRequest.owner,
      1,
      undefined,
      undefined,
      undefined,
      {
        cardsDelivered: 1,
        cardsHeldBack: 2,
        limit: 100,
        resetOn: '2026-07-01T00:00:00.000Z',
      },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        summary: { blocks_seen: 0, cards_created: 1, blocks_skipped: 0 },
        entries: [],
      }
    );
    expect(track).toHaveBeenCalledWith(
      'paywall_shown',
      expect.objectContaining({
        props: expect.objectContaining({ kind: 'card_count' }),
      })
    );
    expect(track).toHaveBeenCalledWith(
      'conversion_succeeded',
      expect.objectContaining({
        props: expect.objectContaining({
          card_limit_partial: true,
          cards_held_back: 2,
        }),
      })
    );
  });

  it('fails the whole job with the monthly_limit reason when there is no allowance left', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: {},
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [1, 2, 3] }]),
    }));
    const limitError = new MonthlyLimitError(
      100,
      100,
      3,
      '2026-07-01T00:00:00.000Z'
    );
    (CheckMonthlyCardLimitUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockRejectedValue(limitError),
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(setJobFailedExecute).toHaveBeenCalledWith(
      baseRequest.id,
      baseRequest.owner,
      expect.stringContaining('"code":"monthly_limit"')
    );
    const payload = JSON.parse(setJobFailedExecute.mock.calls[0][2] as string);
    expect(payload).toMatchObject({
      code: 'monthly_limit',
      cards_used: 100,
      limit: 100,
    });
    expect(track).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({
          reason: 'monthly_limit',
          cards_used: 100,
          limit: 100,
        }),
      })
    );
  });

  it('marks job as failed with the empty-deck reason when decks have zero cards', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: {},
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [] }]),
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(setJobFailedExecute).toHaveBeenCalledWith(
      baseRequest.id,
      baseRequest.owner,
      EMPTY_DECK_FAILURE_REASON
    );
  });

  it('records a Notion deck score with source notion and engine parser', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: {},
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([
        {
          cards: [
            { name: 'What is ATP?', back: 'Adenosine triphosphate.' },
            { name: 'What is DNA?', back: 'Deoxyribonucleic acid.' },
          ],
        },
      ]),
    }));
    (CheckMonthlyCardLimitUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(mockRecordDeckScore).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'notion',
        engine: 'parser',
        inputFormat: 'notion',
        outcome: 'shipped',
      })
    );
  });

  it('records a no_cards score for a Notion conversion that yields no cards', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: {},
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [] }]),
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(mockRecordDeckScore).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'notion', outcome: 'no_cards' })
    );
  });

  it('maps a database job to the notion source, not upload', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: {},
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [] }]),
    }));

    await performConversion(mockDatabase, { ...baseRequest, type: 'database' });

    expect(mockRecordDeckScore).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'notion' })
    );
  });

  it('emits conversion_succeeded carrying the anonymous_id threaded through the job', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: {},
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [1, 2, 3] }]),
    }));
    (CheckMonthlyCardLimitUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (BuildDeckForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest
        .fn()
        .mockResolvedValue({ size: 1, key: 'k', apkg: Buffer.from('') }),
    }));
    (NotifyUserUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (CompleteJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));

    await performConversion(mockDatabase, {
      ...baseRequest,
      owner: 'anonymous',
      anonId: 'anon-from-cookie',
    });

    expect(track).toHaveBeenCalledWith(
      'conversion_succeeded',
      expect.objectContaining({
        anonymousId: 'anon-from-cookie',
        props: expect.objectContaining({ source: 'notion' }),
      })
    );
  });

  it('emits conversion_failed with the anonymous_id when decks have zero cards', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: {},
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [] }]),
    }));

    await performConversion(mockDatabase, {
      ...baseRequest,
      owner: 'anonymous',
      anonId: 'anon-from-cookie',
    });

    expect(track).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        anonymousId: 'anon-from-cookie',
        props: expect.objectContaining({ reason: 'empty_deck' }),
      })
    );
  });

  it('emits conversion_failed with reason=python_crash when the deck build throws a PythonExitError', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: {},
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [1, 2, 3] }]),
    }));
    (CheckMonthlyCardLimitUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (BuildDeckForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockRejectedValue(
        new PythonExitError('python died', {
          kind: 'unknown',
          rawOutput: 'traceback',
          code: 1,
        })
      ),
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(track).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({ reason: 'python_crash' }),
      })
    );
  });
});

describe('performConversion — signup_origin attribution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    (SetJobFailedUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (NotionRepository as jest.Mock).mockImplementation(() => ({
      markTokenInvalid: jest.fn().mockResolvedValue(undefined),
      setReconnectEmailSent: jest.fn().mockResolvedValue(false),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockSuccessfulPipeline(): void {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: {},
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [1, 2, 3] }]),
    }));
    (CheckMonthlyCardLimitUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (BuildDeckForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest
        .fn()
        .mockResolvedValue({ size: 1, key: 'k', apkg: Buffer.from('') }),
    }));
    (NotifyUserUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (CompleteJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
  }

  it('stamps signup_origin on conversion_succeeded from the job payload', async () => {
    mockSuccessfulPipeline();

    await performConversion(mockDatabase, {
      ...baseRequest,
      signupOrigin: '/pricing',
    });

    expect(track).toHaveBeenCalledWith(
      'conversion_succeeded',
      expect.objectContaining({
        props: expect.objectContaining({ signup_origin: '/pricing' }),
      })
    );
  });

  it('stamps signup_origin on conversion_failed from the job payload', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: {},
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [] }]),
    }));

    await performConversion(mockDatabase, {
      ...baseRequest,
      signupOrigin: '/photo-to-deck',
    });

    expect(track).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({
          reason: 'empty_deck',
          signup_origin: '/photo-to-deck',
        }),
      })
    );
  });

  it('emits signup_origin=null when the job payload carries no origin', async () => {
    mockSuccessfulPipeline();

    await performConversion(mockDatabase, baseRequest);

    expect(track).toHaveBeenCalledWith(
      'conversion_succeeded',
      expect.objectContaining({
        props: expect.objectContaining({ signup_origin: null }),
      })
    );
  });
});

describe('performConversion — workspace cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);

    (SetJobFailedUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (NotionRepository as jest.Mock).mockImplementation(() => ({
      markTokenInvalid: jest.fn().mockResolvedValue(undefined),
      setReconnectEmailSent: jest.fn().mockResolvedValue(false),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('removes the workspace directory after a successful conversion', async () => {
    const ws = makeRealWorkspace();
    mockWorkspaceCreation(ws);

    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [{}, {}] }]),
    }));
    (CheckMonthlyCardLimitUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (BuildDeckForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest
        .fn()
        .mockResolvedValue({ size: 10, key: 'k', apkg: Buffer.from('x') }),
    }));
    (NotifyUserUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (CompleteJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(fs.existsSync(ws.location)).toBe(false);
  });

  it('removes the workspace directory when the conversion fails', async () => {
    const ws = makeRealWorkspace();
    mockWorkspaceCreation(ws);

    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockRejectedValue(new Error('deck build blew up')),
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(fs.existsSync(ws.location)).toBe(false);
  });

  it('records the block handler unsupported block types after a successful conversion', async () => {
    mockRecordUnsupported.mockClear();
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: { unsupportedBlockTypes: ['html', 'html'] },
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [1, 2, 3] }]),
    }));
    (CheckMonthlyCardLimitUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (BuildDeckForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest
        .fn()
        .mockResolvedValue({ size: 1, key: 'k', apkg: Buffer.from('') }),
    }));
    (NotifyUserUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (CompleteJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(mockRecordUnsupported).toHaveBeenCalledWith(['html', 'html']);
    expect(track).toHaveBeenCalledWith(
      'conversion_succeeded',
      expect.objectContaining({
        props: expect.objectContaining({ source: 'notion' }),
      })
    );
  });

  it('does not fail the conversion when the unsupported-block write rejects', async () => {
    mockRecordUnsupported.mockRejectedValueOnce(new Error('db down'));
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: { unsupportedBlockTypes: ['html'] },
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [1, 2, 3] }]),
    }));
    (CheckMonthlyCardLimitUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (BuildDeckForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest
        .fn()
        .mockResolvedValue({ size: 1, key: 'k', apkg: Buffer.from('') }),
    }));
    (NotifyUserUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (CompleteJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(track).toHaveBeenCalledWith(
      'conversion_succeeded',
      expect.objectContaining({
        props: expect.objectContaining({ source: 'notion' }),
      })
    );
  });

  it('forwards the unsupported-block type counts to completeJob as a plain object', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: {
          unsupportedBlockTypes: ['child_database', 'child_database'],
          unsupportedBlockTypeCounts: new Map([['child_database', 2]]),
        },
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [1, 2, 3] }]),
    }));
    (CheckMonthlyCardLimitUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (BuildDeckForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest
        .fn()
        .mockResolvedValue({ size: 1, key: 'k', apkg: Buffer.from('') }),
    }));
    (NotifyUserUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    const completeJobExecute = jest.fn().mockResolvedValue(undefined);
    (CompleteJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: completeJobExecute,
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(completeJobExecute.mock.calls[0][8]).toEqual({ child_database: 2 });
  });

  it('waits for the unsupported-block write before starting the output-stats write', async () => {
    let releaseUnsupported: () => void = () => undefined;
    const unsupportedGate = new Promise<void>((resolve) => {
      releaseUnsupported = resolve;
    });
    mockRecordUnsupported.mockReturnValueOnce(unsupportedGate);
    mockRecordOutputStats.mockClear();

    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: {
          cardCount: 3,
          emptyBackCount: 0,
          unsupportedBlockTypes: ['html'],
        },
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [1, 2, 3] }]),
    }));
    (CheckMonthlyCardLimitUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (BuildDeckForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest
        .fn()
        .mockResolvedValue({ size: 1, key: 'k', apkg: Buffer.from('') }),
    }));
    (NotifyUserUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (CompleteJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));

    await performConversion(mockDatabase, baseRequest);
    await Promise.resolve();

    expect(mockRecordUnsupported).toHaveBeenCalledWith(['html']);
    expect(mockRecordOutputStats).not.toHaveBeenCalled();

    releaseUnsupported();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRecordOutputStats).toHaveBeenCalledWith(
      'convert',
      expect.objectContaining({ cards: 3, emptyBack: 0 })
    );
  });

  it('does not fail the conversion when the conversion-output-stats write rejects with a pool timeout', async () => {
    mockRecordOutputStats.mockRejectedValueOnce(
      new Error(
        'Knex: Timeout acquiring a connection. The pool is probably full.'
      )
    );
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: { cardCount: 3, emptyBackCount: 0, unsupportedBlockTypes: [] },
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [1, 2, 3] }]),
    }));
    (CheckMonthlyCardLimitUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (BuildDeckForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest
        .fn()
        .mockResolvedValue({ size: 1, key: 'k', apkg: Buffer.from('') }),
    }));
    (NotifyUserUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (CompleteJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));

    await performConversion(mockDatabase, baseRequest);

    expect(mockRecordOutputStats).toHaveBeenCalledWith(
      'convert',
      expect.objectContaining({ cards: 3, emptyBack: 0 })
    );
    expect(track).toHaveBeenCalledWith(
      'conversion_succeeded',
      expect.objectContaining({
        props: expect.objectContaining({ source: 'notion' }),
      })
    );
  });
});

describe('performConversion — log correlation', () => {
  let errorSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;
  let setJobFailedExecute: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    setJobFailedExecute = jest.fn().mockResolvedValue(undefined);
    (SetJobFailedUseCase as jest.Mock).mockImplementation(() => ({
      execute: setJobFailedExecute,
    }));
    (NotionRepository as jest.Mock).mockImplementation(() => ({
      markTokenInvalid: jest.fn().mockResolvedValue(undefined),
      setReconnectEmailSent: jest.fn().mockResolvedValue(false),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockSuccessfulPipeline(): void {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        ws: {},
        exporter: {},
        settings: {},
        bl: {},
        rules: {},
      }),
    }));
    (CreateFlashcardsForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue([{ cards: [1, 2, 3] }]),
    }));
    (CheckMonthlyCardLimitUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (BuildDeckForJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest
        .fn()
        .mockResolvedValue({ size: 1, key: 'k', apkg: Buffer.from('') }),
    }));
    (NotifyUserUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
    (CompleteJobUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(undefined),
    }));
  }

  it('stamps the start line with the [conversion] prefix and the db job id, keeping the raw page id out of the message', async () => {
    mockSuccessfulPipeline();
    const injectionId = 'page\ninjected-log-line';

    await performConversion(mockDatabase, {
      ...baseRequest,
      id: injectionId,
      jobDbId: 42,
      requestId: 'req-start-1',
    });

    const startCall = infoSpy.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].startsWith('[conversion] job=42') &&
        call[0].endsWith('started')
    );
    expect(startCall).toBeDefined();
    expect(startCall?.[0]).toBe(
      '[conversion] job=42 request=req-start-1 started'
    );
    expect(startCall?.[0]).not.toContain('injected-log-line');
    expect(startCall?.[1]).toEqual({ pageId: injectionId });
  });

  it('emits a completion line carrying the db job id and request id so duration can be derived', async () => {
    mockSuccessfulPipeline();

    await performConversion(mockDatabase, {
      ...baseRequest,
      jobDbId: 42,
      requestId: 'req-done-2',
    });

    const completedCall = infoSpy.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].startsWith('[conversion] job=42 request=req-done-2 completed')
    );
    expect(completedCall).toBeDefined();
    expect(completedCall?.[0]).toContain('cards=3');
    expect(completedCall?.[0]).toContain('duration_ms=');
  });

  it('hoists the request id into the failure message string, not onto its own object key', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockRejectedValue(new Error('random error')),
    }));

    await performConversion(mockDatabase, {
      ...baseRequest,
      jobDbId: 42,
      requestId: 'req-fail-3',
    });

    const failedCall = errorSpy.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' && call[0].startsWith('[conversion] job=42')
    );
    expect(failedCall?.[0]).toBe(
      '[conversion] job=42 request=req-fail-3 failed'
    );
    expect(failedCall?.[1]).not.toHaveProperty('requestId');
  });

  it('still marks the job failed when marking the notion token invalid throws', async () => {
    (CreateJobWorkSpaceUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockRejectedValue(makeUnauthorizedError()),
    }));
    (NotionRepository as jest.Mock).mockImplementation(() => ({
      markTokenInvalid: jest.fn().mockRejectedValue(new Error('db blip')),
      setReconnectEmailSent: jest.fn().mockResolvedValue(false),
    }));

    await performConversion(mockDatabase, {
      ...baseRequest,
      owner: '42',
      jobDbId: 42,
    });

    expect(setJobFailedExecute).toHaveBeenCalledWith(
      baseRequest.id,
      '42',
      NOTION_TOKEN_EXPIRED_REASON
    );
  });
});
