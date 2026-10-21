import { vi, type Mock } from 'vitest';
import type { Response } from 'express';
import LandingConfigController from './LandingConfigController';
import type { IFeatureFlagsRepository } from '../data_layer/FeatureFlagsRepository';
import {
  __resetFeatureFlagModuleForTests,
  __setFeatureFlagDependencies,
} from '../lib/featureFlags/getFeatureFlag';
import { LANDING_PASS_PRICES_FLAG } from '../lib/featureFlags/landingPassPrices';

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

const repoReturning = (value: boolean | null): IFeatureFlagsRepository => ({
  async get() {
    return value;
  },
  async getAll() {
    return [];
  },
  async set() {
    return null;
  },
});

describe('LandingConfigController', () => {
  beforeEach(() => {
    __resetFeatureFlagModuleForTests();
  });

  afterAll(() => {
    __resetFeatureFlagModuleForTests();
  });

  it('reports pass prices as hidden when the flag is unset', async () => {
    __setFeatureFlagDependencies({ repository: repoReturning(null) });
    const res = makeRes();

    await new LandingConfigController().getConfig({} as never, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ showPassPrices: false });
  });

  it('reports pass prices as hidden when the flag is off', async () => {
    __setFeatureFlagDependencies({ repository: repoReturning(false) });
    const res = makeRes();

    await new LandingConfigController().getConfig({} as never, res);

    expect(res.json).toHaveBeenCalledWith({ showPassPrices: false });
  });

  it('reports pass prices as shown when the flag is on', async () => {
    __setFeatureFlagDependencies({ repository: repoReturning(true) });
    const res = makeRes();

    await new LandingConfigController().getConfig({} as never, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ showPassPrices: true });
  });

  it('sets a short public cache header', async () => {
    __setFeatureFlagDependencies({ repository: repoReturning(false) });
    const res = makeRes();

    await new LandingConfigController().getConfig({} as never, res);

    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=60');
  });

  it('reads the landing pass prices flag key', () => {
    expect(LANDING_PASS_PRICES_FLAG).toBe('landing_pass_prices');
  });
});
