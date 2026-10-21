exports.up = async (knex) => {
  await knex('feature_flags')
    .insert({
      key: 'anonymous_day_pass_card',
      value: false,
      description:
        'Anonymous Day Pass card. Off by default; flip from /ops to give the no-account Day Pass its own card on the limit wall and the held-deck gate, lead with it when a deck is over a free month, and pass the deck card count through so the offer reads "get all N cards".',
    })
    .onConflict('key')
    .ignore();
};

exports.down = async (knex) => {
  await knex('feature_flags').where({ key: 'anonymous_day_pass_card' }).del();
};
