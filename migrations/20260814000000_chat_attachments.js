exports.up = (knex) =>
  knex.schema.createTable('chat_attachments', (t) => {
    t.increments('id').primary();
    t.integer('message_id')
      .notNullable()
      .references('id')
      .inTable('chat_messages')
      .onDelete('CASCADE');
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('s3_key').notNullable();
    t.text('filename').notNullable();
    t.text('content_type').notNullable();
    t.integer('byte_size').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['message_id']);
    t.index(['created_at']);
  });

exports.down = (knex) => knex.schema.dropTable('chat_attachments');
