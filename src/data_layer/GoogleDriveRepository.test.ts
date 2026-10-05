import { vi } from 'vitest';
import {
  GoogleDriveRepository,
  GOOGLE_DRIVE_FOLDER_MIME,
} from './GoogleDriveRepository';

describe('GoogleDriveRepository.getByOwner owner guards', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  afterEach(() => warn.mockClear());

  function makeRepo() {
    const calls: { method: string; args?: unknown[] }[] = [];

    const limitOffset = {
      limit: () => ({
        offset: () => Promise.resolve([]),
      }),
    };

    const orderChain = {
      orderByRaw: (...args: unknown[]) => {
        calls.push({ method: 'orderByRaw', args });
        return limitOffset;
      },
    };

    const whereChain = {
      where: (...args: unknown[]) => {
        calls.push({ method: 'where', args });
        return {
          andWhere: (...andArgs: unknown[]) => {
            calls.push({ method: 'andWhere', args: andArgs });
            return orderChain;
          },
        };
      },
    };

    const selectChain = {
      select: (...args: string[]) => {
        calls.push({ method: 'select', args });
        return whereChain;
      },
    };

    const db = ((_table: string) => {
      calls.push({ method: 'db(table)' });
      return selectChain;
    }) as unknown as never;

    return { repo: new GoogleDriveRepository(db), calls };
  }

  it('returns empty list and skips query when owner is null', async () => {
    const { repo, calls } = makeRepo();
    const result = await repo.getByOwner(null as unknown as number, 10, 0);
    expect(result).toEqual([]);
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('returns empty list and skips query when owner is undefined', async () => {
    const { repo, calls } = makeRepo();
    const result = await repo.getByOwner(undefined as unknown as number, 10, 0);
    expect(result).toEqual([]);
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('queries with owner filter, excludes folders, and orders by last_converted_at DESC NULLS LAST', async () => {
    const { repo, calls } = makeRepo();
    await repo.getByOwner(42, 10, 0);

    const whereCall = calls.find((c) => c.method === 'where');
    const andWhereCall = calls.find((c) => c.method === 'andWhere');
    const orderCall = calls.find((c) => c.method === 'orderByRaw');

    expect(whereCall?.args).toEqual([{ owner: 42 }]);
    expect(andWhereCall?.args).toEqual([
      'mimeType',
      '!=',
      GOOGLE_DRIVE_FOLDER_MIME,
    ]);
    expect(orderCall?.args?.[0]).toMatch(/last_converted_at DESC NULLS LAST/);
  });
});

describe('GoogleDriveRepository.deleteByIdAndOwner owner guards', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  afterEach(() => warn.mockClear());

  function makeDeleteRepo() {
    const calls: { method: string; args?: unknown[] }[] = [];

    const delChain = {
      del: () => {
        calls.push({ method: 'del' });
        return Promise.resolve(1);
      },
    };

    const whereChain = {
      where: (...args: unknown[]) => {
        calls.push({ method: 'where', args });
        return delChain;
      },
    };

    const db = ((_table: string) => {
      calls.push({ method: 'db(table)' });
      return whereChain;
    }) as unknown as never;

    return { repo: new GoogleDriveRepository(db), calls };
  }

  it('returns 0 and skips query when owner is null', async () => {
    const { repo, calls } = makeDeleteRepo();
    const result = await repo.deleteByIdAndOwner(
      'abc',
      null as unknown as number
    );
    expect(result).toBe(0);
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('returns 0 and skips query when id is null', async () => {
    const { repo, calls } = makeDeleteRepo();
    const result = await repo.deleteByIdAndOwner(null as unknown as string, 42);
    expect(result).toBe(0);
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('deletes when both id and owner are valid; passes parameterized id', async () => {
    const { repo, calls } = makeDeleteRepo();
    const craftedId = "1' OR '1'='1";
    const result = await repo.deleteByIdAndOwner(craftedId, 42);
    expect(result).toBe(1);
    const whereCall = calls.find((c) => c.method === 'where');
    expect(whereCall?.args).toEqual([{ id: craftedId, owner: 42 }]);
  });
});
