// Deleting a user left rows behind in every table below (no FK to users), and
// re_engagement_feedback's NO ACTION FK made any user with feedback rows
// undeletable outright. Orphans from past deletions are purged before each
// constraint lands, otherwise the FK creation itself fails.
//
// Runs in one transaction, which holds a lock on users across all FK
// validations. Accepted deliberately: every child table here is a 2026
// feature table measured in hundreds of rows, not millions, and deploys
// run migrations during the blue-green switch.

const CASCADE_BY_OWNER = [
  'ankify_clients',
  'ankify_export_schedules',
  'ankify_notion_subscriptions',
  'ankify_session_tokens',
  'ankify_sync_conflicts',
  'ankify_sync_logs',
  'notion_top_level_pages',
  'parser_rules',
];

const CASCADE_BY_USER_ID = ['api_key_usage', 'subscription_claim_audit'];

// Only the FK columns with no existing owner-leading index; the other tables
// already carry one (unique constraints or composite indexes leading on the
// FK column), and ankify_clients has had a plain owner index since creation —
// recreating or dropping those here would collide with pre-existing names.
const NEW_INDEXES = [
  ['ankify_session_tokens', 'owner'],
  ['parser_rules', 'owner'],
  ['conversion_rule_scores', 'owner'],
  ['re_engagement_feedback', 'email_id'],
];

function createIndex(knex, table, column) {
  return knex.raw('CREATE INDEX IF NOT EXISTS ?? ON ?? (??)', [
    `${table}_${column}_index`,
    table,
    column,
  ]);
}

function dropIndex(knex, table, column) {
  return knex.raw('DROP INDEX IF EXISTS ??', [`${table}_${column}_index`]);
}

exports.up = async (knex) => {
  for (const table of CASCADE_BY_OWNER) {
    await knex(table)
      .whereNotNull('owner')
      .whereNotIn('owner', knex('users').select('id'))
      .del();
    await knex.schema.table(table, (t) => {
      t.foreign('owner').references('id').inTable('users').onDelete('CASCADE');
    });
  }

  for (const table of CASCADE_BY_USER_ID) {
    await knex(table)
      .whereNotNull('user_id')
      .whereNotIn('user_id', knex('users').select('id'))
      .del();
    await knex.schema.table(table, (t) => {
      t.foreign('user_id')
        .references('id')
        .inTable('users')
        .onDelete('CASCADE');
    });
  }

  await knex('conversion_rule_scores')
    .whereNotNull('owner')
    .whereNotIn('owner', knex('users').select('id'))
    .update({ owner: null });
  await knex.schema.table('conversion_rule_scores', (t) => {
    t.foreign('owner').references('id').inTable('users').onDelete('SET NULL');
  });

  await knex.schema.table('re_engagement_feedback', (t) => {
    t.dropForeign(['email_id']);
  });
  await knex.schema.table('re_engagement_feedback', (t) => {
    t.foreign('email_id')
      .references('id')
      .inTable('re_engagement_emails')
      .onDelete('CASCADE');
  });

  for (const [table, column] of NEW_INDEXES) {
    await createIndex(knex, table, column);
  }
};

// Reverses schema only. The orphan rows purged in up() belonged to users
// deleted before this migration existed and are not restorable — that is the
// point of the migration, not an oversight.
exports.down = async (knex) => {
  for (const [table, column] of NEW_INDEXES) {
    await dropIndex(knex, table, column);
  }

  for (const table of CASCADE_BY_OWNER) {
    await knex.schema.table(table, (t) => {
      t.dropForeign(['owner']);
    });
  }

  for (const table of CASCADE_BY_USER_ID) {
    await knex.schema.table(table, (t) => {
      t.dropForeign(['user_id']);
    });
  }

  await knex.schema.table('conversion_rule_scores', (t) => {
    t.dropForeign(['owner']);
  });

  await knex.schema.table('re_engagement_feedback', (t) => {
    t.dropForeign(['email_id']);
  });
  await knex.schema.table('re_engagement_feedback', (t) => {
    t.foreign('email_id').references('id').inTable('re_engagement_emails');
  });
};
