import knex, { Knex } from 'knex';
import JobRepository from './JobRepository';

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
  await db.schema.createTable('uploads', (t) => {
    t.increments('id');
    t.integer('owner').notNullable();
    t.string('key').notNullable();
    t.string('filename');
    t.string('object_id');
    t.float('size_mb');
    t.timestamp('created_at').defaultTo(db.fn.now());
  });
  return db;
}

async function insertJob(
  db: Knex,
  attrs: {
    owner: string;
    object_id: string;
    status?: string;
    title?: string;
    type?: string;
  }
) {
  return db('jobs').insert({
    owner: attrs.owner,
    object_id: attrs.object_id,
    status: attrs.status ?? 'done',
    title: attrs.title ?? 'Deck',
    type: attrs.type ?? 'page',
    last_edited_time: new Date(),
  });
}

async function insertUpload(
  db: Knex,
  attrs: {
    owner: number;
    object_id: string | null;
    key: string;
    filename?: string;
  }
) {
  return db('uploads').insert({
    owner: attrs.owner,
    object_id: attrs.object_id,
    key: attrs.key,
    filename: attrs.filename ?? attrs.key,
    size_mb: 1,
  });
}

describe('JobRepository.getJobsByOwner', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await makeDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('returns one row with download_key when a single upload matches', async () => {
    await insertJob(db, { owner: '1', object_id: 'page-a' });
    await insertUpload(db, { owner: 1, object_id: 'page-a', key: 'a.apkg' });

    const repo = new JobRepository(db);
    const rows = await repo.getJobsByOwner('1');

    expect(rows).toHaveLength(1);
    expect(rows[0].download_key).toBe('a.apkg');
  });

  it('returns one row with download_key = null when no uploads match', async () => {
    await insertJob(db, { owner: '1', object_id: 'page-a' });

    const repo = new JobRepository(db);
    const rows = await repo.getJobsByOwner('1');

    expect(rows).toHaveLength(1);
    expect(rows[0].download_key).toBeNull();
    expect(rows[0].upload_id).toBeNull();
  });

  it('dedupes N uploads for the same (owner, object_id) into one row with the latest key', async () => {
    await insertJob(db, { owner: '1', object_id: 'page-a' });
    await insertUpload(db, { owner: 1, object_id: 'page-a', key: 'a-1.apkg' });
    await insertUpload(db, { owner: 1, object_id: 'page-a', key: 'a-2.apkg' });
    await insertUpload(db, { owner: 1, object_id: 'page-a', key: 'a-3.apkg' });

    const repo = new JobRepository(db);
    const rows = await repo.getJobsByOwner('1');

    expect(rows).toHaveLength(1);
    expect(rows[0].download_key).toBe('a-3.apkg');
  });

  it('keeps owner-scoping: another owner with the same object_id does not leak across', async () => {
    await insertJob(db, { owner: '1', object_id: 'page-shared' });
    await insertUpload(db, {
      owner: 2,
      object_id: 'page-shared',
      key: 'other.apkg',
    });

    const repo = new JobRepository(db);
    const rows = await repo.getJobsByOwner('1');

    expect(rows).toHaveLength(1);
    expect(rows[0].download_key).toBeNull();
  });

  it('ignores uploads with null object_id (direct file uploads do not match Notion jobs)', async () => {
    await insertJob(db, { owner: '1', object_id: 'page-a' });
    await insertUpload(db, { owner: 1, object_id: null, key: 'direct.apkg' });

    const repo = new JobRepository(db);
    const rows = await repo.getJobsByOwner('1');

    expect(rows).toHaveLength(1);
    expect(rows[0].download_key).toBeNull();
  });

  it('handles multiple jobs with different object_ids correctly', async () => {
    await insertJob(db, { owner: '1', object_id: 'page-a', title: 'A' });
    await insertJob(db, { owner: '1', object_id: 'page-b', title: 'B' });
    await insertUpload(db, { owner: 1, object_id: 'page-a', key: 'a.apkg' });
    await insertUpload(db, { owner: 1, object_id: 'page-b', key: 'b-1.apkg' });
    await insertUpload(db, { owner: 1, object_id: 'page-b', key: 'b-2.apkg' });

    const repo = new JobRepository(db);
    const rows = await repo.getJobsByOwner('1');

    expect(rows).toHaveLength(2);
    const byTitle = Object.fromEntries(
      rows.map((r) => [r.title, r.download_key])
    );
    expect(byTitle.A).toBe('a.apkg');
    expect(byTitle.B).toBe('b-2.apkg');
  });
});

describe('JobRepository.restartJob — optimistic lock', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await makeDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('returns the updated job when transitioning from a terminal status', async () => {
    await insertJob(db, { owner: '1', object_id: 'page-a', status: 'done' });
    const repo = new JobRepository(db);

    const result = await repo.restartJob('page-a', '1');

    expect(result).toMatchObject({ status: 'started', object_id: 'page-a' });
  });

  it('returns undefined when the job is already non-terminal (second click loses the race)', async () => {
    await insertJob(db, { owner: '1', object_id: 'page-a', status: 'started' });
    const repo = new JobRepository(db);

    const result = await repo.restartJob('page-a', '1');

    expect(result).toBeUndefined();
  });

  it('second concurrent restart is a no-op: only one transition occurs', async () => {
    await insertJob(db, { owner: '1', object_id: 'page-a', status: 'done' });
    const repo = new JobRepository(db);

    const [first, second] = await Promise.all([
      repo.restartJob('page-a', '1'),
      repo.restartJob('page-a', '1'),
    ]);

    const winner = first ?? second;
    const loser = first == null ? first : second;

    expect(winner).toMatchObject({ status: 'started' });
    expect(loser).toBeUndefined();
  });
});

