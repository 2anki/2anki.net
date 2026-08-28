import express from 'express';

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
});
