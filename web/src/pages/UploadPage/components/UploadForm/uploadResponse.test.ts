import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyConversionSuccess,
  singleDeckName,
  type ConversionSuccessHandlers,
} from './uploadResponse';

type AnalyticsGlobals = {
  hj?: ReturnType<typeof vi.fn>;
  gtag?: ReturnType<typeof vi.fn>;
};

function buildHandlers(): ConversionSuccessHandlers {
  return {
    setWarningMessage: vi.fn(),
    setWarningCode: vi.fn(),
    setDeckName: vi.fn(),
    setCardCount: vi.fn(),
    setMcqCount: vi.fn(),
    setMcqSkippedCount: vi.fn(),
    setDroppedImageCount: vi.fn(),
    setImageDropReason: vi.fn(),
    setExpiredNotionImageCount: vi.fn(),
    setColoredTextPageCount: vi.fn(),
    setEmptyBackCount: vi.fn(),
    setEmptyBackSource: vi.fn(),
    setCherrySkippedCount: vi.fn(),
    setCardsHeldBack: vi.fn(),
    setHeldForPlan: vi.fn(),
    setOverSplit: vi.fn(),
    setCreditsUsed: vi.fn(),
    setDownloadLink: vi.fn(),
    setProgressWidth: vi.fn(),
    setBatchResult: vi.fn(),
    setHeldDeck: vi.fn(),
    setAiPreviewCards: vi.fn(),
    setAiPreviewUnavailable: vi.fn(),
    setZoneState: vi.fn(),
    setStructureRescuedRule: vi.fn(),
    setPdfFallbackMode: vi.fn(),
    recoverDownload: vi.fn(),
  };
}

