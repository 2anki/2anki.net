// Deleting a user left rows behind in every table below (no FK to users), and
// re_engagement_feedback's NO ACTION FK made any user with feedback rows
// undeletable outright. Orphans from past deletions are purged before each
// constraint lands, otherwise the FK creation itself fails.

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
    await createIndex(knex, table, 'owner');
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
    await createIndex(knex, table, 'user_id');
  }

  await knex('conversion_rule_scores')
    .whereNotNull('owner')
    .whereNotIn('owner', knex('users').select('id'))
    .update({ owner: null });
  await knex.schema.table('conversion_rule_scores', (t) => {
    t.foreign('owner').references('id').inTable('users').onDelete('SET NULL');
  });
  await createIndex(knex, 'conversion_rule_scores', 'owner');

  await knex.schema.table('re_engagement_feedback', (t) => {
    t.dropForeign(['email_id']);
  });
  await knex.schema.table('re_engagement_feedback', (t) => {
    t.foreign('email_id')
      .references('id')
      .inTable('re_engagement_emails')
      .onDelete('CASCADE');
  });
};

exports.down = async (knex) => {
  for (const table of CASCADE_BY_OWNER) {
    await dropIndex(knex, table, 'owner');
    await knex.schema.table(table, (t) => {
      t.dropForeign(['owner']);
    });
  }

  for (const table of CASCADE_BY_USER_ID) {
    await dropIndex(knex, table, 'user_id');
    await knex.schema.table(table, (t) => {
      t.dropForeign(['user_id']);
    });
  }

  await dropIndex(knex, 'conversion_rule_scores', 'owner');
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
