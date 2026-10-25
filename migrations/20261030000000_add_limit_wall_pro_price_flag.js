exports.up = async (knex) => {
  await knex('feature_flags')
    .insert({
      key: 'limit_wall_pro_price',
      value: false,
      description:
        'Show the monthly price and interval on the Pro card of the limit wall (/limit) for signed in people. Off by default; flip from /ops. The amount is read from /api/checkout/prices, so this only controls visibility.',
    })
    .onConflict('key')
    .ignore();
};

exports.down = async (knex) => {
  await knex('feature_flags').where({ key: 'limit_wall_pro_price' }).del();
};
