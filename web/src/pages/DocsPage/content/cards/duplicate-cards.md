---
title: Update your deck, keep your reviews
description: Why re-uploading sometimes made duplicate cards, what keeps each card stable, and how to clear out copies you already have.
---

Edit a Notion page, convert it again, and 2anki updates your existing Notion cards instead of handing you a second copy. Every card carries a hidden ID, and Anki uses that ID to tell a card it already has from a new one. This page explains what sets that ID, what keeps it stable, and what to do if you already have duplicates.

Already have duplicates? [Skip to clearing them out](#clearing-out-duplicates-you-already-have).

## Why you ended up with every card twice

Cards used to be identified by their text. Change a single word, the deck name, or a card option, and the ID changed with it. Notion quietly changing its export format, which happened in July, had the same effect. Anki read the changed cards as brand new and added them next to the originals. That's how one small edit turned into a full second copy of the deck.

Cards built from Notion are now anchored to the Notion block they came from, which doesn't drift. Renaming a deck or changing options no longer affects their identity. Only genuinely new content makes new cards.

Expect this once: the first re-import after this update may add one last set of duplicates for decks you've converted since early July. Clear those out once (see below) and updates are silent from then on.

## How 2anki knows a card is the same card

- **Cards from Notion toggles**, whether synced pages or uploaded Notion exports, are tied to the toggle's own block in Notion. As long as it's the same block, it's the same card: edit the text all you want and your reviews stay put.
- **Cards from plain text on a Notion page** (paragraph and list cards) and **cards from other files** (Markdown, CSV, spreadsheets) have no block to anchor to, so they're identified by the deck name and the card's front text. Keep the deck name the same when you re-upload, and know that rewording a card makes Anki see a new one. Delete the old copy when you do.

## What keeps a Notion toggle stable

Notion gives every block its own ID. Some actions keep that ID; a few replace it with a new one. When the ID is new, nothing can tell 2anki it's the same card, so Anki sees a new card. This is Notion's behavior, not something 2anki controls.

| In Notion you… | The toggle's ID | In Anki you get |
| --- | --- | --- |
| Edit the header or body in place | Stays the same | The card updates, reviews kept |
| Drag or reorder it on the page | Stays the same | No change |
| Indent it under another toggle, or un-indent it | Stays the same | May start or stop being its own card, depending on your card options |
| Cut it and paste it elsewhere | Becomes new | A new card. The old one stays |
| Duplicate the block | Becomes new | A new card |
| Copy it to another page | Becomes new | A new card |
| Delete it | Stops existing | The card is gone from the next conversion; remove it in Anki when you notice |

If you moved a toggle by cutting and pasting and now see a duplicate, that's why. To move a toggle without making a new card, drag it instead.

## What about the deck itself?

Anki matches decks by name, the way it matches cards by ID. If the deck's name changes, because the page was renamed or its emoji changed, the next import creates a fresh deck with the new name. Your existing cards stay where they are; only new cards land in the fresh deck. In July, a Notion export change briefly made 2anki drop the emoji from deck names on its own, which created exactly this. That bug is fixed; deck names keep their emoji again. If it happens for another reason, rename the deck in Anki to the new name before importing, or drag the strays over afterwards and delete the empty deck.

## A workflow for clean updates

- **Edit in place.** Change the text inside a toggle rather than deleting it and rewriting a new one.
- **Move by dragging**, not cut-and-paste, when you want to keep the card and its history.
- **For non-Notion files, keep the deck name stable** and expect a reworded card front to arrive as a new card.
- **Rename Notion decks and change options freely.** Neither affects those cards' identity anymore.
- **Import with Anki's defaults.** Updates work without any special import options.

## Clearing out duplicates you already have

Two things leave you with real duplicates: cards made before this update, and the one-time first re-import of any deck you've converted since early July, while the new stable IDs take over. After that first re-import, updates are silent again.

Either way, the copies to keep are the ones with your review history:

1. In Anki, open **Browse**.
2. Select the deck, then click the **Created** column to sort by creation date. Right-click the column header and add the **Reviews** column if it isn't shown.
3. The copies created just now are the duplicates. They have **0 reviews**. Your originals are the older ones, with your real review counts.
4. Select the 0-review copies and delete them with **Notes → Delete** in the menu bar.

Future re-imports of the same source update the cards you kept, in place.

If both copies have review history you care about, [contact us](/documentation/help/contact) before deleting anything. We can sometimes merge them.
