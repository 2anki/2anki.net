exports.up = async (knex) => {
  await knex('feature_flags')
    .insert({
      key: 'thin_deck_ai_offer',
      value: false,
      description:
        'Offer an opt-in Claude preview when a file gives too few cards. Off by default; flip from /ops. Claude only runs after the person taps the preview button, never automatically.',
    })
    .onConflict('key')
    .ignore();
};

exports.down = async (knex) => {
  await knex('feature_flags').where({ key: 'thin_deck_ai_offer' }).del();
};
