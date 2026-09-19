import knex, { Knex } from 'knex';

import { JobsMetricsRepository } from './JobsMetricsRepository';

async function makeDb(): Promise<Knex> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await db.schema.createTable('jobs', (t) => {
    t.increments('id');
    t.string('owner').notNullable();
    t.string('object_id').notNullable();
    t.string('title');
    t.string('type');
    t.string('status');
    t.timestamp('created_at').defaultTo(db.fn.now());
    t.timestamp('last_edited_time');
    t.string('job_reason_failure');
    t.integer('card_count');
  });
  return db;
}

async function insertJob(
  db: Knex,
  attrs: {
    owner: string;
    object_id: string;
    type: string;
    status?: string;
    created_at?: Date;
    job_reason_failure?: string;
  }
) {
  await db('jobs').insert({
    owner: attrs.owner,
    object_id: attrs.object_id,
    type: attrs.type,
    status: attrs.status ?? 'done',
    created_at: attrs.created_at ?? new Date(),
    last_edited_time: new Date(),
    job_reason_failure: attrs.job_reason_failure ?? null,
  });
}

describe('JobsMetricsRepository failure reasons', () => {
  let db: Knex;
  let repo: JobsMetricsRepository;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  beforeEach(async () => {
    db = await makeDb();
    repo = new JobsMetricsRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('groups top failure reasons across Notion job types', async () => {
    await insertJob(db, {
      owner: 'free-user',
      object_id: 'f-1',
      type: 'page',
      status: 'failed',
      job_reason_failure: 'rate limit',
    });
    await insertJob(db, {
      owner: 'free-user',
      object_id: 'f-2',
      type: 'database',
      status: 'failed',
      job_reason_failure: 'rate limit',
    });
    await insertJob(db, {
      owner: 'paid-user',
      object_id: 'f-3',
      type: 'page',
      status: 'failed',
      job_reason_failure: 'timeout',
    });

    const reasons = await repo.topFailureReasons7d(sevenDaysAgo);

    expect(reasons).toEqual([
      { reason: 'rate limit', count: 2 },
      { reason: 'timeout', count: 1 },
    ]);
  });

  it('ignores apkg_import and claude jobs', async () => {
    await insertJob(db, {
      owner: 'free-user',
      object_id: 'a-1',
      type: 'apkg_import',
      status: 'failed',
      job_reason_failure: 'rate limit',
    });
    await insertJob(db, {
      owner: 'free-user',
      object_id: 'c-1',
      type: 'claude',
      status: 'failed',
      job_reason_failure: 'rate limit',
    });

    expect(await repo.topFailureReasons7d(sevenDaysAgo)).toEqual([]);
  });
});
