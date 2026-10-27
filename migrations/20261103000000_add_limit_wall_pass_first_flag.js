exports.up = async (knex) => {
  await knex('feature_flags')
    .insert({
      key: 'limit_wall_pass_first',
      value: true,
      description:
        'Pass-first limit wall: the Semester Pass and Day Pass lead /limit, the held-deck gate and the upload limit wall, with free sign-up as a text link, and a free sign-up claim releases only the 21-card preview of a held deck (the rest is saved for a pass). Off restores the sign-up-first wall and the up-to-100-card claim; flip from /ops.',
    })
    .onConflict('key')
    .ignore();
};

exports.down = async (knex) => {
  await knex('feature_flags').where({ key: 'limit_wall_pass_first' }).del();
};
