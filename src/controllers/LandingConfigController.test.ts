import { vi, type Mock } from 'vitest';
import type { Response } from 'express';
import LandingConfigController from './LandingConfigController';

const makeRes = () => {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const set = vi.fn();
  return { json, status, set } as unknown as Response & {
    json: Mock;
    status: Mock;
    set: Mock;
  };
};

describe('LandingConfigController', () => {
  it('reports pass prices as shown, for a tab loaded before they were always on', () => {
    const res = makeRes();

    new LandingConfigController().getConfig({} as never, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ showPassPrices: true });
  });

  it('sets a short public cache header', () => {
    const res = makeRes();

    new LandingConfigController().getConfig({} as never, res);

    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=60');
  });
});
