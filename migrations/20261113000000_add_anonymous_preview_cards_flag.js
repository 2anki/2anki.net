exports.up = async (knex) => {
  await knex('feature_flags')
    .insert({
      key: 'anonymous_preview_cards',
      value: false,
      description:
        'Held-deck preview cards test. Off by default; flip from /ops to split signed-out visitors whose upload is held for sign-up 50/50, and hand the treatment half the first 21 cards as a download beside the held full deck.',
    })
    .onConflict('key')
    .ignore();
};

exports.down = async (knex) => {
  await knex('feature_flags').where({ key: 'anonymous_preview_cards' }).del();
};
