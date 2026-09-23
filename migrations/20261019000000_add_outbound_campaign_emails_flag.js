exports.up = async (knex) => {
  await knex('feature_flags')
    .insert({
      key: 'outbound_campaign_emails',
      value: false,
      description:
        'Automated campaign email drips (inactivity warnings, re-engagement). Off by default after the 2026-09 SendGrid bounce-rate limitation; flip from /ops to resume the daily batches. Transactional email is unaffected.',
    })
    .onConflict('key')
    .ignore();
};

exports.down = async (knex) => {
  await knex('feature_flags')
    .where({ key: 'outbound_campaign_emails' })
    .del();
};
