exports.up = async (knex) => {
  await knex('feature_flags')
    .insert({
      key: 'anonymous_ai_preview',
      value: false,
      description:
        'No-account AI preview. Off by default; flip from /ops to let a visitor without an account turn on AI, see a small cost-capped sample of the AI cards for their file, and unlock the full deck with a Day Pass (surface ai-preview) without uploading again. Unset = today’s free parser deck.',
    })
    .onConflict('key')
    .ignore();
};

exports.down = async (knex) => {
  await knex('feature_flags').where({ key: 'anonymous_ai_preview' }).del();
};
