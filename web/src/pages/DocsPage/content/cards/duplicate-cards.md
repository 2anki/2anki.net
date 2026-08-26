---
title: Update your deck, keep your reviews
description: Why re-uploading sometimes made duplicate cards, what keeps each card stable, and how to clear out copies you already have.
---

Edit a Notion page, convert it again, and 2anki updates your existing Notion cards instead of handing you a second copy. Every card carries a hidden ID, and Anki uses that ID to tell a card it already has from a new one. This page explains what sets that ID, what keeps it stable, and what to do if you already have duplicates.

Already have duplicates? [Skip to clearing them out](#clearing-out-duplicates-you-already-have).

## Why you ended up with every card twice

Cards used to be identified by their text. Change a single word, the deck name, or a card option, and the ID changed with it. Notion quietly changing its export format, which happened in July, had the same effect. Anki read the changed cards as brand new and added them next to the originals. That's how one small edit turned into a full second copy of the deck.

When you're signed in, cards built from Notion are anchored to the Notion block they came from, which doesn't drift, and 2anki remembers that anchor under your account. Renaming a deck or changing options no longer affects their identity. Only genuinely new content makes new cards.

Already have a doubled deck from that July stretch? Clear it out once (see below) and it stays clear. Signed in, this change adds no new duplicates, because your cards already match what you imported. Signed out, a later Notion format change can still split a deck, so clean up once more if that happens.

## How 2anki knows a card is the same card

Sign in before you convert, and 2anki remembers each card's ID under your account, so re-uploads land on the same cards even across renames and Notion format changes.

- **Signed in, Notion toggle uploads**: 2anki remembers each card's ID under your account, anchored to the Notion block it came from (see the table below). Rename the deck, reword a card, or re-export after Notion changes its format, and your reviews stay put.
- **Signed out, or cards without a Notion block** (plain text on a page, Markdown, CSV, spreadsheets): cards are identified by the deck name and the card's front text. Keep the deck name the same when you re-upload, and know that rewording a card makes Anki see a new one. Delete the old copy when you do.
- **Synced Notion pages**: nothing changes here. Sync always runs under your account and remembers every card by its Notion block. Edit the text all you want and your reviews stay put.

## What keeps a Notion toggle stable

Notion gives every block its own ID. Some actions keep that ID; a few replace it with a new one. When the ID is new, nothing can tell 2anki it's the same card, so Anki sees a new card. This is Notion's behavior, not something 2anki controls.

| In Notion you…                                  | The toggle's ID | In Anki you get                                                              |
| ----------------------------------------------- | --------------- | ---------------------------------------------------------------------------- |
| Edit the header or body in place                | Stays the same  | The card updates, reviews kept                                               |
| Drag or reorder it on the page                  | Stays the same  | No change                                                                    |
| Indent it under another toggle, or un-indent it | Stays the same  | May start or stop being its own card, depending on your card options         |
| Cut it and paste it elsewhere                   | Becomes new     | A new card. The old one stays                                                |
| Duplicate the block                             | Becomes new     | A new card                                                                   |
| Copy it to another page                         | Becomes new     | A new card                                                                   |
| Delete it                                       | Stops existing  | The card is gone from the next conversion; remove it in Anki when you notice |

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

Which copy you keep depends on when you first built the deck. Either way, keep the copies with your review history and delete the ones with **0 reviews**.

**Built before July 2026?** Your original cards hold your reviews, but re-uploading after Notion's July export change can create a fresh set instead of updating them. Turn on **Match cards to their Notion blocks** in your card options, then upload the page again. It updates your originals in place; clear the leftover 0-review copies with the steps below.

**Built in July 2026 or later?** Leave that option off. Your cards already key to their Notion blocks, so turning it on would re-key them into a second set. Signed in, updates land on your existing cards on their own.

Then, either way:

1. In Anki, open **Browse**.
2. Select the deck, then click the **Created** column to sort by creation date. Right-click the column header and add the **Reviews** column if it isn't shown.
3. The extra copies have **0 reviews**. Your originals are the older ones, with your real review counts.
4. Select the 0-review copies and delete them with **Notes → Delete** in the menu bar.

Future imports of the same page update the cards you kept, in place.

If both copies have review history you care about, [contact us](/documentation/help/contact) before deleting anything. We can sometimes merge them.
