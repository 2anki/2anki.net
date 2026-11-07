import { vi } from 'vitest';
import type express from 'express';

import OpsConfirmEmailNoticesController from './OpsConfirmEmailNoticesController';
import type { SendConfirmEmailNoticesUseCase } from '../usecases/ops/SendConfirmEmailNoticesUseCase';

const run = async (query: Record<string, string>, execute = vi.fn()) => {
  execute.mockResolvedValue({ count: 3, dryRun: true });
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  await new OpsConfirmEmailNoticesController({
    execute,
  } as unknown as SendConfirmEmailNoticesUseCase).send(
    { query } as unknown as express.Request,
    { status } as unknown as express.Response
  );
  return { execute, status, json };
};

describe('OpsConfirmEmailNoticesController', () => {
  it('only counts unless told otherwise', async () => {
    const { execute, json } = await run({});

    expect(execute).toHaveBeenCalledWith(true);
    expect(json).toHaveBeenCalledWith({ count: 3, dryRun: true });
  });

  it('sends only on an explicit dryRun=false', async () => {
    const { execute } = await run({ dryRun: 'false' });

    expect(execute).toHaveBeenCalledWith(false);
  });

  it('keeps any other dryRun value a count', async () => {
    const { execute } = await run({ dryRun: 'no' });

    expect(execute).toHaveBeenCalledWith(true);
  });
});
