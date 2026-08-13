import type express from 'express';

import { PhotoToFlashcardsController } from './PhotoToFlashcardsController';
import type { PhotoToFlashcardsUseCase } from '../usecases/imageOcclusion/PhotoToFlashcardsUseCase';

jest.mock('node:fs', () => {
  const actual = jest.requireActual('node:fs');
  return {
    ...actual,
    createReadStream: jest.fn(),
    unlink: jest.fn((_p, cb) => cb?.()),
  };
});

function makeRes(): express.Response {
  const res = {
    locals: { owner: '42' },
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as express.Response;
}

function makeReq(body: Record<string, unknown>): express.Request {
  return { body } as express.Request;
}

function makeUseCase() {
  const execute = jest
    .fn()
    .mockRejectedValue(Object.assign(new Error('boom'), { status: 413 }));
  return { execute } as unknown as jest.Mocked<PhotoToFlashcardsUseCase> & {
    execute: jest.Mock;
  };
}

describe('PhotoToFlashcardsController density forwarding', () => {
  const baseBody = {
    imageBase64: 'abc',
    mediaType: 'image/jpeg',
    deckName: 'X',
    width: 100,
    height: 100,
  };

  it.each(['sparse', 'balanced', 'dense'] as const)(
    'forwards a valid density (%s) to the use case',
    async (density) => {
      const useCase = makeUseCase();
      const controller = new PhotoToFlashcardsController(useCase);
      await controller.create(makeReq({ ...baseBody, density }), makeRes());
      expect(useCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ density })
      );
    }
  );

  it('defaults to balanced when density is missing', async () => {
    const useCase = makeUseCase();
    const controller = new PhotoToFlashcardsController(useCase);
    await controller.create(makeReq(baseBody), makeRes());
    expect(useCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ density: 'balanced' })
    );
  });

  it('defaults to balanced when density is an unknown string', async () => {
    const useCase = makeUseCase();
    const controller = new PhotoToFlashcardsController(useCase);
    await controller.create(
      makeReq({ ...baseBody, density: 'extra-dense' }),
      makeRes()
    );
    expect(useCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ density: 'balanced' })
    );
  });
});

describe('PhotoToFlashcardsController mode forwarding', () => {
  const baseBody = {
    imageBase64: 'abc',
    mediaType: 'image/jpeg',
    deckName: 'X',
    width: 100,
    height: 100,
  };

  it.each(['generative', 'verbatim'] as const)(
    'forwards a valid mode (%s) to the use case',
    async (mode) => {
      const useCase = makeUseCase();
      const controller = new PhotoToFlashcardsController(useCase);
      await controller.create(makeReq({ ...baseBody, mode }), makeRes());
      expect(useCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ mode })
      );
    }
  );

  it('defaults to generative when mode is missing', async () => {
    const useCase = makeUseCase();
    const controller = new PhotoToFlashcardsController(useCase);
    await controller.create(makeReq(baseBody), makeRes());
    expect(useCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'generative' })
    );
  });

  it('defaults to generative when mode is an unknown string', async () => {
    const useCase = makeUseCase();
    const controller = new PhotoToFlashcardsController(useCase);
    await controller.create(
      makeReq({ ...baseBody, mode: 'hallucinate' }),
      makeRes()
    );
    expect(useCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'generative' })
    );
  });
});

