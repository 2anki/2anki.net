import { vi, type Mock } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createMcpDeckDownloadRouter } from './McpDeckDownloadRouter';
import McpDeckDownloadController from '../controllers/McpDeckDownloadController';
import {
  ResolveMcpDeckDownloadUseCase,
  DeckPresigner,
} from '../usecases/mcp/ResolveMcpDeckDownloadUseCase';
import { IUploadRepository } from '../data_layer/UploadRespository';
import Uploads, { UploadsId } from '../data_layer/public/Uploads';

const VALID_OBJECT_ID = '11111111-1111-1111-1111-111111111111';
const PRESIGNED_URL = 'https://spaces.example/signed/deck.apkg?sig=abc';

function makeRow(overrides: Partial<Uploads> = {}): Uploads {
  return {
    id: 1 as UploadsId,
    owner: 42,
    key: 'owner-42-deck.apkg',
    filename: 'Pharmacology.apkg',
    object_id: VALID_OBJECT_ID,
    size_mb: 2,
    created_at: new Date('2026-07-19T00:00:00Z'),
    source: 'app',
    dedupe_key: null,
    dropped_image_count: null,
    image_drop_reason: null,
    ...overrides,
  };
}

async function buildServer(opts: {
  findByObjectId: Mock;
  getPresignedUrl?: DeckPresigner['getPresignedUrl'];
}) {
  const uploads = {
    findByObjectId: opts.findByObjectId,
  } as unknown as IUploadRepository;
  const storage: DeckPresigner = {
    getPresignedUrl: opts.getPresignedUrl ?? vi.fn(async () => PRESIGNED_URL),
  };
  const useCase = new ResolveMcpDeckDownloadUseCase(uploads, storage);
  const controller = new McpDeckDownloadController(useCase);
  const app = express();
  app.use(createMcpDeckDownloadRouter(controller));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe('GET /api/mcp/decks/:objectId/download', () => {
  it('302-redirects a known deck to the presigned URL', async () => {
    const findByObjectId = vi.fn(async () => makeRow());
    const getPresignedUrl = vi.fn(async () => PRESIGNED_URL);
    const { server, url } = await buildServer({
      findByObjectId,
      getPresignedUrl,
    });
    try {
      const res = await fetch(
        `${url}/api/mcp/decks/${VALID_OBJECT_ID}/download`,
        { redirect: 'manual' }
      );
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(PRESIGNED_URL);
      expect(getPresignedUrl).toHaveBeenCalledWith(
        'owner-42-deck.apkg',
        300,
        'Pharmacology.apkg'
      );
    } finally {
      server.close();
    }
  });

  it('returns 404 when the deck is unknown', async () => {
    const findByObjectId = vi.fn(async () => null);
    const { server, url } = await buildServer({ findByObjectId });
    try {
      const res = await fetch(
        `${url}/api/mcp/decks/${VALID_OBJECT_ID}/download`,
        { redirect: 'manual' }
      );
      expect(res.status).toBe(404);
    } finally {
      server.close();
    }
  });

  it('returns 404 without touching the database for a malformed object id', async () => {
    const findByObjectId = vi.fn(async () => makeRow());
    const { server, url } = await buildServer({ findByObjectId });
    try {
      const res = await fetch(`${url}/api/mcp/decks/not-a-real-id/download`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(404);
      expect(findByObjectId).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it('returns 404 when the row has no storage key', async () => {
    const findByObjectId = vi.fn(async () =>
      makeRow({ key: null as unknown as string })
    );
    const getPresignedUrl = vi.fn(async () => PRESIGNED_URL);
    const { server, url } = await buildServer({
      findByObjectId,
      getPresignedUrl,
    });
    try {
      const res = await fetch(
        `${url}/api/mcp/decks/${VALID_OBJECT_ID}/download`,
        { redirect: 'manual' }
      );
      expect(res.status).toBe(404);
      expect(getPresignedUrl).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });
});
