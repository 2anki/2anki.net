import { vi, type Mock } from 'vitest';
import express from 'express';
import RulesController from './ParserRulesController';
import ParserRulesService from '../services/ParserRulesService';
import * as getOwnerModule from '../lib/User/getOwner';

describe('ParserRulesController', () => {
  let service: ParserRulesService;
  let controller: RulesController;
  let req: Partial<express.Request>;
  let res: Partial<express.Response>;

  beforeEach(() => {
    service = {
      createRule: vi.fn(),
      getById: vi.fn(),
      deleteRule: vi.fn(),
    } as any;
    controller = new RulesController(service);
    req = {
      params: { id: '7ccef4f6-b50c-4599-878e-f6fb61415ce2' },
      body: { payload: { FLASHCARD: 'a', DECK: 'b' } },
    };
    res = {
      send: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    vi.spyOn(getOwnerModule, 'getOwner').mockReturnValue('owner1');
  });

  it('does not leak database driver internals when creating a rule', async () => {
    const pgResultLikeObject = {
      command: 'INSERT',
      rowCount: 1,
      rows: [],
      fields: [],
      _types: { builtins: { BOOL: 16 } },
      RowCtor: null,
      rowAsArray: false,
    };
    (service.createRule as Mock).mockResolvedValue(pgResultLikeObject);

    await controller.createRule(
      req as express.Request,
      res as express.Response
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const sentBody = (res.send as Mock).mock.calls[0]?.[0];
    const sentJson = (res.json as Mock).mock.calls[0]?.[0];
    const payload = sentBody ?? sentJson;
    const serialized = JSON.stringify(payload ?? '');
    expect(serialized).not.toContain('_types');
    expect(serialized).not.toContain('RowCtor');
    expect(serialized).not.toContain('rowAsArray');
    expect(serialized).not.toContain('command');
  });

  it('returns 400 when id is missing', async () => {
    req.params = {};
    await controller.createRule(
      req as express.Request,
      res as express.Response
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when service throws', async () => {
    (service.createRule as Mock).mockRejectedValue(new Error('fail'));
    await controller.createRule(
      req as express.Request,
      res as express.Response
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('RulesController.deleteRule', () => {
  let service: ParserRulesService;
  let controller: RulesController;
  let req: Partial<express.Request>;
  let res: Partial<express.Response>;

  beforeEach(() => {
    service = {
      createRule: vi.fn(),
      getById: vi.fn(),
      deleteRule: vi.fn(),
    } as any;
    controller = new RulesController(service);
    req = { params: { id: 'page-abc' } };
    res = {
      send: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      locals: { owner: 'owner1' },
    };
    vi.spyOn(getOwnerModule, 'getOwner').mockReturnValue('owner1');
  });

  it('calls deleteRule with id and owner and returns 204', async () => {
    (service.deleteRule as Mock).mockResolvedValue(1);

    await controller.deleteRule(
      req as express.Request,
      res as express.Response
    );

    expect(service.deleteRule).toHaveBeenCalledWith('page-abc', 'owner1');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it('returns 204 even when no row is found (idempotent)', async () => {
    (service.deleteRule as Mock).mockResolvedValue(0);

    await controller.deleteRule(
      req as express.Request,
      res as express.Response
    );

    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('returns 400 when id is missing', async () => {
    req.params = {};

    await controller.deleteRule(
      req as express.Request,
      res as express.Response
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(service.deleteRule).not.toHaveBeenCalled();
  });
});
