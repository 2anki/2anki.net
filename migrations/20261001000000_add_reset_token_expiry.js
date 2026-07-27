exports.up = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.timestamp('reset_token_expires_at', { useTz: true }).nullable();
    table.timestamp('reset_token_used_at', { useTz: true }).nullable();
  });

  // Existing tokens were minted without an expiry and never invalidated on use,
  // so every one of them is still redeemable. They cannot be given a valid
  // window retroactively — clear them. Affected users request a new link.
  await knex('users').whereNotNull('reset_token').update({ reset_token: null });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('reset_token_used_at');
    table.dropColumn('reset_token_expires_at');
  });
};
