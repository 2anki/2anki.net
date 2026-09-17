exports.up = async (knex) => {
  await knex('feature_flags').where({ key: 'ai-converter-floor-v1' }).del();
};

exports.down = async (knex) => {
  await knex('feature_flags').insert({
    key: 'ai-converter-floor-v1',
    value: false,
    description:
      'AI converter floor v1 — per #2726 spec. Off by default; flip from /ops to start the canary.',
  });
};
