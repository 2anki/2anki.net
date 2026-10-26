exports.up = async (knex) => {
  await knex('feature_flags')
    .insert({
      key: 'async_slow_uploads',
      value: false,
      description:
        'Signed-in paying users: PowerPoint files and large PDFs (already past their question) convert in the background and land in My Decks, so a dropped connection no longer loses the deck. Off by default; unset = every upload converts while the request stays open.',
    })
    .onConflict('key')
    .ignore();
};

exports.down = async (knex) => {
  await knex('feature_flags').where({ key: 'async_slow_uploads' }).del();
};
