---
title: Open your deck in Anki
description: Get the .apkg you downloaded into Anki on any device.
---

Anki opens `.apkg` files on every platform — desktop, iPhone, iPad, Android, and the web. The flow is slightly different on each. Pick yours below.

**Plan:** Free (Anki itself is free on every platform except iOS)

## Anki desktop (Windows, macOS, Linux)

1. Make sure Anki is installed — [download it from ankiweb.net](https://apps.ankiweb.net/).
2. Double-click the `.apkg` file you downloaded. Anki opens and imports it.
3. The new deck appears in your deck list, ready to study.

If double-click doesn't work, open Anki and use **File → Import**, then pick the `.apkg`.

## AnkiMobile (iPhone, iPad)

AnkiMobile is a paid app from the official Anki team — buying it directly funds Anki's development.

1. Save the `.apkg` to the Files app (e.g. via AirDrop, Mail, or iCloud Drive).
2. Open Files, tap the `.apkg`, and pick **Open in AnkiMobile**.
3. Confirm the import. The deck appears in your deck list.

If the file opens in a preview app instead, use the **Share** button and pick AnkiMobile from the list.

## AnkiDroid (Android)

AnkiDroid is free on Google Play.

1. Save the `.apkg` to your phone — direct download from Chrome or Firefox works.
2. Open the file from your notifications or the Files app.
3. Pick **AnkiDroid** when Android asks how to open it. The deck imports automatically.

## AnkiWeb

AnkiWeb is the official sync service. You can study in the browser, but it's mainly used to keep desktop and mobile in sync.

1. Sign in at [ankiweb.net](https://ankiweb.net/).
2. AnkiWeb itself doesn't import `.apkg` files directly — import on desktop or mobile, then let Anki sync the deck up to AnkiWeb.

## Updating an existing deck

If you re-convert the same Notion page or file, 2anki keeps the card IDs stable. Re-importing the new `.apkg` updates existing cards in place — your review history stays intact, you don't get duplicates.

:::note
Signed in, 2anki remembers your cards under your account, so re-imports update in place with no duplicate prompt. Signed out, a re-upload after Notion changes its export format can create a fresh set, which you clear once. See [Update your deck, keep your reviews](/documentation/cards/duplicate-cards).
:::

For Notion pages where you want updates to flow automatically without re-uploading, use [Sync](/documentation/sync/how-it-works) instead.

### Why duplicates appear after restructuring toggles

The card ID is anchored to the Notion block ID of the toggle. Notion preserves that block ID for some edits and replaces it for others:

- **Editing the text inside a toggle** keeps the same block ID → re-import updates the existing card in place.
- **Cutting a toggle and pasting it elsewhere** assigns a new block ID → re-import creates a new card next to the old one.
- **Duplicating a toggle** (via right-click → Duplicate or ⌘D) assigns a new block ID to the copy → both cards appear after re-import.
- **Moving a toggle by drag** within the same page usually preserves the block ID; moving across pages does not.

If you re-import and see duplicate cards, the most likely cause is a cut-and-paste or duplicate-and-edit during the edit pass.

**Workflow that avoids the duplicates:** edit toggle text in place. Restructure the page before the first conversion if you can — once a deck is live in Anki, treat the toggle layout as the anchor and change the contents, not the positions.
