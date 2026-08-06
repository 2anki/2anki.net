import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyConversionSuccess,
  type ConversionSuccessHandlers,
} from './uploadResponse';

type AnalyticsGlobals = {
  hj?: ReturnType<typeof vi.fn>;
  gtag?: ReturnType<typeof vi.fn>;
};

function buildHandlers(): ConversionSuccessHandlers {
  return {
    setWarningMessage: vi.fn(),
    setDeckName: vi.fn(),
    setCardCount: vi.fn(),
    setMcqCount: vi.fn(),
    setMcqSkippedCount: vi.fn(),
    setDroppedImageCount: vi.fn(),
    setExpiredNotionImageCount: vi.fn(),
    setEmptyBackCount: vi.fn(),
    setOverSplit: vi.fn(),
    setDownloadLink: vi.fn(),
    setProgressWidth: vi.fn(),
    setBatchResult: vi.fn(),
    setZoneState: vi.fn(),
    setStructureRescuedRule: vi.fn(),
  };
}

function singleDeckResponse(headers: Record<string, string> = {}): Response {
  return {
    headers: new Headers({
      'Content-Type': 'application/octet-stream',
      'X-Card-Count': '5',
      ...headers,
    }),
    blob: () => Promise.resolve(new Blob(['fake'])),
  } as unknown as Response;
}

function batchResponse(): Response {
  return {
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: () =>
      Promise.resolve({
        kind: 'batch',
        workspaceId: 'ws-1',
        deckCount: 1,
        decks: [
          {
            name: 'A',
            filename: 'A.apkg',
            downloadUrl: '/download/ws-1/A.apkg',
          },
        ],
        bulkUrl: '/download/ws-1/bulk',
      }),
  } as unknown as Response;
}

