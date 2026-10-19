# notion-render — Ankify sync render path

Pure Notion-block → card-HTML renderer for the Ankify Auto-Sync product. `renderNotionBlocks(blocks, fetchChildren, options)` walks a page's blocks and returns `{ html, media, unsupportedTypes }`. Consumed by `src/services/ankify/notionPageWalker.ts`; this is the sync path, distinct from the one-shot convert path in `src/services/NotionService/` (`BlockHandler` / `blockToStaticMarkup`).

## What's here

- `renderBlocks.ts` — the block-type `switch`. Emits card HTML for every supported type and recurses into container blocks (`toggle`, `callout`, `column_list`, `column`) via `ctx.fetchChildren`, respecting `ctx.maxDepth` (default 8). List items (`bulleted_list_item`, `numbered_list_item`) recurse the same way: an item with `has_children` nests its rendered children inside its own `<li>` (a sub-bullet list becomes a nested `<ul>`/`<ol>`), so sub-bullets are no longer dropped.
- `richText.ts` — inline rich-text renderer shared across block types (annotations, colors, inline equations, links).
- `escape.ts`, `highlightCode.ts`, `embedUrl.ts` — HTML escaping, code highlighting, embed/video URL resolution.
- `types.ts` — `NotionRenderableBlock` (the subset of Notion block shapes the renderer reads) and `RenderedBlocks`.

## Things to know before editing

- **Table and column blocks are rendered on the sync path.** `table`/`table_row` emit an HTML `<table>` (with `<thead>`/`<th>` when `has_column_header`, else `<tbody>`/`<td>`), matching the convert path's `BlockTable` output; `column_list`/`column` are containers that recurse into their children and concatenate the result. Before this, the `switch` had no case for them, so they fell to `default` and were silently dropped — 56× `table` / 28× `column_list` in one prod window per the unsupported-blocks metric. Both paths (convert + sync) must keep table/column parity so a synced card matches a converted one.
- **Media collection flows through `ctx.media`.** Any image/audio/video/file inside a recursed subtree (including inside a column) pushes its ref onto the shared `ctx.media` array, so the `.apkg` packager bundles the bytes. Don't render a container's children without threading the same `ctx` through, or media inside it is lost.
- **`unsupportedTypes` feeds the unsupported-blocks metric.** A block type with no `switch` case is pushed here (and counted in prod). Adding a real case removes the type from that count — the metric is how we detect the next dropped-content gap.
- **Pure module.** No `axios`, `knex`, or `@notionhq/client` here — child fetching is injected as `fetchChildren`.
