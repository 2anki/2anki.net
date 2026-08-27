---
title: How sync works
description: Edit a Notion page, get the updated deck — without re-uploading.
---

Sync watches the Notion pages you've subscribed and keeps a matching deck up to date in Anki. When you edit a page in Notion, the next sync run picks up the changes and updates the deck — same deck name, same card IDs, no re-import drama.

## What sync does

- Watches the Notion pages you mark for sync.
- Keeps one Anki deck per Notion page, with subdecks for nested child pages.
- Updates existing cards in place when their Notion source changes — your review history stays intact.
- Adds new cards when you add toggles in Notion. Removes cards when you delete the source.

## Setting up sync on a page

You'll do this from the **Auto Sync** area on 2anki.net:

1. Connect Notion (if you haven't already — see [Connect Notion in 5 minutes](/documentation/start-here/connect-notion)).
2. Open the **Auto Sync** dashboard and pick a Notion page to subscribe.
3. Confirm the deck name. The deck is created the first time sync runs.
4. Open Anki on the device that will hold the synced deck and let 2anki connect through AnkiConnect.

## How updates flow

```
Notion page  →  2anki sync   →  AnkiConnect (your Anki)
   edit            (poll)            update card
```

A background job polls your subscribed pages, diffs them against what's already synced, and pushes only the changes to Anki. Reviews and scheduling state are preserved because card IDs are stable across runs.

## Getting Auto Sync access

Auto Sync isn't on the pricing page right now. On any subscription, email [support@2anki.net](mailto:support@2anki.net) and we'll switch it on so you can try it. Connect Notion, download deck, and file uploads stay free.

See the [pricing page](/pricing) for current plans, and [When sync gets stuck](/documentation/sync/troubleshooting) if a sync isn't running.
