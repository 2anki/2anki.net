const LEGACY_OBJECT_ID_UNIQUE = 'slicer_rules_object_id_unique';
const OWNER_OBJECT_ID_UNIQUE = 'parser_rules_owner_object_id_unique';

// The object_id-only index allowed one row per page, so no (owner, object_id)
// pair can repeat yet and every existing row keeps its owner. The constraint
// still carries its pre-rename slicer_rules name, hence the explicit names.
// Both swaps take an ACCESS EXCLUSIVE lock on parser_rules for the index
// build; the lock timeout stops it queueing behind a long read.
exports.up = async (knex) => {
  await knex.raw("SET LOCAL lock_timeout = '5s'");
  await knex.schema.alterTable('parser_rules', (table) => {
    table.dropUnique(['object_id'], LEGACY_OBJECT_ID_UNIQUE);
    table.unique(['owner', 'object_id'], {
      indexName: OWNER_OBJECT_ID_UNIQUE,
    });
  });
};

// Lossy when two accounts hold rules for one page: the old index allows a
// single row per page, so every row but the newest for that page is deleted,
// the same choice the settings migration (20260911000001) made.
exports.down = async (knex) => {
  await knex.raw("SET LOCAL lock_timeout = '5s'");
  await knex.raw(`
    DELETE FROM parser_rules a
    USING parser_rules b
    WHERE a.object_id = b.object_id
      AND a.id < b.id
  `);
  await knex.schema.alterTable('parser_rules', (table) => {
    table.dropUnique(['owner', 'object_id'], OWNER_OBJECT_ID_UNIQUE);
    table.unique(['object_id'], { indexName: LEGACY_OBJECT_ID_UNIQUE });
  });
};
