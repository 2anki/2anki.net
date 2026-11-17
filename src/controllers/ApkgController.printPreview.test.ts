import { vi, type Mock } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';

vi.mock('../services/events/track', () => ({ track: vi.fn() }));

import ApkgController from './ApkgController';
import ApkgPreviewService from '../services/ApkgPreviewService/ApkgPreviewService';
import { ParseCacheBudget } from '../services/ApkgPreviewService/ParseCacheBudget';
import {
  COLD_LOAD_BUDGET_BYTES,
  PARSE_CACHE_BUDGET_BYTES,
} from '../services/ApkgPreviewService/previewMemoryLimits';
import type DownloadService from '../services/DownloadService';
import type PdfRenderService from '../services/PdfRenderService';
import { ConcurrencyLimiter } from '../lib/rateLimit/ConcurrencyLimiter';
import { WeightedSemaphore } from '../lib/rateLimit/WeightedSemaphore';
import { buildTinyApkg } from '../test/fixtures/apkg/buildTinyApkg';

async function uploadedDeckRequest(): Promise<Request> {
  const filePath = path.join(os.tmpdir(), `print-preview-${randomUUID()}.apkg`);
  await fs.writeFile(filePath, buildTinyApkg());
  return {
    params: {},
    query: {},
    body: {},
    file: { originalname: 'deck.apkg', path: filePath },
  } as unknown as Request;
}

function response(): Response & { status: Mock; json: Mock } {
  const res = {
    locals: { owner: 1 },
    status: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { status: Mock; json: Mock };
}

describe('ApkgController print preview with the shared cold-load limit', () => {
  it('queues a third print preview behind a cold load instead of refusing it, and refuses it only while two render', async () => {
    const coldLoads = new WeightedSemaphore(COLD_LOAD_BUDGET_BYTES);
    const previewService = new ApkgPreviewService({
      coldLoads,
      cacheBudget: new ParseCacheBudget(PARSE_CACHE_BUDGET_BYTES),
    });
    const finishRenders: Array<() => void> = [];
    const renderPreviewImage = vi.fn(
      () =>
        new Promise<Buffer>((resolve) => {
          finishRenders.push(() => resolve(Buffer.from('png')));
        })
    );
    const renderSlots = new ConcurrencyLimiter(2);
    const controller = new ApkgController(
      {} as DownloadService,
      previewService,
      { renderPreviewImage } as unknown as PdfRenderService,
      undefined,
      undefined,
      undefined,
      renderSlots
    );
    const releaseLargeLoad = await coldLoads.acquire(COLD_LOAD_BUDGET_BYTES);
    const responses = [response(), response(), response()];

    const requests = await Promise.all(
      responses.map(async () => uploadedDeckRequest())
    );
    const previews = requests.map((req, index) =>
      controller.previewPdf(req, responses[index])
    );
    await vi.waitFor(() => expect(coldLoads.waiting).toBe(3));

    expect(renderSlots.inFlight).toBe(0);
    for (const res of responses) expect(res.status).not.toHaveBeenCalled();

    releaseLargeLoad();
    await vi.waitFor(() => expect(renderPreviewImage).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(responses.some((res) => res.status.mock.calls.length > 0)).toBe(
        true
      )
    );

    const refused = responses.filter((res) =>
      res.status.mock.calls.some(([status]) => status === 503)
    );
    expect(refused).toHaveLength(1);
    expect(renderSlots.inFlight).toBe(2);

    for (const finish of finishRenders) finish();
    await Promise.all(previews);
    expect(renderSlots.inFlight).toBe(0);
    const rendered = responses.filter((res) =>
      res.json.mock.calls.some(([body]) => body?.image != null)
    );
    expect(rendered).toHaveLength(2);
  });
});
