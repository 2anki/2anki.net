---
title: Import an Anki deck into Notion
description: Turn an .apkg into Notion toggle pages — free up to 1,000 cards per import.
---

The reverse of everything else 2anki does. You upload an existing `.apkg` and we recreate the cards as toggles inside a Notion page. Useful for moving an old deck back into notes you can edit, or for giving a study deck to someone who works in Notion instead of Anki.

**Plan:** Free up to 1,000 cards per import. Subscription and Lifetime raise the cap to 10,000 cards per import.

## When to use this

- You have an Anki deck and want the cards as Notion content you can rewrite.
- You're handing a study set to a teammate or classmate who already lives in Notion.
- You want to re-do a deck — fix typos, rewrite questions, change templates — and then push it back out through the normal 2anki flow.

This is a one-time copy, not a live sync. Edits in Notion after the import don't flow back into the original `.apkg`. For ongoing sync, see [How sync works](/documentation/sync/how-it-works).

## Run the import

1. Open [2anki.net/import](https://2anki.net/import). If you haven't connected Notion yet, you'll be sent to do that first — see [Connect Notion](/documentation/start-here/connect-notion).
2. Drop your `.apkg` onto the upload area, or click to pick one. Only `.apkg` files work here.
3. Pick a destination:
   - **Quick import** creates a new "2anki Imports" page in your workspace.
   - **Choose a page** lets you nest the import under an existing top-level page. Only pages you've shared with the 2anki integration show up.
4. Click **Import to selected page** (or **Quick import**). The progress bar shows cards as they land.
5. When it finishes, click **Open in Notion** to jump straight to the new page.

:::tip
Cards become toggles — the front is the toggle summary, the back is what's inside. Cloze cards keep their `{{c1::...}}` syntax so you can re-import them later.
:::

## Common mistakes

- **Wrong file type.** The page only accepts `.apkg`. If you have a `.colpkg` (full collection backup), open it in Anki first and export the deck you want as `.apkg`.
- **Deck over the free limit.** Free hits a hard stop at 1,000 cards per import. Split the deck in Anki (right-click → **Export** with a filtered subset) or [upgrade](/pricing) to raise the cap to 10,000 cards per import.
- **Page not in the picker.** The destination picker only shows pages where the 2anki integration has access. Open the page in Notion → **Share** → **Add connections** → pick **2anki**.

## Related

- [Connect Notion](/documentation/start-here/connect-notion) — the workspace connection this flow uses
- [Limits and quotas](/documentation/help/limits) — what each plan includes
- [Pricing](/pricing) — raise the import cap to 10,000 cards
