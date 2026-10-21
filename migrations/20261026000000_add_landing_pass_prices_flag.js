exports.up = async (knex) => {
  await knex('feature_flags')
    .insert({
      key: 'landing_pass_prices',
      value: false,
      description:
        'Show the live Day Pass and Semester Pass prices on the public landing pages, next to the upload. Off by default; flip from /ops to show the price note to ad traffic. Prices are read live from /api/pricing, so this only controls visibility.',
    })
    .onConflict('key')
    .ignore();
};

exports.down = async (knex) => {
  await knex('feature_flags').where({ key: 'landing_pass_prices' }).del();
};
