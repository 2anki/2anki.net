import { FindOrCreateJobUseCase } from './FindOrCreateJobUseCase';
import JobRepository from '../../data_layer/JobRepository';

interface FakeJob {
  id: number;
  object_id: string;
  owner: string;
  status: string;
  title?: string | null;
  type?: string;
}

function makeRepo(seed: Record<string, FakeJob> = {}) {
  const jobs: Record<string, FakeJob> = { ...seed };
  let idCounter = 100;
  const repo = {
    create: async (
      id: string,
      owner: string,
      title?: string | null,
      type?: string
    ) => {
      const key = `${id}:${owner}`;
      if (jobs[key]) {
        return undefined;
      }
      jobs[key] = {
        id: idCounter++,
        object_id: id,
        owner,
        status: 'started',
        title,
        type,
      };
      return jobs[key];
    },
    findJobById: async (id: string, owner: string) => {
      const key = `${id}:${owner}`;
      return jobs[key] ?? null;
    },
  } as unknown as JobRepository;
  return { repo, jobs };
}

describe('FindOrCreateJobUseCase', () => {
  const notionPageId = '33e3e244-8dee-8044-916c-db66d504d507';

  it('reports created:true with the inserted row for a brand-new object', async () => {
    const { repo } = makeRepo();
    const useCase = new FindOrCreateJobUseCase(repo);

    const result = await useCase.execute({
      id: notionPageId,
      owner: 'user-a',
      title: 'Test Page',
      type: 'page',
    });

    expect(result.created).toBe(true);
    expect(result.job).toMatchObject({
      object_id: notionPageId,
      owner: 'user-a',
    });
  });

  it('reports created:false with the existing row when the job already exists', async () => {
    const existing: FakeJob = {
      id: 7,
      object_id: notionPageId,
      owner: 'user-a',
      status: 'done',
    };
    const { repo } = makeRepo({ [`${notionPageId}:user-a`]: existing });
    const useCase = new FindOrCreateJobUseCase(repo);

    const result = await useCase.execute({
      id: notionPageId,
      owner: 'user-a',
      title: 'Test Page',
      type: 'page',
    });

    expect(result.created).toBe(false);
    expect(result.job).toMatchObject({ id: 7, status: 'done' });
  });

  it('creates separate jobs for different owners with the same object_id', async () => {
    const { repo } = makeRepo();
    const useCase = new FindOrCreateJobUseCase(repo);

    const a = await useCase.execute({
      id: notionPageId,
      owner: 'user-a',
      title: 'Test Page',
      type: 'page',
    });
    const b = await useCase.execute({
      id: notionPageId,
      owner: 'user-b',
      title: 'Test Page',
      type: 'page',
    });

    expect(a.job.owner).toBe('user-a');
    expect(b.job.owner).toBe('user-b');
    expect(a.job.id).not.toBe(b.job.id);
  });

  it('reports created:false when a concurrent request won the insert', async () => {
    const raced: FakeJob = {
      id: 9,
      object_id: notionPageId,
      owner: 'user-a',
      status: 'started',
    };
    const repo = {
      findJobById: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(raced),
      create: jest.fn().mockResolvedValue(undefined),
    } as unknown as JobRepository;
    const useCase = new FindOrCreateJobUseCase(repo);

    const result = await useCase.execute({
      id: notionPageId,
      owner: 'user-a',
      title: 'Test Page',
      type: 'page',
    });

    expect(result.created).toBe(false);
    expect(result.job).toMatchObject({ id: 9 });
  });
});
