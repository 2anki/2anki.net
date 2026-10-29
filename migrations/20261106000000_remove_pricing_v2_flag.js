exports.up = async (knex) => {
  await knex('feature_flags').where({ key: 'pricing_v2' }).del();
};

exports.down = async (knex) => {
  await knex('feature_flags')
    .insert({
      key: 'pricing_v2',
      value: true,
      description:
        'Pricing v2: new Pro checkouts resolve the v2 prices by Stripe lookup_key. Off sends new checkouts back to the legacy price ids. Read only by builds before #5154.',
    })
    .onConflict('key')
    .ignore();
};
