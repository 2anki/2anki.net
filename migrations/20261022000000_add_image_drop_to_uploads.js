exports.up = async (knex) => {
  await knex.schema.alterTable('uploads', (table) => {
    table.integer('dropped_image_count');
    table.text('image_drop_reason');
  });
};

// Reverting drops the per-upload image-drop metadata. The Downloads page falls
// back to showing no notice for those rows, exactly as before this column
// existed — no data loss beyond the explanatory notice itself.
exports.down = async (knex) =>
  knex.schema.alterTable('uploads', (table) => {
    table.dropColumn('dropped_image_count');
    table.dropColumn('image_drop_reason');
  });
