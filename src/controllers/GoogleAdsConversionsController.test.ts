import type express from 'express';

import { GoogleAdsConversionsController } from './GoogleAdsConversionsController';

function makeResponse() {
  const res = {
    set: vi.fn(() => res),
    status: vi.fn(() => res),
    send: vi.fn(() => res),
  };
  return res as unknown as express.Response & {
    set: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
}

describe('GoogleAdsConversionsController', () => {
  it('sends the CSV the use case builds with a text/csv content type', async () => {
    const csv = 'Parameters:TimeZone=+0000\nheader\n';
    const useCase = { execute: vi.fn().mockResolvedValue(csv) };
    const controller = new GoogleAdsConversionsController(useCase as never);
    const res = makeResponse();

    await controller.getClickConversionsCsv({} as express.Request, res);

    expect(res.set).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8'
    );
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(csv);
  });
});
