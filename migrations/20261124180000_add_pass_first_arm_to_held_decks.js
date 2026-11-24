const FLAG_KEY = 'limit_wall_pass_first';

const SPLIT_TEST_DESCRIPTION =
  'Pass-first split test. On: signed-out visitors whose upload is held are split 50/50. One half sees the sign-up-first gate and a free sign-up releases up to 100 cards; the other half sees passes first and a free sign-up releases the 21-card preview, with the rest saved for a pass. The arm is stored with the hold, so a deck held before the flag went on keeps the sign-up-first gate. /limit and the signed-in walls do not change. Off: everyone gets the sign-up-first gate and the up-to-100-card claim. Flip from /ops.';

const PASS_FIRST_WALL_DESCRIPTION =
  'Pass-first limit wall: the Semester Pass and Day Pass lead /limit, the held-deck gate and the upload limit wall, with free sign-up as a text link, and a free sign-up claim releases only the 21-card preview of a held deck (the rest is saved for a pass). Off restores the sign-up-first wall and the up-to-100-card claim; flip from /ops.';

exports.up = async (knex) => {
  await knex.schema.alterTable('held_decks', (table) => {
    table.text('pass_first_arm').nullable();
  });
  await knex('feature_flags')
    .where({ key: FLAG_KEY })
    .update({ description: SPLIT_TEST_DESCRIPTION });
};

// Reverting drops the arm each hold was shown, so a claim made under the
// reverted code falls back to whatever that code does. Revert the code before
// running down: the current code writes this column on every sign-up hold, so
// dropping it under live code fails every hold insert.
exports.down = async (knex) => {
  await knex('feature_flags')
    .where({ key: FLAG_KEY })
    .update({ description: PASS_FIRST_WALL_DESCRIPTION });
  await knex.schema.alterTable('held_decks', (table) => {
    table.dropColumn('pass_first_arm');
  });
};
