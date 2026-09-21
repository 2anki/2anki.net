import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

jest.mock('../services/events/eventsSinkInstance', () => {
  const recorded: unknown[] = [];
  return {
    getEventsSink: () => ({
      record: jest.fn((row: unknown) => recorded.push(row)),
    }),
    __recorded: recorded,
  };
});

import ImageOcclusionController from './ImageOcclusionController';
import { CreateImageOcclusionDeckUseCase } from '../usecases/imageOcclusion/CreateImageOcclusionDeckUseCase';
import { ImageLimitError } from '../usecases/imageOcclusion/ImageLimitError';

function buildRequest(imageCount: number): express.Request {
  const images = Array.from({ length: imageCount }, (_, i) => ({
    imageName: `img${i}.jpg`,
    header: '',
    rects: [{ x: 0, y: 0, w: 10, h: 10, label: '' }],
  }));
  return {
    body: {
      data: JSON.stringify({ deckName: 'Anatomy', mode: 'hide_all', images }),
    },
    files: [],
  } as unknown as express.Request;
}

function buildResponse() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return {
    res: {
      status,
      json,
      setHeader: jest.fn(),
      locals: {},
    } as unknown as express.Response,
    status,
    json,
  };
}

describe('ImageOcclusionController.create', () => {
  it('answers the free-tier image cap with a 403 carrying a stable code', async () => {
    const useCase = {
      execute: jest.fn().mockRejectedValue(new ImageLimitError(3)),
    } as unknown as CreateImageOcclusionDeckUseCase;
    const controller = new ImageOcclusionController(useCase);
    const { res, status, json } = buildResponse();

    await controller.create(buildRequest(4), res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      code: 'image_limit',
      message: 'Upgrade to process more than 3 images',
    });
  });

  it('passes the paid flag from res.locals into the use case', async () => {
    const execute = jest.fn().mockRejectedValue(new ImageLimitError(3));
    const controller = new ImageOcclusionController({
      execute,
    } as unknown as CreateImageOcclusionDeckUseCase);
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).subscriber = true;

    await controller.create(buildRequest(4), res);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ isPaying: true })
    );
  });

  it('rethrows errors that carry no HTTP mapping', async () => {
    const useCase = {
      execute: jest.fn().mockRejectedValue(new Error('python exploded')),
    } as unknown as CreateImageOcclusionDeckUseCase;
    const controller = new ImageOcclusionController(useCase);
    const { res, status } = buildResponse();

    await expect(controller.create(buildRequest(1), res)).rejects.toThrow(
      'python exploded'
    );
    expect(status).not.toHaveBeenCalledWith(403);
  });

  describe('usage event', () => {
    function recordedEvents(): Array<Record<string, unknown>> {
      return (
        jest.requireMock('../services/events/eventsSinkInstance') as {
          __recorded: Array<Record<string, unknown>>;
        }
      ).__recorded;
    }

    function buildStreamingResponse(owner?: string) {
      const stream = new PassThrough();
      stream.resume();
      Object.assign(stream, { setHeader: jest.fn(), locals: { owner } });
      return stream as unknown as express.Response;
    }

    beforeEach(() => {
      recordedEvents().length = 0;
    });

    it('records image_occlusion_created with the image and occlusion counts', async () => {
      const apkgPath = path.join(os.tmpdir(), `io-test-${Date.now()}.apkg`);
      fs.writeFileSync(apkgPath, 'deck');
      const controller = new ImageOcclusionController({
        execute: jest.fn().mockResolvedValue(apkgPath),
      } as unknown as CreateImageOcclusionDeckUseCase);

      await controller.create(buildRequest(2), buildStreamingResponse('42'));

      expect(recordedEvents()).toEqual([
        expect.objectContaining({
          name: 'image_occlusion_created',
          user_id: 42,
          anonymous_id: null,
          props: { image_count: 2, occlusion_count: 2 },
        }),
      ]);
    });

    it('records a guest build without a user id', async () => {
      const apkgPath = path.join(
        os.tmpdir(),
        `io-test-guest-${Date.now()}.apkg`
      );
      fs.writeFileSync(apkgPath, 'deck');
      const controller = new ImageOcclusionController({
        execute: jest.fn().mockResolvedValue(apkgPath),
      } as unknown as CreateImageOcclusionDeckUseCase);

      await controller.create(buildRequest(1), buildStreamingResponse());

      expect(recordedEvents()).toEqual([
        expect.objectContaining({
          name: 'image_occlusion_created',
          user_id: null,
        }),
      ]);
    });

    it('records a non-numeric owner as no user so it cannot poison the event batch', async () => {
      const apkgPath = path.join(os.tmpdir(), `io-test-nan-${Date.now()}.apkg`);
      fs.writeFileSync(apkgPath, 'deck');
      const controller = new ImageOcclusionController({
        execute: jest.fn().mockResolvedValue(apkgPath),
      } as unknown as CreateImageOcclusionDeckUseCase);

      await controller.create(buildRequest(1), buildStreamingResponse('abc'));

      expect(recordedEvents()).toEqual([
        expect.objectContaining({ user_id: null }),
      ]);
    });

    it('records nothing when the free-tier cap refuses the build', async () => {
      const controller = new ImageOcclusionController({
        execute: jest.fn().mockRejectedValue(new ImageLimitError(3)),
      } as unknown as CreateImageOcclusionDeckUseCase);
      const { res } = buildResponse();

      await controller.create(buildRequest(4), res);

      expect(recordedEvents()).toEqual([]);
    });
  });
});
