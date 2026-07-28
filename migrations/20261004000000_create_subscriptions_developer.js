exports.up = async (knex) => {
  // Developer tiers are a SECOND concurrent Stripe subscription: a $7.99
  // subscriber can also hold Starter or Growth. The subscriptions table is one
  // row per email and upserts with onConflict('email'), so both would collapse
  // into a single row whose active and stripe_product_id reflect whichever
  // webhook fired last — demoting a paying developer to the sandbox tier, or
  // stripping unlimited cards from the base plan when the add-on is cancelled.
  //
  // Giving them their own table makes that structurally impossible instead of
  // defended against, and leaves the 725 live rows in subscriptions untouched.
  // Unlike subscriptions, this table is keyed on the Stripe subscription id:
  // developer tiers do not use the linked_email mechanism, which is the reason
  // subscriptions legitimately holds the same subscription under two emails.
  await knex.schema.createTable('subscriptions_developer', (table) => {
    table.increments('id').primary();
    table.text('stripe_subscription_id').notNullable().unique();
    // Mirrors the events and error_events tables: a webhook-populated user_id
    // that must not block account deletion, and must not be left pointing at a
    // user that no longer exists on a paid-access path. Added now, while the
    // table is empty — ALTER TABLE ADD CONSTRAINT on a populated table takes
    // SHARE ROW EXCLUSIVE on both tables.
    table
      .integer('user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
    table.string('email', 255).nullable();
    table.text('stripe_product_id').notNullable();
    table.boolean('active').notNullable().defaultTo(false);
    table.json('payload').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  // The read is "which dev-tier products does this user hold right now", on
  // every API request behind RequireApiKey.
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS subscriptions_developer_user_active_index ON subscriptions_developer (user_id, active)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS subscriptions_developer_email_active_index ON subscriptions_developer (email, active)'
  );
};

// Nothing to preserve: no developer subscription has ever existed in production
// (verified before the table was added), so reverting loses no paid state.
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('subscriptions_developer');
};
