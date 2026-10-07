import { vi } from 'vitest';
import { Request, Response } from 'express';

import { RecentSourcesController } from './RecentSourcesController';
import type { GetRecentSourcesUseCase } from '../../usecases/uploads/GetRecentSourcesUseCase';

function buildMocks(sources: unknown[]) {
  const useCase = {
    execute: vi.fn().mockResolvedValue(sources),
  } as unknown as GetRecentSourcesUseCase;
  const controller = new RecentSourcesController(useCase);
  const res = {
    locals: { owner: 7 },
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { useCase, controller, res };
}

describe('RecentSourcesController.get', () => {
  it('returns 200 with the use-case DTOs for the authenticated user', async () => {
    const dto = {
      id: 'page-1',
      title: 'A page',
      type: 'notion',
      updatedAt: '2026-06-02T00:00:00.000Z',
      convertUrl: '/preview/page-1',
    };
    const { controller, useCase, res } = buildMocks([dto]);

    await controller.get({} as Request, res);

    expect(useCase.execute).toHaveBeenCalledWith(7);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ sources: [dto] });
  });

  it('returns 200 with an empty list when there are no sources', async () => {
    const { controller, res } = buildMocks([]);

    await controller.get({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ sources: [] });
  });
});
