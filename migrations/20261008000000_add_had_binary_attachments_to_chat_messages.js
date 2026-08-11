exports.up = async (knex) => {
  await knex.schema.alterTable('chat_messages', (t) => {
    t.boolean('had_binary_attachments').notNullable().defaultTo(false);
  });
};

// Rolling back loses the replayability marker on messages sent in the
// interim; regenerate then silently drops their files again, matching
// pre-migration behavior.
exports.down = async (knex) => {
  await knex.schema.alterTable('chat_messages', (t) => {
    t.dropColumn('had_binary_attachments');
  });
};