describe('PhotoToFlashcardsController media type detection', () => {
  function jpegBase64(): string {
    return Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]).toString('base64');
  }

  it('uses the media type detected from the bytes, not the client-declared one', async () => {
    const useCase = makeUseCase();
    const controller = new PhotoToFlashcardsController(useCase);
    await controller.create(
      makeReq({
        imageBase64: jpegBase64(),
        mediaType: 'image/png',
        deckName: 'X',
        width: 100,
        height: 100,
      }),
      makeRes()
    );
    expect(useCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: 'image/jpeg' })
    );
  });

  it('falls back to the declared type when the bytes are not a known image', async () => {
    const useCase = makeUseCase();
    const controller = new PhotoToFlashcardsController(useCase);
    await controller.create(
      makeReq({
        imageBase64: 'abc',
        mediaType: 'image/png',
        deckName: 'X',
        width: 100,
        height: 100,
      }),
      makeRes()
    );
    expect(useCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: 'image/png' })
    );
  });

  it('rejects with 400 when neither the bytes nor the declared type are supported', async () => {
    const useCase = makeUseCase();
    const controller = new PhotoToFlashcardsController(useCase);
    const res = makeRes();
    await controller.create(
      makeReq({
        imageBase64: 'abc',
        mediaType: 'application/pdf',
        deckName: 'X',
        width: 100,
        height: 100,
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(useCase.execute).not.toHaveBeenCalled();
  });
});

describe('PhotoToFlashcardsController unreadable Vision response', () => {
  const baseBody = {
    imageBase64: 'abc',
    mediaType: 'image/jpeg',
    deckName: 'X',
    width: 100,
    height: 100,
  };

  function makeUnreadableUseCase() {
    const execute = jest.fn().mockRejectedValue(
      Object.assign(
        new Error(
          "Couldn't read the cards from this photo. Try a clearer or less dense image."
        ),
        {
          status: 422,
          code: 'unreadable',
        }
      )
    );
    return { execute } as unknown as PhotoToFlashcardsUseCase & {
      execute: jest.Mock;
    };
  }

  it('responds 422 with the use-case message when the Vision JSON cannot be parsed', async () => {
    const controller = new PhotoToFlashcardsController(makeUnreadableUseCase());
    const res = makeRes();
    await controller.create(makeReq(baseBody), res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      message:
        "Couldn't read the cards from this photo. Try a clearer or less dense image.",
      code: 'unreadable',
    });
  });

  it('forwards the no_ready_made_questions code so the client can offer Generate cards', async () => {
    const execute = jest
      .fn()
      .mockRejectedValue(
        Object.assign(
          new Error(
            'No ready-made questions found in this photo. Switch to Generate cards to make cards from this content.'
          ),
          { status: 422, code: 'no_ready_made_questions' }
        )
      );
    const useCase = { execute } as unknown as PhotoToFlashcardsUseCase & {
      execute: jest.Mock;
    };
    const controller = new PhotoToFlashcardsController(useCase);
    const res = makeRes();
    await controller.create(makeReq(baseBody), res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      message:
        'No ready-made questions found in this photo. Switch to Generate cards to make cards from this content.',
      code: 'no_ready_made_questions',
    });
  });
});

describe('PhotoToFlashcardsController MCQ headers', () => {
  const baseBody = {
    imageBase64: 'abc',
    mediaType: 'image/jpeg',
    deckName: 'X',
    width: 100,
    height: 100,
  };

  interface StreamMock {
    on: jest.Mock;
    pipe: jest.Mock;
    handlers: Record<string, () => void>;
  }

  function makeStreamMock(): StreamMock {
    const handlers: Record<string, () => void> = {};
    const stream: StreamMock = {
      on: jest.fn((event: string, cb: () => void) => {
        handlers[event] = cb;
        return stream;
      }),
      pipe: jest.fn(),
      handlers,
    };
    return stream;
  }

  it('writes X-MCQ-Count and X-MCQ-Skipped-Count headers from the use case result', async () => {
    const fs = jest.requireMock('node:fs') as { createReadStream: jest.Mock };
    fs.createReadStream.mockReturnValue(makeStreamMock());

    const useCase = {
      execute: jest.fn().mockResolvedValue({
        apkgPath: '/tmp/out.apkg',
        cardCount: 5,
        estimatedCostUsd: 0.001,
        tileCount: 1,
        mcqCount: 3,
        mcqSkippedCount: 1,
      }),
    } as unknown as PhotoToFlashcardsUseCase;
    const controller = new PhotoToFlashcardsController(useCase);
    const res = makeRes();

    await controller.create(makeReq(baseBody), res);

    expect(res.setHeader).toHaveBeenCalledWith('X-MCQ-Count', '3');
    expect(res.setHeader).toHaveBeenCalledWith('X-MCQ-Skipped-Count', '1');
    expect(res.setHeader).toHaveBeenCalledWith('X-Card-Count', '5');
  });
});
