import ImportApkgToNotionUseCase from './ImportApkgToNotionUseCase';
import ApkgPreviewService from '../../services/ApkgPreviewService/ApkgPreviewService';
import ApkgToNotionBlocksService from '../../services/ApkgToNotionBlocksService';
import NotionAPIWrapper from '../../services/NotionService/NotionAPIWrapper';
import JobRepository from '../../data_layer/JobRepository';
import { NormalizedCollection } from '../../services/ApkgPreviewService/types';
import { ParsedApkg } from '../../services/ApkgPreviewService/ApkgPreviewService';
import { APIErrorCode, APIResponseError } from '@notionhq/client';

function makeCollection(noteCount: number): NormalizedCollection {
  const noteTypes = new Map([
    [
      1,
      {
        id: 1,
        name: 'Basic',
        type: 0 as const,
        css: '',
        fields: [
          { name: 'Front', ord: 0 },
          { name: 'Back', ord: 1 },
        ],
        templates: [{ name: 'Card 1', ord: 0, qfmt: '', afmt: '' }],
      },
    ],
  ]);

  const notes = new Map(
    Array.from({ length: noteCount }, (_, i) => [
      i + 1,
      {
        id: i + 1,
        mid: 1,
        tags: '',
        fields: [`Front ${i + 1}`, `Back ${i + 1}`],
      },
    ])
  );

  return {
    noteTypes,
    notes,
    decks: new Map([[1, { id: 1, name: 'Test Deck' }]]),
    cards: Array.from({ length: noteCount }, (_, i) => ({
      id: i + 1,
      nid: i + 1,
      did: 1,
      ord: 0,
    })),
  };
}

function makeParsed(noteCount: number): ParsedApkg {
  return {
    collection: makeCollection(noteCount),
    mediaMap: new Map(),
    mediaEntries: new Map(),
    parsedAt: Date.now(),
  };
}

