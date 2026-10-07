import { vi } from 'vitest';
import { Request, Response } from 'express';
import { OpsErrorsController } from './OpsErrorsController';
import { ListErrorGroupsUseCase } from '../usecases/ops/ListErrorGroupsUseCase';
import { ExportErrorGroupsUseCase } from '../usecases/ops/ExportErrorGroupsUseCase';
import { ResolveErrorGroupUseCase } from '../usecases/ops/ResolveErrorGroupUseCase';
import { ReopenErrorGroupUseCase } from '../usecases/ops/ReopenErrorGroupUseCase';

const VALID_HASH = 'a'.repeat(64);

function makeResponse() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    ended: false,
    locals: {} as Record<string, unknown>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
  return res as unknown as Response & typeof res;
}

function makeController() {
  const listExecute = vi.fn(async () => ({ groups: [], totalGroups: 0 }));
  const exportExecute = vi.fn(async () => '# export');
  const resolveExecute = vi.fn(async () => {});
  const reopenExecute = vi.fn(async () => {});

  const controller = new OpsErrorsController(
    { execute: listExecute } as unknown as ListErrorGroupsUseCase,
    { execute: exportExecute } as unknown as ExportErrorGroupsUseCase,
    { execute: resolveExecute } as unknown as ResolveErrorGroupUseCase,
    { execute: reopenExecute } as unknown as ReopenErrorGroupUseCase
  );

  return {
    controller,
    listExecute,
    exportExecute,
    resolveExecute,
    reopenExecute,
  };
}

describe('OpsErrorsController.list', () => {
  it('defaults to the unresolved status when none is given', async () => {
    const { controller, listExecute } = makeController();
    const req = { query: {} } as unknown as Request;
    const res = makeResponse();

    await controller.list(req, res);

    expect(listExecute).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unresolved' })
    );
    expect(res.statusCode).toBe(200);
  });

  it('passes through an explicit resolved status', async () => {
    const { controller, listExecute } = makeController();
    const req = { query: { status: 'resolved' } } as unknown as Request;
    const res = makeResponse();

    await controller.list(req, res);

    expect(listExecute).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'resolved' })
    );
  });
});

describe('OpsErrorsController.resolve', () => {
  it('rejects an invalid message hash with 400', async () => {
    const { controller, resolveExecute } = makeController();
    const req = { params: { messageHash: 'not-a-hash' } } as unknown as Request;
    const res = makeResponse();

    await controller.resolve(req, res);

    expect(res.statusCode).toBe(400);
    expect(resolveExecute).not.toHaveBeenCalled();
  });

  it('resolves a valid hash and records the ops owner', async () => {
    const { controller, resolveExecute } = makeController();
    const req = { params: { messageHash: VALID_HASH } } as unknown as Request;
    const res = makeResponse();
    res.locals.owner = 7;

    await controller.resolve(req, res);

    expect(resolveExecute).toHaveBeenCalledWith(VALID_HASH, 7);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it('records a null resolver when no owner id is present', async () => {
    const { controller, resolveExecute } = makeController();
    const req = { params: { messageHash: VALID_HASH } } as unknown as Request;
    const res = makeResponse();

    await controller.resolve(req, res);

    expect(resolveExecute).toHaveBeenCalledWith(VALID_HASH, null);
  });
});

describe('OpsErrorsController.reopen', () => {
  it('rejects an invalid message hash with 400', async () => {
    const { controller, reopenExecute } = makeController();
    const req = { params: { messageHash: 'XYZ' } } as unknown as Request;
    const res = makeResponse();

    await controller.reopen(req, res);

    expect(res.statusCode).toBe(400);
    expect(reopenExecute).not.toHaveBeenCalled();
  });

  it('reopens a valid hash', async () => {
    const { controller, reopenExecute } = makeController();
    const req = { params: { messageHash: VALID_HASH } } as unknown as Request;
    const res = makeResponse();

    await controller.reopen(req, res);

    expect(reopenExecute).toHaveBeenCalledWith(VALID_HASH);
    expect(res.statusCode).toBe(204);
  });
});
