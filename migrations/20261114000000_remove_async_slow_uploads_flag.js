exports.up = async (knex) => {
  await knex('feature_flags').where({ key: 'async_slow_uploads' }).del();
};

exports.down = async (knex) => {
  await knex('feature_flags')
    .insert({
      key: 'async_slow_uploads',
      value: true,
      description:
        'Signed-in paying users: PowerPoint files and large PDFs (already past their question) convert in the background and land in My Decks, so a dropped connection no longer loses the deck. Restored on rollback in its prod state (on); off = every upload converts while the request stays open.',
    })
    .onConflict('key')
    .ignore();
};
