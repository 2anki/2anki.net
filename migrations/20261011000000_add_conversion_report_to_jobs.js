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

// Dropping the column loses every report written since deploy — the counts
// only exist in-flight during conversion and cannot be rebuilt. Acceptable:
// the report is explanatory, never load-bearing (decks and jobs are intact),
// and rolling back means the feature is gone anyway.
exports.down = function (knex) {
  return knex.schema.alterTable('jobs', (table) => {
    table.dropColumn('conversion_report');
  });
};