describe('applyConversionSuccess', () => {
  beforeEach(() => {
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake');
  });

  afterEach(() => {
    delete (globalThis as AnalyticsGlobals).gtag;
    delete (globalThis as AnalyticsGlobals).hj;
    vi.restoreAllMocks();
  });

  it('does not fire conversion_success on the single-deck success path', async () => {
    const gtag = (globalThis as AnalyticsGlobals).gtag!;
    const hj = (globalThis as AnalyticsGlobals).hj!;
    const handlers = buildHandlers();

    await applyConversionSuccess(singleDeckResponse(), handlers);

    expect(gtag).not.toHaveBeenCalledWith('event', 'conversion_success');
    expect(hj).not.toHaveBeenCalledWith('event', 'conversion_success');
    expect(handlers.setZoneState).toHaveBeenCalledWith('success');
  });

  it('does not fire conversion_success on the multi-deck batch path', async () => {
    const gtag = (globalThis as AnalyticsGlobals).gtag!;
    const handlers = buildHandlers();

    await applyConversionSuccess(batchResponse(), handlers);

    expect(gtag).not.toHaveBeenCalledWith('event', 'conversion_success');
    expect(handlers.setZoneState).toHaveBeenCalledWith('multiDeck');
  });

  it('reads the dropped-image count from the X-Dropped-Assets header on a single deck', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(
      singleDeckResponse({ 'X-Dropped-Assets': '3' }),
      handlers
    );

    expect(handlers.setDroppedImageCount).toHaveBeenCalledWith(3);
  });

  it('sets the dropped-image count to 0 when the X-Dropped-Assets header is absent', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(singleDeckResponse(), handlers);

    expect(handlers.setDroppedImageCount).toHaveBeenCalledWith(0);
  });

  it('reads the expired-image count from the X-Expired-Notion-Assets header on a single deck', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(
      singleDeckResponse({ 'X-Expired-Notion-Assets': '2' }),
      handlers
    );

    expect(handlers.setExpiredNotionImageCount).toHaveBeenCalledWith(2);
  });

  it('sets the expired-image count to 0 when the X-Expired-Notion-Assets header is absent', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(singleDeckResponse(), handlers);

    expect(handlers.setExpiredNotionImageCount).toHaveBeenCalledWith(0);
  });

  it('reads the empty-back count from the X-Empty-Back-Count header on a single deck', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(
      singleDeckResponse({ 'X-Empty-Back-Count': '2' }),
      handlers
    );

    expect(handlers.setEmptyBackCount).toHaveBeenCalledWith(2);
  });

  it('sets the empty-back count to 0 when the X-Empty-Back-Count header is absent', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(singleDeckResponse(), handlers);

    expect(handlers.setEmptyBackCount).toHaveBeenCalledWith(0);
  });

  it('reads emptyBackCount from the batch JSON body', async () => {
    const handlers = buildHandlers();
    const response = {
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () =>
        Promise.resolve({
          kind: 'batch',
          workspaceId: 'ws-1',
          deckCount: 1,
          decks: [
            {
              name: 'A',
              filename: 'A.apkg',
              downloadUrl: '/download/ws-1/A.apkg',
            },
          ],
          bulkUrl: '/download/ws-1/bulk',
          emptyBackCount: 5,
        }),
    } as unknown as Response;

    await applyConversionSuccess(response, handlers);

    expect(handlers.setEmptyBackCount).toHaveBeenCalledWith(5);
  });

  it('flags over-split output from the X-Over-Split header', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(
      singleDeckResponse({ 'X-Over-Split': '1' }),
      handlers
    );

    expect(handlers.setOverSplit).toHaveBeenCalledWith(true);
  });

  it('reports overSplit false when the X-Over-Split header is absent', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(singleDeckResponse(), handlers);

    expect(handlers.setOverSplit).toHaveBeenCalledWith(false);
  });

  it('reads the rescue rule from the X-Structure-Rescued header on a single deck', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(
      singleDeckResponse({ 'X-Structure-Rescued': 'heading' }),
      handlers
    );

    expect(handlers.setStructureRescuedRule).toHaveBeenCalledWith('heading');
  });

  it('sets the rescue rule to null when the X-Structure-Rescued header is absent', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(singleDeckResponse(), handlers);

    expect(handlers.setStructureRescuedRule).toHaveBeenCalledWith(null);
  });

  it('ignores an unknown value in the X-Structure-Rescued header', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(
      singleDeckResponse({ 'X-Structure-Rescued': 'not-a-rule' }),
      handlers
    );

    expect(handlers.setStructureRescuedRule).toHaveBeenCalledWith(null);
  });

  it('reads structureRescuedRule from the batch JSON body', async () => {
    const handlers = buildHandlers();
    const response = {
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () =>
        Promise.resolve({
          kind: 'batch',
          workspaceId: 'ws-1',
          deckCount: 1,
          decks: [
            {
              name: 'A',
              filename: 'A.apkg',
              downloadUrl: '/download/ws-1/A.apkg',
            },
          ],
          bulkUrl: '/download/ws-1/bulk',
          structureRescuedRule: 'columns',
        }),
    } as unknown as Response;

    await applyConversionSuccess(response, handlers);

    expect(handlers.setStructureRescuedRule).toHaveBeenCalledWith('columns');
  });

  it('reads droppedImageCount from the batch JSON body', async () => {
    const handlers = buildHandlers();
    const response = {
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () =>
        Promise.resolve({
          kind: 'batch',
          workspaceId: 'ws-1',
          deckCount: 1,
          decks: [
            {
              name: 'A',
              filename: 'A.apkg',
              downloadUrl: '/download/ws-1/A.apkg',
            },
          ],
          bulkUrl: '/download/ws-1/bulk',
          droppedImageCount: 4,
        }),
    } as unknown as Response;

    await applyConversionSuccess(response, handlers);

    expect(handlers.setDroppedImageCount).toHaveBeenCalledWith(4);
  });

  it('reads expiredNotionImageCount from the batch JSON body', async () => {
    const handlers = buildHandlers();
    const response = {
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () =>
        Promise.resolve({
          kind: 'batch',
          workspaceId: 'ws-1',
          deckCount: 1,
          decks: [
            {
              name: 'A',
              filename: 'A.apkg',
              downloadUrl: '/download/ws-1/A.apkg',
            },
          ],
          bulkUrl: '/download/ws-1/bulk',
          expiredNotionImageCount: 3,
        }),
    } as unknown as Response;

    await applyConversionSuccess(response, handlers);

    expect(handlers.setExpiredNotionImageCount).toHaveBeenCalledWith(3);
  });
});
