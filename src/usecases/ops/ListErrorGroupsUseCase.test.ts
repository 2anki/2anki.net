import { vi } from 'vitest';
import { ListErrorGroupsUseCase } from './ListErrorGroupsUseCase';
import {
  IErrorEventRepository,
  ErrorGroupRow,
  ListErrorGroupsOptions,
} from '../../data_layer/ErrorEventRepository';

function makeGroup(overrides: Partial<ErrorGroupRow> = {}): ErrorGroupRow {
  return {
    message_hash: 'a'.repeat(64),
    message: 'ReferenceError: foo is not defined',
    stack: 'at bar.ts:5',
    url: 'https://2anki.net',
    release: 'abc12345',
    source: 'web',
    user_id: null,
    user_agent: 'Mozilla/5.0',
    first_seen: '2026-05-01T00:00:00.000Z',
    last_seen: '2026-05-24T10:00:00.000Z',
    occurrences: 3,
    resolved: false,
    resolved_at: null,
    ...overrides,
  };
}

class FakeRepository implements IErrorEventRepository {
  private readonly storedGroups: ErrorGroupRow[];
  private readonly total: number;

  constructor(groups: ErrorGroupRow[], total: number) {
    this.storedGroups = groups;
    this.total = total;
  }

  async insert(): Promise<void> {}

  async existsWithinWindow(): Promise<boolean> {
    return false;
  }

  async listGroups(_options: ListErrorGroupsOptions): Promise<ErrorGroupRow[]> {
    return this.storedGroups;
  }

  async countGroups(): Promise<number> {
    return this.total;
  }

  async latestSamples(): Promise<[]> {
    return [];
  }

  async resolveGroup(): Promise<void> {}

  async reopenGroup(): Promise<void> {}
}

describe('ListErrorGroupsUseCase', () => {
  it('returns groups and totalGroups from the repository', async () => {
    const groups = [
      makeGroup(),
      makeGroup({ message_hash: 'b'.repeat(64), occurrences: 7 }),
    ];
    const repo = new FakeRepository(groups, 2);
    const useCase = new ListErrorGroupsUseCase(repo);

    const result = await useCase.execute({ limit: 50, offset: 0 });

    expect(result.groups).toHaveLength(2);
    expect(result.totalGroups).toBe(2);
  });

  it('passes options through to the repository, including resolution status', async () => {
    const listGroupsSpy = vi.fn(async (): Promise<ErrorGroupRow[]> => []);
    const countGroupsSpy = vi.fn(async (): Promise<number> => 0);
    const repo: IErrorEventRepository = {
      insert: vi.fn(),
      existsWithinWindow: vi.fn(async () => false),
      listGroups: listGroupsSpy,
      countGroups: countGroupsSpy,
      latestSamples: vi.fn(async () => []),
      resolveGroup: vi.fn(),
      reopenGroup: vi.fn(),
    };

    const useCase = new ListErrorGroupsUseCase(repo);
    await useCase.execute({
      limit: 10,
      offset: 20,
      source: 'server',
      sort: 'occurrences',
      status: 'resolved',
    });

    expect(listGroupsSpy).toHaveBeenCalledWith({
      limit: 10,
      offset: 20,
      source: 'server',
      sort: 'occurrences',
      status: 'resolved',
    });
    expect(countGroupsSpy).toHaveBeenCalledWith('server', 'resolved');
  });

  it('passes resolved state through to the returned groups', async () => {
    const groups = [
      makeGroup({ resolved: true, resolved_at: '2026-05-25T12:00:00.000Z' }),
    ];
    const repo = new FakeRepository(groups, 1);
    const useCase = new ListErrorGroupsUseCase(repo);

    const result = await useCase.execute({
      limit: 50,
      offset: 0,
      status: 'resolved',
    });

    expect(result.groups[0]).toMatchObject({
      resolved: true,
      resolved_at: '2026-05-25T12:00:00.000Z',
    });
  });

  it('returns empty groups and zero total when the repository is empty', async () => {
    const repo = new FakeRepository([], 0);
    const useCase = new ListErrorGroupsUseCase(repo);

    const result = await useCase.execute({ limit: 50, offset: 0 });

    expect(result.groups).toEqual([]);
    expect(result.totalGroups).toBe(0);
  });

  it('never exposes ip_hash in the returned groups', async () => {
    const groupWithHash = {
      ...makeGroup(),
      ip_hash: 'sensitive-hash',
    } as ErrorGroupRow & { ip_hash?: string };
    const repo = new FakeRepository([groupWithHash], 1);
    const useCase = new ListErrorGroupsUseCase(repo);

    const result = await useCase.execute({ limit: 50, offset: 0 });

    expect(result.groups[0]).not.toHaveProperty('ip_hash');
  });
});