function heldResponse(): Response {
  return {
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: () =>
      Promise.resolve({
        kind: 'held',
        cardCount: 21,
        cardsHeldBack: 13,
        totalCards: 34,
      }),
  } as unknown as Response;
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

  it('routes a held response to the heldForSignup zone without a download', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(heldResponse(), handlers);

    expect(handlers.setHeldDeck).toHaveBeenCalledWith({
      cardCount: 21,
      cardsHeldBack: 13,
      totalCards: 34,
      dayPassCard: false,
    });
    expect(handlers.setZoneState).toHaveBeenCalledWith('heldForSignup');
    expect(handlers.setDownloadLink).not.toHaveBeenCalled();
    expect(handlers.setZoneState).not.toHaveBeenCalledWith('success');
  });

  it('routes an ai_preview response to the aiPreviewGate zone with the cards', async () => {
    const handlers = buildHandlers();
    const response = {
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () =>
        Promise.resolve({
          kind: 'ai_preview',
          cardCount: 2,
          cards: [
            { front: 'q1', back: 'a1' },
            { front: 'q2', back: 'a2' },
          ],
        }),
    } as unknown as Response;

    await applyConversionSuccess(response, handlers);

    expect(handlers.setAiPreviewCards).toHaveBeenCalledWith([
      { front: 'q1', back: 'a1' },
      { front: 'q2', back: 'a2' },
    ]);
    expect(handlers.setZoneState).toHaveBeenCalledWith('aiPreviewGate');
    expect(handlers.setDownloadLink).not.toHaveBeenCalled();
    expect(handlers.setZoneState).not.toHaveBeenCalledWith('success');
  });

  it('carries the dayPassCard flag from an over-a-month held response', async () => {
    const handlers = buildHandlers();
    const response = {
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () =>
        Promise.resolve({
          kind: 'held',
          cardCount: 21,
          cardsHeldBack: 100,
          totalCards: 121,
          dayPassCard: true,
        }),
    } as unknown as Response;

    await applyConversionSuccess(response, handlers);

    expect(handlers.setHeldDeck).toHaveBeenCalledWith({
      cardCount: 21,
      cardsHeldBack: 100,
      totalCards: 121,
      dayPassCard: true,
    });
  });

  it('carries the deck name and saved hours from a held response', async () => {
    const handlers = buildHandlers();
    const response = {
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () =>
        Promise.resolve({
          kind: 'held',
          cardCount: 21,
          cardsHeldBack: 13,
          totalCards: 34,
          deckName: 'Pharmacology',
          savedForHours: 24,
        }),
    } as unknown as Response;

    await applyConversionSuccess(response, handlers);

    expect(handlers.setHeldDeck).toHaveBeenCalledWith({
      cardCount: 21,
      cardsHeldBack: 13,
      totalCards: 34,
      dayPassCard: false,
      deckName: 'Pharmacology',
      savedForHours: 24,
    });
  });

  it('carries cookieMinted when the server minted the anon id on this upload', async () => {
    const handlers = buildHandlers();
    const response = {
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () =>
        Promise.resolve({
          kind: 'held',
          cardCount: 21,
          cardsHeldBack: 13,
          totalCards: 34,
          cookieMinted: true,
        }),
    } as unknown as Response;

    await applyConversionSuccess(response, handlers);

    expect(handlers.setHeldDeck).toHaveBeenCalledWith({
      cardCount: 21,
      cardsHeldBack: 13,
      totalCards: 34,
      dayPassCard: false,
      cookieMinted: true,
    });
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

  it('reads the image-drop reason from the X-Image-Drop-Reason header on a single deck', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(
      singleDeckResponse({
        'X-Dropped-Assets': '2',
        'X-Image-Drop-Reason': 'notion_html_no_folder',
      }),
      handlers
    );

    expect(handlers.setImageDropReason).toHaveBeenCalledWith(
      'notion_html_no_folder'
    );
  });

  it('sets the image-drop reason to null when the header is absent', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(singleDeckResponse(), handlers);

    expect(handlers.setImageDropReason).toHaveBeenCalledWith(null);
  });

  it('reads the coloured-text page count from the X-Colored-Text-Pages header on a single deck', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(
      singleDeckResponse({ 'X-Colored-Text-Pages': '2' }),
      handlers
    );

    expect(handlers.setColoredTextPageCount).toHaveBeenCalledWith(2);
  });

  it('sets the coloured-text page count to 0 when the header is absent', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(singleDeckResponse(), handlers);

    expect(handlers.setColoredTextPageCount).toHaveBeenCalledWith(0);
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

  it('reads AI credits used from the X-Credits-Used header on a single deck', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(
      singleDeckResponse({ 'X-Credits-Used': '88' }),
      handlers
    );

    expect(handlers.setCreditsUsed).toHaveBeenCalledWith(88);
  });

  it('sets AI credits used to 0 when the X-Credits-Used header is absent', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(singleDeckResponse(), handlers);

    expect(handlers.setCreditsUsed).toHaveBeenCalledWith(0);
  });

  it('reads the empty-back count from the X-Empty-Back-Count header on a single deck', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(
      singleDeckResponse({ 'X-Empty-Back-Count': '2' }),
      handlers
    );

    expect(handlers.setEmptyBackCount).toHaveBeenCalledWith(2);
  });

  it('reads the held-back count from the X-Cards-Held-Back header on a single deck', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(
      singleDeckResponse({ 'X-Cards-Held-Back': '13' }),
      handlers
    );

    expect(handlers.setCardsHeldBack).toHaveBeenCalledWith(13);
  });

  it.each([
    ['1', true],
    [null, false],
  ])(
    'reads X-Held-For-Plan %s as a saved source file: %s',
    async (header, expected) => {
      const handlers = buildHandlers();

      await applyConversionSuccess(
        singleDeckResponse(header == null ? {} : { 'X-Held-For-Plan': header }),
        handlers
      );

      expect(handlers.setHeldForPlan).toHaveBeenCalledWith(expected);
    }
  );

  it('sets the held-back count to 0 when the X-Cards-Held-Back header is absent', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(singleDeckResponse(), handlers);

    expect(handlers.setCardsHeldBack).toHaveBeenCalledWith(0);
  });

  it('sets the empty-back count to 0 when the X-Empty-Back-Count header is absent', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(singleDeckResponse(), handlers);

    expect(handlers.setEmptyBackCount).toHaveBeenCalledWith(0);
  });

  it('reads the Cherry-pick skipped count from the X-Cherry-Skipped-Count header', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(
      singleDeckResponse({ 'X-Cherry-Skipped-Count': '4' }),
      handlers
    );

    expect(handlers.setCherrySkippedCount).toHaveBeenCalledWith(4);
  });

  it('sets the Cherry-pick skipped count to 0 when the header is absent', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(singleDeckResponse(), handlers);

    expect(handlers.setCherrySkippedCount).toHaveBeenCalledWith(0);
  });

  it('uses the Notion wording for empty backs the server marks as Notion toggles', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(
      singleDeckResponse({
        'X-Empty-Back-Count': '2',
        'X-Empty-Back-Source': 'notion',
      }),
      handlers
    );

    expect(handlers.setEmptyBackSource).toHaveBeenCalledWith('notion');
  });

  it('uses the upload wording for empty backs without a Notion source', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(
      singleDeckResponse({ 'X-Empty-Back-Count': '2' }),
      handlers
    );

    expect(handlers.setEmptyBackSource).toHaveBeenCalledWith('upload');
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

  it('flags an unavailable AI preview from the X-AI-Preview-Unavailable header', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(
      singleDeckResponse({ 'X-AI-Preview-Unavailable': '1' }),
      handlers
    );

    expect(handlers.setAiPreviewUnavailable).toHaveBeenCalledWith(true);
    expect(handlers.setZoneState).toHaveBeenCalledWith('success');
  });

  it('reports the AI preview available when the header is absent', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(singleDeckResponse(), handlers);

    expect(handlers.setAiPreviewUnavailable).toHaveBeenCalledWith(false);
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

  it.each([
    ['pairs', 'pairs'],
    ['single', 'single'],
    ['weird', null],
  ])(
    'reads the PDF fallback mode %s from the X-Pdf-Fallback header',
    async (header, expected) => {
      const handlers = buildHandlers();

      await applyConversionSuccess(
        singleDeckResponse({ 'X-Pdf-Fallback': header }),
        handlers
      );

      expect(handlers.setPdfFallbackMode).toHaveBeenCalledWith(expected);
    }
  );

  it('reports no PDF fallback mode when the header is absent', async () => {
    const handlers = buildHandlers();

    await applyConversionSuccess(singleDeckResponse(), handlers);

    expect(handlers.setPdfFallbackMode).toHaveBeenCalledWith(null);
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

  it('falls back to the server copy when the body read fails and a download key came with the headers', async () => {
    const handlers = buildHandlers();
    const response = {
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'X-Card-Count': '5',
        'X-Download-Key': 'owner-1-123-req.apkg',
      }),
      blob: () => Promise.reject(new TypeError('Load failed')),
    } as unknown as Response;

    await applyConversionSuccess(response, handlers);

    expect(handlers.recoverDownload).toHaveBeenCalledWith(
      '/api/download/u/owner-1-123-req.apkg',
      'Load failed'
    );
    expect(handlers.setDownloadLink).not.toHaveBeenCalled();
    expect(handlers.setZoneState).toHaveBeenCalledWith('success');
  });

  it('rethrows a failed body read when the response carried no download key', async () => {
    const handlers = buildHandlers();
    const response = {
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'X-Card-Count': '5',
      }),
      blob: () => Promise.reject(new TypeError('Load failed')),
    } as unknown as Response;

    await expect(applyConversionSuccess(response, handlers)).rejects.toThrow(
      'Load failed'
    );
    expect(handlers.recoverDownload).not.toHaveBeenCalled();
    expect(handlers.setZoneState).not.toHaveBeenCalledWith('success');
  });

  it('keeps the streamed body when it reads fine, key or no key', async () => {
    const handlers = buildHandlers();
    const response = singleDeckResponse({
      'X-Download-Key': 'owner-1-123-req.apkg',
    });

    await applyConversionSuccess(response, handlers);

    expect(handlers.setDownloadLink).toHaveBeenCalledWith(
      expect.stringMatching(/^blob:/)
    );
    expect(handlers.recoverDownload).not.toHaveBeenCalled();
  });
});

describe('singleDeckName', () => {
  it('names the deck a single-deck response carried', () => {
    const headers = new Headers({
      'Content-Type': 'application/octet-stream',
      'File-Name': 'Biology.apkg',
      'X-Card-Count': '12',
    });
    expect(singleDeckName(headers)).toBe('Biology.apkg');
  });

  it('is null for a JSON answer such as several decks or a held deck', () => {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    expect(singleDeckName(headers)).toBeNull();
  });

  it('is null for an empty deck', () => {
    const headers = new Headers({
      'Content-Type': 'application/octet-stream',
      'File-Name': 'Biology.apkg',
      'X-Card-Count': '0',
    });
    expect(singleDeckName(headers)).toBeNull();
  });
});
