exports.up = async (knex) => {
  await knex('feature_flags')
    .insert({
      key: 'native_card_limit',
      value: true,
      description:
        'Native app on-device monthly card limit (Laer-Smart/2anki.app#95): free app users, signed in or not, export the first cards of a deck over the monthly cap and the rest is held for a pass. Read by the app from GET /api/native/config. Off lifts the cap in the app without an App Review cycle; flip from /ops.',
    })
    .onConflict('key')
    .ignore();
};

exports.down = async (knex) => {
  await knex('feature_flags').where({ key: 'native_card_limit' }).del();
};
