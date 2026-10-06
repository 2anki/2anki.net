import knex from 'knex';

import {
  DeckDistributionIntentRepository,
  InMemoryDeckDistributionIntentRepository,
} from './DeckDistributionIntentRepository';

const pg = knex({ client: 'pg' });

describe('DeckDistributionIntentRepository generated SQL', () => {
  it('inserts the answer, notify email, user id, and upload key', () => {
    const repo = new DeckDistributionIntentRepository(pg);
    const sql = repo
      .buildRecordQuery({
        answer: 'students',
        notify_email: 'learner@example.com',
        user_id: 42,
        upload_key: 'deck-abc.apkg',
      })
      .toString();
    expect(sql).toContain('insert into "deck_distribution_intent"');
    expect(sql).toContain("'students'");
    expect(sql).toContain("'learner@example.com'");
    expect(sql).toContain('42');
    expect(sql).toContain("'deck-abc.apkg'");
  });

  it('counts rows grouped by answer, most common first', () => {
    const repo = new DeckDistributionIntentRepository(pg);
    const sql = repo.buildCountQuery().toString();
    expect(sql).toContain('from "deck_distribution_intent"');
    expect(sql).toContain('count(*)');
    expect(sql).toContain('group by "answer"');
    expect(sql).toContain('order by "count" desc');
  });
});

describe('InMemoryDeckDistributionIntentRepository', () => {
  it('aggregates counts by answer in descending order', async () => {
    const repo = new InMemoryDeckDistributionIntentRepository();
    await repo.record({
      answer: 'students',
      notify_email: null,
      user_id: 1,
      upload_key: 'a',
    });
    await repo.record({
      answer: 'students',
      notify_email: null,
      user_id: 2,
      upload_key: 'b',
    });
    await repo.record({
      answer: 'customers',
      notify_email: 'x@y.co',
      user_id: 3,
      upload_key: 'c',
    });

    expect(await repo.countByAnswer()).toEqual([
      { answer: 'students', count: 2 },
      { answer: 'customers', count: 1 },
    ]);
  });
});
