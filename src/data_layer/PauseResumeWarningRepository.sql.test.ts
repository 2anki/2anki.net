import knex from 'knex';
import PauseResumeWarningRepository from './PauseResumeWarningRepository';

describe('PauseResumeWarningRepository generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new PauseResumeWarningRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('selects paused subscriptions by the jsonb resumes_at window', () => {
    const { sql, bindings } = repository
      .buildPausedResumingQuery(1000, 2000)
      .toSQL();

    expect(sql).toContain('"subscriptions"');
    expect(sql).toContain(
      "(payload::jsonb #>> '{pause_collection,resumes_at}')::bigint between ? and ?"
    );
    expect(bindings).toEqual([1000, 2000]);
  });

  it('claims a notice with one insert that does nothing on a repeat', () => {
    const { sql, bindings } = repository
      .buildClaimNoticeQuery(
        'stripe@example.com',
        new Date('2026-08-07T12:00:00Z')
      )
      .toSQL();

    expect(sql).toBe(
      'insert into "pause_resume_warning_notices" ("resumes_at", "subscription_email") values (?, ?) on conflict ("subscription_email", "resumes_at") do nothing returning "id"'
    );
    expect(bindings).toEqual([
      new Date('2026-08-07T12:00:00Z'),
      'stripe@example.com',
    ]);
  });
});