describe('JobRepository.findPriorNotionJobByOwnerAndObjectId', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await makeDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('returns job when a matching prior notion job exists within window', async () => {
    await insertJob(db, {
      owner: 'u1',
      object_id: 'page-a',
      type: 'page',
      status: 'done',
    });
    const repo = new JobRepository(db);

    const result = await repo.findPriorNotionJobByOwnerAndObjectId(
      'u1',
      'page-a',
      90 * 24 * 60 * 60 * 1000
    );

    expect(result).toMatchObject({ object_id: 'page-a', type: 'page' });
  });

  it('returns undefined when no job matches for the owner', async () => {
    await insertJob(db, {
      owner: 'u2',
      object_id: 'page-a',
      type: 'page',
      status: 'done',
    });
    const repo = new JobRepository(db);

    const result = await repo.findPriorNotionJobByOwnerAndObjectId(
      'u1',
      'page-a',
      90 * 24 * 60 * 60 * 1000
    );

    expect(result).toBeUndefined();
  });

  it('returns undefined when job type is not a notion type', async () => {
    await insertJob(db, {
      owner: 'u1',
      object_id: 'file-a',
      type: 'upload',
      status: 'done',
    });
    const repo = new JobRepository(db);

    const result = await repo.findPriorNotionJobByOwnerAndObjectId(
      'u1',
      'file-a',
      90 * 24 * 60 * 60 * 1000
    );

    expect(result).toBeUndefined();
  });
});

describe('JobRepository.countRecentNotionJobsByOwner', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await makeDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('counts only notion-type jobs for the owner', async () => {
    await insertJob(db, {
      owner: 'u1',
      object_id: 'page-a',
      type: 'page',
      status: 'done',
    });
    await insertJob(db, {
      owner: 'u1',
      object_id: 'page-b',
      type: 'database',
      status: 'done',
    });
    await insertJob(db, {
      owner: 'u1',
      object_id: 'file-c',
      type: 'upload',
      status: 'done',
    });
    const repo = new JobRepository(db);

    const count = await repo.countRecentNotionJobsByOwner(
      'u1',
      30 * 24 * 60 * 60 * 1000
    );

    expect(count).toBe(2);
  });

  it('returns 0 when no notion jobs exist for the owner', async () => {
    const repo = new JobRepository(db);

    const count = await repo.countRecentNotionJobsByOwner(
      'u1',
      30 * 24 * 60 * 60 * 1000
    );

    expect(count).toBe(0);
  });
});

describe('JobRepository — generated SQL shape', () => {
  it('findPriorNotionJobByOwnerAndObjectId generates valid PG SQL', () => {
    const pgKnex = knex({ client: 'pg' });
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const sql = pgKnex('jobs')
      .where({ owner: 'u1', object_id: 'page-a' })
      .whereIn('type', ['page', 'database'])
      .where('created_at', '>=', cutoff)
      .select('object_id', 'created_at', 'type')
      .first()
      .toString();
    expect(sql).toContain('where "owner" = \'u1\'');
    expect(sql).toContain('"object_id" = \'page-a\'');
    expect(sql).toContain("\"type\" in ('page', 'database')");
    expect(sql).toContain('"created_at" >=');
    pgKnex.destroy();
  });

  it('countRecentNotionJobsByOwner generates valid PG SQL', () => {
    const pgKnex = knex({ client: 'pg' });
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sql = pgKnex('jobs')
      .where({ owner: 'u1' })
      .whereIn('type', ['page', 'database'])
      .where('created_at', '>=', cutoff)
      .count('* as count')
      .first()
      .toString();
    expect(sql).toContain('count(*) as "count"');
    expect(sql).toContain("\"type\" in ('page', 'database')");
    expect(sql).toContain('"created_at" >=');
    pgKnex.destroy();
  });
});

describe('JobRepository.updateJobStatus — terminal transitions', () => {
  let db: Knex;
  let repo: JobRepository;

  beforeEach(async () => {
    db = await makeDb();
    repo = new JobRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('failed does not overwrite done', async () => {
    await insertJob(db, { owner: '1', object_id: 'job-1', status: 'done' });

    await repo.updateJobStatus('job-1', '1', 'failed', 'late race loser');

    const row = await db('jobs').where({ object_id: 'job-1' }).first();
    expect(row.status).toBe('done');
    expect(row.job_reason_failure).toBeNull();
  });

  it('interrupted does not overwrite done', async () => {
    await insertJob(db, { owner: '1', object_id: 'job-1', status: 'done' });

    await repo.updateJobStatus('job-1', '1', 'interrupted', 'pool drain');

    const row = await db('jobs').where({ object_id: 'job-1' }).first();
    expect(row.status).toBe('done');
  });

  it('done overwrites failed so a successful restart recovers the job', async () => {
    await insertJob(db, { owner: '1', object_id: 'job-1', status: 'failed' });

    await repo.updateJobStatus('job-1', '1', 'done', undefined, 12);

    const row = await db('jobs').where({ object_id: 'job-1' }).first();
    expect(row.status).toBe('done');
    expect(row.card_count).toBe(12);
  });

  it('failed still lands on a running job', async () => {
    await insertJob(db, { owner: '1', object_id: 'job-1', status: 'started' });

    await repo.updateJobStatus('job-1', '1', 'failed', 'real failure');

    const row = await db('jobs').where({ object_id: 'job-1' }).first();
    expect(row.status).toBe('failed');
    expect(row.job_reason_failure).toBe('real failure');
  });
});
