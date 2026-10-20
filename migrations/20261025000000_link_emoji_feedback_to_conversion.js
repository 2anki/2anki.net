exports.up = async (knex) => {
  await knex.schema.alterTable('emoji_feedback', (t) => {
    t.integer('job_id').nullable().defaultTo(null);
    t.integer('upload_id').nullable().defaultTo(null);
    t.integer('owner').nullable().defaultTo(null);
    t.string('input_format', 64).nullable().defaultTo(null);
    t.index('job_id', 'emoji_feedback_job_id_index');
    t.index('upload_id', 'emoji_feedback_upload_id_index');
    t.index('owner', 'emoji_feedback_owner_index');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('emoji_feedback', (t) => {
    t.dropIndex('job_id', 'emoji_feedback_job_id_index');
    t.dropIndex('upload_id', 'emoji_feedback_upload_id_index');
    t.dropIndex('owner', 'emoji_feedback_owner_index');
    t.dropColumn('job_id');
    t.dropColumn('upload_id');
    t.dropColumn('owner');
    t.dropColumn('input_format');
  });
};
