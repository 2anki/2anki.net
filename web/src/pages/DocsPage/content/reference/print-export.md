---
title: Print or export to PDF
description: Turn an .apkg into a printable PDF — for paper study, sharing, or a backup.
---

The print tool at [2anki.net/print](https://2anki.net/print) takes an existing Anki deck (`.apkg`) and turns it into a PDF you can print or hand to someone. Useful for paper study, for sharing with a classmate who doesn't use Anki, or for keeping a hard copy of a deck.

**Plan:** Free logged-in accounts get 1 PDF export per month. Subscription and Lifetime are unlimited. Anonymous users need to log in first — the export prompts you to sign in.

## When to use this

- You want to review on paper without screen time.
- You're sharing a study set with someone who doesn't use Anki.
- You want a printed backup of an important deck.

This tool reads a deck, not your source. If you don't have an `.apkg` yet, [upload a file](/documentation/start-here/upload-a-file) first to get one, then come back here.

## Export a deck to PDF

1. Open [2anki.net/print](https://2anki.net/print).
2. Drag your `.apkg` onto the drop area, or click to pick one.
3. Open the layout panel and adjust the look:
   - **Paper size** — A4, Letter, or Legal.
   - **Orientation** — Portrait or Landscape.
   - **Margins** — Narrow, Normal, or Wide.
   - **Background colour** — pick a colour if your cards use a dark theme and you want a light print, or vice versa.
4. The PDF downloads as soon as it's ready. The filename matches the deck (`MyDeck.apkg` → `MyDeck.pdf`).
5. Open the PDF and print or share it.

## What's in the PDF

The PDF shows the cards in deck order. Each card renders the front and the back stacked on the page, using the same HTML and CSS Anki would. Media (images, audio) renders as the image — audio is silent in print, since paper doesn't play sound.

Card templates with very complex CSS may not render exactly the same as in Anki. If a card looks off, try one of our [starter templates](/documentation/cards/templates) for the print run — they're designed to render cleanly on paper.

## Privacy

Uploaded `.apkg` files are removed within **2 hours** of the export. The PDF is sent back as the response and not kept on our servers. Nothing about your cards is read for any reason other than producing the PDF.

## Common mistakes

- **Wrong file type.** The print tool only accepts `.apkg`. If your source is a Notion export, a Markdown file, or a PDF, go to the [upload page](/documentation/start-here/upload-a-file) first to make the `.apkg`, then come back here.
- **Very large decks.** Free print covers decks up to 1000 cards. Bigger decks return "PDF export supports up to 1000 cards." Upgrade for unlimited, or split the deck in Anki (use a filtered deck or export a subdeck) and run each through the print tool.
- **Free monthly export used up.** A free account gets 1 PDF export a month. Once it's used, the export returns "Your free PDF for this month has been used." Wait for the reset, or subscribe for unlimited exports.
- **Not signed in.** Anonymous users can't export. Log in first, then run the export. See [pricing](/pricing) for plans, or use a short [Day or Week Pass](/documentation/reference/plans) if you need it once.

## Related

- [Note types and templates](/documentation/cards/templates) — templates that print well
- [Limits and quotas](/documentation/help/limits) — plans and storage windows
- [Plans and passes](/documentation/reference/plans) — one-time access for a single export
