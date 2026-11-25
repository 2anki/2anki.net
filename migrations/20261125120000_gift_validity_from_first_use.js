// A gift grant's clock now starts at its first AI call, not when it is made:
// it lasts 7 days from first_used_at and never past the gift's end
// (2026-12-04 22:00 UTC). expires_at stays the column every reader windows
// on: a grant with no AI call yet carries the gift's end, and the first call
// moves it to the earlier of first_used_at + 7 days and that end.
// Existing grants move to the same rule: first_used_at is their first call
// stamped with the grant id, if any, and expires_at is recomputed from it for
// grants still running. A grant that has already expired stays expired, so
// nothing comes back to life or counts against the cap again.
const GIFT_END = '2026-12-04T22:00:00.000Z';
const GIFT_TABLE_CREATED = '2026-11-24T00:00:00.000Z';

const DESCRIPTION_BEFORE =
  'Free AI credits gift: a present in the header lets any account claim 100 AI credits for Claude cards on uploads, spent only after any plan credits, expiring 48 hours after the claim and never after 2026-12-04 22:00 UTC. Claims close 2026-12-04 20:00 UTC and stop when the gift budget is used. Off hides the present, refuses claims and stops gift credits being spent; flip from /ops.';

const DESCRIPTION_AFTER =
  'Free AI credits gift: the upload card offers 100 AI credits for Claude cards to accounts with no plan; the grant is made at the first upload the gift pays for and lasts 7 days from its first AI call, never after 2026-12-04 22:00 UTC. New grants stop 2026-12-04 20:00 UTC and when the gift budget is used. Off hides the offer and stops gift credits being spent; flip from /ops.';

exports.up = async (knex) => {
  await knex.raw("SET LOCAL lock_timeout = '5s'");
  await knex.schema.alterTable('ai_credit_gifts', (t) => {
    t.timestamp('first_used_at', { useTz: true }).nullable();
  });
  await knex.raw(
    `update ai_credit_gifts g
        set first_used_at = s.first_at
       from (
         select props->>'gift_id' as gift_id, min(created_at) as first_at
           from events
          where name = 'ai_usage_recorded'
            and props->>'gift_id' is not null
            and created_at >= ?
          group by props->>'gift_id'
       ) s
      where s.gift_id = g.id::text
        and g.first_used_at is null`,
    [GIFT_TABLE_CREATED]
  );
  await knex.raw(
    `update ai_credit_gifts
        set expires_at = case
          when first_used_at is null then ?::timestamptz
          else least(first_used_at + interval '7 days', ?::timestamptz)
        end
      where expires_at > now()`,
    [GIFT_END, GIFT_END]
  );
  await knex('feature_flags')
    .where({ key: 'ai_credits_gift' })
    .update({ description: DESCRIPTION_AFTER });
};

// Back to 48 hours from the grant being made, never past the gift's end.
// Grants made under the new rule (at a first upload, not a claim) shrink to
// 48 hours from that upload, and every first-use time is lost with the column.
exports.down = async (knex) => {
  await knex.raw("SET LOCAL lock_timeout = '5s'");
  await knex.raw(
    `update ai_credit_gifts
        set expires_at = least(claimed_at + interval '48 hours', ?::timestamptz)`,
    [GIFT_END]
  );
  await knex.schema.alterTable('ai_credit_gifts', (t) => {
    t.dropColumn('first_used_at');
  });
  await knex('feature_flags')
    .where({ key: 'ai_credits_gift' })
    .update({ description: DESCRIPTION_BEFORE });
};
