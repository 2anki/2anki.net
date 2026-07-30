---
title: When sync gets stuck
description: Three things to try when your deck won't update.
---

Sync runs every five minutes in the background. Most of the time you don't notice it. When it does get stuck, it's almost always one of the three things below.

**Plan:** Auto Sync subscribers and Lifetime (sync is gated by the same access as [How sync works](/documentation/sync/how-it-works))

## Page didn't sync

You edited a Notion page. The deck in Anki didn't update. Try, in order:

1. **Wait five minutes.** Sync polls on a five-minute cadence to stay inside Notion's free-tier rate limits. If you just edited, it might not have run yet.
2. **Open the Ankify dashboard.** Each subscribed page shows the last run time and any error from that run. If you see an error, it usually points right at the cause.
3. **Check the page is still shared with the 2anki integration.** Notion sometimes drops the connection after a workspace change. Open the page in Notion, click **Share → Add connections**, and re-add 2anki.
4. **Check Anki is open with AnkiConnect running.** Sync writes to Anki through AnkiConnect — if Anki isn't open on the device that holds the deck, the run completes on our side but the deck doesn't change.

If the dashboard shows runs are succeeding but the deck still isn't updating, it's almost always AnkiConnect. Restart Anki, then trigger a manual sync from the dashboard.

## I got a duplicate set of cards after re-importing

Anki doesn't warn you about duplicates. They just appear in the deck, so it's easy to miss them until you're reviewing. Sync remembers your cards under your account, so edits update your existing cards instead of adding copies. If a deck doubled during the July export bug, that's a one-time cleanup: clear the extra set once and it stays clear.

See [Update your deck, keep your reviews](/documentation/cards/duplicate-cards) for the cleanup steps and why this happens.

## I see two copies of the same cards

The copies to keep are the ones with your review history, usually the older ones. The duplicates are the fresh set, and they have 0 reviews.

1. In Anki, open **Browse** and select the deck.
2. Sort by the **Created** column to group the copies.
3. Delete the copies with 0 reviews with **Notes → Delete**. Keep the ones with your real review counts.

Future re-imports of the same source update the cards you kept, in place. Full walkthrough: [Update your deck, keep your reviews](/documentation/cards/duplicate-cards).

If both copies have review history you care about, [contact us](/documentation/help/contact) before deleting either. We can sometimes merge.

## I revoked access by mistake

If you removed 2anki from your Notion workspace, sync stops running and the dashboard shows an authentication error. To restore:

1. Go to [2anki.net](https://2anki.net/) and sign in again with Notion.
2. Re-share the pages you want to sync — open each in Notion, click **Share → Add connections**, and pick 2anki.
3. Existing subscriptions resume on the next run. You don't need to re-subscribe.

Your card history isn't lost. The dashboard remembers which Notion pages mapped to which Anki decks.

## Still stuck?

If none of the above helped:

- Check [Common problems](/documentation/help/common-problems) for any error message you're seeing.
- [Contact us](/documentation/help/contact) — include the Notion page name, the Ankify run timestamp, and the error message from the dashboard.
