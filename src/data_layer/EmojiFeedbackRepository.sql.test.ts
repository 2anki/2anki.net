import knex from 'knex';

import { EmojiFeedbackRepository } from './EmojiFeedbackRepository';
import { LowRatingContextRepository } from './LowRatingContextRepository';

const pg = knex({ client: 'pg' });

describe('EmojiFeedbackRepository insert generated SQL', () => {
  it('maps the conversion fields to their columns', () => {
    const repo = new EmojiFeedbackRepository(pg);

    const sql = repo
      .buildInsertQuery({
        rating: 1,
        comment: null,
        page: 'downloads/deck_done',
        email: null,
        owner: 21770,
        jobId: 918,
        uploadId: null,
        inputFormat: 'notion',
      })
      .toString();

    expect(sql).toContain('insert into "emoji_feedback"');
    expect(sql).toContain('"owner"');
    expect(sql).toContain('"job_id"');
    expect(sql).toContain('"upload_id"');
    expect(sql).toContain('"input_format"');
    expect(sql).toContain('21770');
    expect(sql).toContain('918');
    expect(sql).toContain("'notion'");
  });

  it('writes null for the conversion fields when they are omitted', () => {
    const repo = new EmojiFeedbackRepository(pg);

    const sql = repo
      .buildInsertQuery({
        rating: 5,
        comment: null,
        page: 'downloads/deck_done',
        email: null,
      })
      .toString();

    expect(sql).toContain('insert into "emoji_feedback"');
    expect(sql).toMatch(/"input_format"/);
    expect(sql).toContain('NULL');
  });
});

describe('EmojiFeedbackRepository dedupe-count generated SQL', () => {
  it('filters by email, low rating and a day range with bound params', () => {
    const repo = new EmojiFeedbackRepository(pg);

    const sql = repo
      .buildLowRatingsFromEmailOnDayQuery(
        'learner@example.com',
        new Date('2026-10-19T12:00:00.000Z')
      )
      .toString();

    expect(sql).toContain('select count(*) as "count" from "emoji_feedback"');
    expect(sql).toContain("LOWER(TRIM(email)) = LOWER('learner@example.com')");
    expect(sql).toContain('"rating" <= 2');
    expect(sql).toMatch(/"created_at" >= '[^']+' and "created_at" < '[^']+'/);
    expect(sql).toContain('limit 1');
  });
});

describe('LowRatingContextRepository generated SQL', () => {
  const repo = new LowRatingContextRepository(pg);

  it('looks up the account by user id', () => {
    expect(repo.buildUserQuery(21770).toString()).toBe(
      'select "id", "email", "patreon" from "users" where "id" = 21770 limit 1'
    );
  });

  it('matches an active subscription on either lowercased email column', () => {
    expect(
      repo.buildActiveSubscriptionQuery('Learner@Example.com').toString()
    ).toBe(
      'select * from "subscriptions" where "active" = true and ' +
        "(LOWER(linked_email) = LOWER('Learner@Example.com') " +
        "or LOWER(email) = LOWER('Learner@Example.com')) limit 1"
    );
  });

  it('reads the newest job for an owner', () => {
    expect(repo.buildLatestJobQuery('21770').toString()).toBe(
      'select "id", "status" from "jobs" where "owner" = \'21770\' ' +
        'order by "id" desc limit 1'
    );
  });
});
