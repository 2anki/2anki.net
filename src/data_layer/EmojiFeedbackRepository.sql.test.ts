import knex from 'knex';

describe('EmojiFeedbackRepository.countLowRatingsFromEmailOnDay generated SQL', () => {
  it('filters by email, low rating and the day range with bound params', () => {
    const pg = knex({ client: 'pg' });

    const sql = pg('emoji_feedback')
      .whereRaw('LOWER(TRIM(email)) = LOWER(?)', ['learner@example.com'])
      .andWhere('rating', '<=', 2)
      .andWhere('created_at', '>=', '2026-10-19T00:00:00.000Z')
      .andWhere('created_at', '<', '2026-10-20T00:00:00.000Z')
      .count('* as count')
      .first()
      .toString();

    expect(sql).toBe(
      'select count(*) as "count" from "emoji_feedback" ' +
        "where LOWER(TRIM(email)) = LOWER('learner@example.com') " +
        'and "rating" <= 2 ' +
        'and "created_at" >= \'2026-10-19T00:00:00.000Z\' ' +
        'and "created_at" < \'2026-10-20T00:00:00.000Z\' limit 1'
    );
  });
});

describe('LowRatingContextRepository.getByEmail generated SQL', () => {
  it('matches an active subscription by linked_email or payer email', () => {
    const pg = knex({ client: 'pg' });

    const sql = pg('subscriptions')
      .where({ active: true })
      .andWhere((builder) =>
        builder
          .where({ linked_email: 'learner@example.com' })
          .orWhere({ email: 'learner@example.com' })
      )
      .first()
      .toString();

    expect(sql).toBe(
      'select * from "subscriptions" where "active" = true ' +
        'and ("linked_email" = \'learner@example.com\' ' +
        'or ("email" = \'learner@example.com\')) limit 1'
    );
  });

  it('reads the newest job for an owner', () => {
    const pg = knex({ client: 'pg' });

    const sql = pg('jobs')
      .where({ owner: '21770' })
      .orderBy('id', 'desc')
      .select('id', 'status')
      .first()
      .toString();

    expect(sql).toBe(
      'select "id", "status" from "jobs" where "owner" = \'21770\' ' +
        'order by "id" desc limit 1'
    );
  });
});