describe('ImportApkgToNotionUseCase', () => {
  let previewService: jest.Mocked<ApkgPreviewService>;
  let blocksService: ApkgToNotionBlocksService;
  let jobRepository: jest.Mocked<JobRepository>;
  let notionApi: jest.Mocked<NotionAPIWrapper>;
  let useCase: ImportApkgToNotionUseCase;

  beforeEach(() => {
    previewService = {
      parse: jest.fn(),
      getMeta: jest.fn(),
      getCardsPage: jest.fn(),
      getMediaEntry: jest.fn(),
    } as unknown as jest.Mocked<ApkgPreviewService>;

    blocksService = new ApkgToNotionBlocksService();

    jobRepository = {
      updateJobStatus: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue(undefined),
      findJobById: jest.fn(),
    } as unknown as jest.Mocked<JobRepository>;

    notionApi = {
      createPage: jest.fn().mockResolvedValue({ id: 'page-123' }),
      appendBlocks: jest.fn().mockResolvedValue({}),
      getPage: jest
        .fn()
        .mockResolvedValue({ url: 'https://notion.so/page-123' }),
      uploadFile: jest.fn().mockResolvedValue('file-upload-123'),
    } as unknown as jest.Mocked<NotionAPIWrapper>;

    useCase = new ImportApkgToNotionUseCase(
      previewService,
      blocksService,
      jobRepository
    );
  });

  it('creates Notion pages and reports completion', async () => {
    previewService.parse.mockResolvedValue(makeParsed(3));

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { maxNotes: 10000 }
    );

    expect(notionApi.createPage).toHaveBeenCalledWith(
      'parent-page',
      'Test Deck'
    );
    expect(notionApi.appendBlocks).toHaveBeenCalled();

    const finalUpdate =
      jobRepository.updateJobStatus.mock.calls[
        jobRepository.updateJobStatus.mock.calls.length - 1
      ];
    expect(finalUpdate[2]).toBe('done');
    const result = JSON.parse(finalUpdate[3] as string);
    expect(result.imported).toBe(3);
    expect(result.total_notes).toBe(3);
    expect(result.notion_page_url).toBe('https://notion.so/page-123');
  });

  it('imports up to the cap and prepends a truncation notice for free users', async () => {
    previewService.parse.mockResolvedValue(makeParsed(5));

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { isPaying: false, maxNotes: 2 }
    );

    const firstBatch = notionApi.appendBlocks.mock
      .calls[0][1] as unknown as Array<{
      type: string;
      paragraph?: { rich_text: Array<{ plain_text: string }> };
    }>;
    expect(firstBatch[0].type).toBe('paragraph');
    expect(firstBatch[0].paragraph!.rich_text[0].plain_text).toBe(
      'Imported the first 2 of 5 notes.'
    );
    const upsell = firstBatch[1].paragraph!.rich_text[0].plain_text;
    expect(upsell).toContain('Upgrade at 2anki.net/pricing');
    expect(firstBatch[2].type).toBe('divider');

    const noteToggles = firstBatch.filter((b) => b.type === 'heading_3');
    expect(noteToggles).toHaveLength(2);

    const finalUpdate =
      jobRepository.updateJobStatus.mock.calls[
        jobRepository.updateJobStatus.mock.calls.length - 1
      ];
    expect(finalUpdate[2]).toBe('done');
    const result = JSON.parse(finalUpdate[3] as string);
    expect(result.imported).toBe(2);
    expect(result.total_notes).toBe(5);
    expect(result.truncated).toBe(true);
    expect(result.note_cap).toBe(2);
  });

  it('writes no truncation notice for paying users without an upgrade pitch', async () => {
    previewService.parse.mockResolvedValue(makeParsed(4));

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { isPaying: true, maxNotes: 3 }
    );

    const firstBatch = notionApi.appendBlocks.mock
      .calls[0][1] as unknown as Array<{
      type: string;
      paragraph?: { rich_text: Array<{ plain_text: string }> };
    }>;
    const noticeText = firstBatch[0]
      .paragraph!.rich_text.map((s) => s.plain_text)
      .join('');
    expect(noticeText).toBe(
      'Imported the first 3 of 4 notes. The remaining 1 notes were not imported — your plan imports up to 3 notes at a time.'
    );
    expect(noticeText).not.toContain('pricing');
    const contactText = firstBatch[1].paragraph!.rich_text[0].plain_text;
    expect(contactText).toBe(
      'Need a higher limit? Email support@2anki.net and we will raise it for you.'
    );
    expect(firstBatch[2].type).toBe('divider');
  });

  it('adds no notice when the deck is under the cap', async () => {
    previewService.parse.mockResolvedValue(makeParsed(2));

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { maxNotes: 10000 }
    );

    const firstBatch = notionApi.appendBlocks.mock
      .calls[0][1] as unknown as Array<{ type: string }>;
    expect(firstBatch.every((b) => b.type === 'heading_3')).toBe(true);

    const finalUpdate =
      jobRepository.updateJobStatus.mock.calls[
        jobRepository.updateJobStatus.mock.calls.length - 1
      ];
    const result = JSON.parse(finalUpdate[3] as string);
    expect(result.truncated).toBe(false);
  });

  it('tracks progress during batch writes', async () => {
    previewService.parse.mockResolvedValue(makeParsed(3));

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { maxNotes: 10000 }
    );

    const progressCalls = jobRepository.updateJobStatus.mock.calls.filter(
      (c) => c[2] === 'processing'
    );
    expect(progressCalls.length).toBeGreaterThanOrEqual(1);
    expect(progressCalls[0][3]).toMatch(/0\/3/);
  });

  it('marks the job as failed on Notion API errors', async () => {
    previewService.parse.mockResolvedValue(makeParsed(1));
    notionApi.createPage.mockRejectedValue(new Error('Notion rate limit'));

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { maxNotes: 10000 }
    );

    const failCall = jobRepository.updateJobStatus.mock.calls.find(
      (c) => c[2] === 'failed'
    );
    expect(failCall).toBeDefined();
    expect(failCall![3]).toBe(
      'Import failed. Please try again or contact support.'
    );
  });

  function makeNotionError(code: string, status: number): APIResponseError {
    return new APIResponseError({
      code: code as APIErrorCode,
      message: `Notion error: ${code}`,
      status,
      headers: {},
      rawBodyText: '',
      additional_data: undefined,
      request_id: undefined,
    });
  }

  it('surfaces a reconnect message on Notion 401 unauthorized', async () => {
    previewService.parse.mockResolvedValue(makeParsed(1));
    notionApi.createPage.mockRejectedValue(
      makeNotionError(APIErrorCode.Unauthorized, 401)
    );

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { maxNotes: 10000 }
    );

    const failCall = jobRepository.updateJobStatus.mock.calls.find(
      (c) => c[2] === 'failed'
    );
    expect(failCall![3]).toBe(
      'Notion sign-in expired. Reconnect Notion and try again.'
    );
  });

  it('surfaces a permissions message on Notion 403 restricted resource', async () => {
    previewService.parse.mockResolvedValue(makeParsed(1));
    notionApi.createPage.mockRejectedValue(
      makeNotionError(APIErrorCode.RestrictedResource, 403)
    );

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { maxNotes: 10000 }
    );

    const failCall = jobRepository.updateJobStatus.mock.calls.find(
      (c) => c[2] === 'failed'
    );
    expect(failCall![3]).toBe(
      "2anki can't write to this Notion page. Share it with the 2anki integration."
    );
  });

  it('surfaces a page-deleted message on Notion 404 object not found', async () => {
    previewService.parse.mockResolvedValue(makeParsed(1));
    notionApi.createPage.mockRejectedValue(
      makeNotionError(APIErrorCode.ObjectNotFound, 404)
    );

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { maxNotes: 10000 }
    );

    const failCall = jobRepository.updateJobStatus.mock.calls.find(
      (c) => c[2] === 'failed'
    );
    expect(failCall![3]).toBe(
      'The Notion page is gone. Pick a different destination page.'
    );
  });

  it('surfaces a rate-limit message on Notion 429', async () => {
    previewService.parse.mockResolvedValue(makeParsed(1));
    notionApi.createPage.mockRejectedValue(
      makeNotionError(APIErrorCode.RateLimited, 429)
    );

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { maxNotes: 10000 }
    );

    const failCall = jobRepository.updateJobStatus.mock.calls.find(
      (c) => c[2] === 'failed'
    );
    expect(failCall![3]).toBe(
      'Notion is rate-limiting this account. Try again in a minute.'
    );
  });

  it('surfaces a trashed-page message on a Notion archived-ancestor 400', async () => {
    previewService.parse.mockResolvedValue(makeParsed(1));
    notionApi.createPage.mockRejectedValue(
      new APIResponseError({
        code: APIErrorCode.ValidationError,
        message:
          "Can't edit page on block with an archived ancestor. You must unarchive the ancestor before editing page.",
        status: 400,
        headers: {},
        rawBodyText: '',
        additional_data: undefined,
        request_id: undefined,
      })
    );

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { maxNotes: 10000 }
    );

    const failCall = jobRepository.updateJobStatus.mock.calls.find(
      (c) => c[2] === 'failed'
    );
    expect(failCall![3]).toBe(
      'The Notion page you picked is in the trash. Restore it in Notion or pick a different destination page.'
    );
  });

  it('keeps the generic message for other Notion 400 validation errors', async () => {
    previewService.parse.mockResolvedValue(makeParsed(1));
    notionApi.createPage.mockRejectedValue(
      makeNotionError(APIErrorCode.ValidationError, 400)
    );

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { maxNotes: 10000 }
    );

    const failCall = jobRepository.updateJobStatus.mock.calls.find(
      (c) => c[2] === 'failed'
    );
    expect(failCall![3]).toBe(
      'Import failed. Please try again or contact support.'
    );
  });

  it.each([
    [APIErrorCode.InternalServerError, 500],
    [APIErrorCode.ServiceUnavailable, 503],
    [APIErrorCode.GatewayTimeout, 504],
  ])('surfaces a Notion outage message on 5xx (%s)', async (code, status) => {
    previewService.parse.mockResolvedValue(makeParsed(1));
    notionApi.createPage.mockRejectedValue(makeNotionError(code, status));

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { maxNotes: 10000 }
    );

    const failCall = jobRepository.updateJobStatus.mock.calls.find(
      (c) => c[2] === 'failed'
    );
    expect(failCall![3]).toBe(
      'Notion is having issues. Try again in a few minutes.'
    );
  });

  it('surfaces a parse-error message when previewService.parse throws a sqlite error', async () => {
    const sqliteError = Object.assign(new Error('file is not a database'), {
      code: 'SQLITE_NOTADB',
    });
    previewService.parse.mockRejectedValue(sqliteError);

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { maxNotes: 10000 }
    );

    const failCall = jobRepository.updateJobStatus.mock.calls.find(
      (c) => c[2] === 'failed'
    );
    expect(failCall![3]).toBe(
      "Couldn't read this .apkg file. Export it again from Anki."
    );
  });

  it('surfaces a parse-error message when previewService.parse throws a generic parse error', async () => {
    const parseError = Object.assign(
      new Error('No Anki collection found in zip'),
      { code: 'SQLITE_CANTOPEN' }
    );
    previewService.parse.mockRejectedValue(parseError);

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { maxNotes: 10000 }
    );

    const failCall = jobRepository.updateJobStatus.mock.calls.find(
      (c) => c[2] === 'failed'
    );
    expect(failCall![3]).toBe(
      "Couldn't read this .apkg file. Export it again from Anki."
    );
  });

  it('handles sub-decks by creating nested pages', async () => {
    const collection = makeCollection(1);
    collection.decks.set(2, { id: 2, name: 'Parent::Child' });
    collection.notes.set(2, {
      id: 2,
      mid: 1,
      tags: '',
      fields: ['Front 2', 'Back 2'],
    });
    collection.cards.push({ id: 2, nid: 2, did: 2, ord: 0 });
    const parsed: ParsedApkg = {
      collection,
      mediaMap: new Map(),
      mediaEntries: new Map(),
      parsedAt: Date.now(),
    };

    previewService.parse.mockResolvedValue(parsed);

    await useCase.execute(
      Buffer.from('fake'),
      'parent-page',
      'user-1',
      notionApi,
      'job-1',
      { maxNotes: 10000 }
    );

    expect(notionApi.createPage).toHaveBeenCalledTimes(3);
    const pageNames = notionApi.createPage.mock.calls.map((c) => c[1]);
    expect(pageNames).toContain('Parent');
    expect(pageNames).toContain('Child');
  });
});
