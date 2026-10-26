exports.up = async (knex) => {
  await knex('feature_flags')
    .insert({
      key: 'anonymous_ai_choice',
      value: false,
      description:
        'AI choice next to the uploader for visitors without an account. Off by default; with it and anonymous_ai_preview on, every file-format landing page with an uploader and /upload show two equal options (structure, free, no AI / Claude writes the cards, free sample first) with the consent text in the choice. AI stays off until the visitor picks it. Unset = today’s checkbox on the AI page and /upload only.',
    })
    .onConflict('key')
    .ignore();
};

exports.down = async (knex) => {
  await knex('feature_flags').where({ key: 'anonymous_ai_choice' }).del();
};
