/**
 * Per-conversion accounting for the conversion report (#4211): blocks seen,
 * cards created, and skipped entries with reasons, written once when a job
 * completes. JSONB so counts stay aggregatable in SQL.
 */
exports.up = function (knex) {
  return knex.schema.alterTable('jobs', (table) => {
    table.jsonb('conversion_report').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('jobs', (table) => {
    table.dropColumn('conversion_report');
  });
};
