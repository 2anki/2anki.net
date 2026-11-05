import { vi } from 'vitest';
import { Request, Response } from 'express';
import { MindmapController } from './MindmapController';
import { PythonExitError } from '../lib/anki/buildPythonExitError';

function buildRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    locals: { owner: 42 },
  } as unknown as Response;
}

describe('MindmapController.exportDeck', () => {
  it('lets a deck-writer crash reach error capture unchanged', async () => {
    const crash = new PythonExitError('The deck writer stopped.', {
      kind: 'unknown',
      rawOutput: "KeyError: 'Front'",
      code: 1,
    });
    const exportUseCase = { execute: vi.fn().mockRejectedValue(crash) };
    const controller = new MindmapController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      exportUseCase as never,
      {} as never
    );
    const res = buildRes();

    await expect(
      controller.exportDeck(
        { params: { id: 'map-1' }, body: {} } as unknown as Request,
        res
      )
    ).rejects.toBe(crash);
    expect(res.send).not.toHaveBeenCalled();
  });
});
