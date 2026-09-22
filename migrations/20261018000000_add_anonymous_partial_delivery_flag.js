exports.up = async (knex) => {
  await knex('feature_flags')
    .insert({
      key: 'anonymous_partial_delivery',
      value: false,
      description:
        'Anonymous partial delivery. Off by default; flip from /ops to split anonymous single-file uploads 50/50 between the first-21-cards download and the current limit page.',
    })
    .onConflict('key')
    .ignore();
};

exports.down = async (knex) => {
  await knex('feature_flags').where({ key: 'anonymous_partial_delivery' }).del();
};
