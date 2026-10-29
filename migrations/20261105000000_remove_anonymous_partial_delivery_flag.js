exports.up = async (knex) => {
  await knex('feature_flags')
    .where({ key: 'anonymous_partial_delivery' })
    .del();
};

exports.down = async (knex) => {
  await knex('feature_flags')
    .insert({
      key: 'anonymous_partial_delivery',
      value: true,
      description:
        'Anonymous partial delivery. On: anonymous single-file uploads over the cap get the first-21-cards held deck. Off: they get the limit page.',
    })
    .onConflict('key')
    .ignore();
};
