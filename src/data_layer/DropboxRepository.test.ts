import { vi } from 'vitest';
import { DropboxRepository } from './DropboxRepository';

describe('DropboxRepository owner guards', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  afterEach(() => warn.mockClear());

  function makeRepo() {
    const calls: string[] = [];

    const orderByChain = {
      orderBy: () => {
        calls.push('orderBy');
        return {
          limit: () => ({
            offset: () => Promise.resolve([]),
          }),
        };
      },
    };

    const selectChain = {
      select: (..._args: string[]) => {
        calls.push('select');
        return {
          where: () => {
            calls.push('where');
            return orderByChain;
          },
        };
      },
    };

    const db = ((_table: string) => {
      calls.push('db(table)');
      return selectChain;
    }) as unknown as never;

    return { repo: new DropboxRepository(db), calls };
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

  it('queries db with owner, limit, offset when owner is valid', async () => {
    const { repo, calls } = makeRepo();
    await repo.getByOwner(42, 10, 0);
    expect(calls).toContain('db(table)');
    expect(calls).toContain('where');
    expect(calls).toContain('orderBy');
  });
});

describe('DropboxRepository.deleteByIdAndOwner owner guards', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  afterEach(() => warn.mockClear());

  function makeDeleteRepo() {
    const calls: string[] = [];

    const delChain = {
      del: () => {
        calls.push('del');
        return Promise.resolve(1);
      },
    };

    const whereChain = {
      where: (_cond: unknown) => {
        calls.push('where');
        return delChain;
      },
    };

    const db = ((_table: string) => {
      calls.push('db(table)');
      return whereChain;
    }) as unknown as never;

    return { repo: new DropboxRepository(db), calls };
  }

  it('returns 0 and skips query when owner is null', async () => {
    const { repo, calls } = makeDeleteRepo();
    const result = await repo.deleteByIdAndOwner(1, null as unknown as number);
    expect(result).toBe(0);
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('returns 0 and skips query when id is null', async () => {
    const { repo, calls } = makeDeleteRepo();
    const result = await repo.deleteByIdAndOwner(null as unknown as number, 1);
    expect(result).toBe(0);
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('deletes when both id and owner are valid', async () => {
    const { repo, calls } = makeDeleteRepo();
    const result = await repo.deleteByIdAndOwner(5, 42);
    expect(result).toBe(1);
    expect(calls).toContain('db(table)');
    expect(calls).toContain('where');
    expect(calls).toContain('del');
  });
});
