---
title: Edit cards before downloading
description: Remove or edit cards directly in the preview — before the .apkg file leaves your browser.
---

When you preview a converted deck, you can edit or delete any card before downloading. Changes apply only to the downloaded file — they don't affect your original source.

## What you can do

- **Edit front or back text** — click "Edit front" or "Edit back" on any card, type your changes, then press Enter or click outside to save. Press Escape to cancel.
- **Delete a card** — click "Delete" to exclude it from the downloaded deck. The card is dimmed but not gone until you download. Click "Restore" to bring it back.

## The header strip

Above the card list, you'll see a live count:

> **47** cards · **3** deleted

The Download button updates to reflect the actual export size: "Download deck (44 cards)".

## Restore all

The "Restore all" button reverts every edit and deletion in the current session. The deck goes back to what the converter originally produced.

## Edits don't persist

Edits live in the page until you close or reload the tab. If you have unsaved edits and try to leave, your browser will warn you. After you download, the original source file on 2anki is unchanged — re-open the preview to start fresh or try different edits.

## Importing the edited deck into Anki

Anki updates a note from the download only when the downloaded note is newer than the copy in your collection, and then it replaces every field of that note. So if you changed a note in Anki at or after the moment you downloaded your edits here, Anki keeps its own copy and skips yours without a message. If your edit here is newer, it replaces the whole note, including a field you changed only in Anki. When a deleted card's note makes more than one card, Anki may add that card back as a new card later, for example when you run Check Database or edit the note in Anki; deleting every card of a note leaves the note out of the download.
