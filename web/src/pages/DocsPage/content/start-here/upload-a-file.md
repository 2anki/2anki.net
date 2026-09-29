---
title: Upload a file instead
description: For PDFs, slides, spreadsheets, or a Notion HTML export.
---

<figure>
  <iframe
    src="https://www.youtube.com/embed/y3Fcx-WGWnA"
    title="2anki — make Anki cards from your Notion toggles in 30 seconds"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen
    width="100%"
    style="aspect-ratio: 16 / 9; border: 0; border-radius: var(--radius-md);"
  ></iframe>
</figure>

Upload works without an account. You drop in a file, 2anki builds the deck, and you download an `.apkg`. Good for one-off conversions or sources that don't live in Notion.

Without an account, each conversion is capped at 21 cards. Sign up for a free account to get 100 cards per month across every conversion path. See [Limits and quotas](/documentation/help/limits).

**Plan:** Free (anonymous, no sign-in needed)

## When to use upload instead of Connect Notion

Upload when:

- The source is a PDF, slide deck, spreadsheet, CSV, or Markdown file.
- You don't have a Notion workspace, or the page isn't in Notion.
- You want a fast one-shot conversion and don't need future edits to flow into the deck.

Use [Connect Notion](/documentation/start-here/connect-notion) when the source is a Notion page and you want the deck to update as you edit.

## Drop in a file

1. Go to [2anki.net/upload](https://2anki.net/upload).
2. Drag your file onto the drop area, or click to pick one.
3. Open the settings panel if you want to change card options. Defaults are tuned for first-time use — see [Card options](/documentation/cards/card-options) for what each one does.
4. Click **Convert**. When it finishes, click **Download** to grab the `.apkg`.
5. Open the file in Anki — see [Open your deck in Anki](/documentation/start-here/open-in-anki).

## Upload from Dropbox or Google Drive

If your file lives in cloud storage, you don't have to download it first.

- **Dropbox** — click **Choose from Dropbox** on the upload screen, sign in once, and pick the file. The chooser supports the same formats as the regular upload.
- **Google Drive** — click **Choose from Google Drive**. You can pick any file 2anki accepts, plus native Google Docs, Sheets, and Slides. Native Google files are converted to a bulleted outline first — see [Common problems](/documentation/help/common-problems#my-google-doc-converted-to-0-cards) for the shape that produces cards.

Both buttons are visible only when the integration is configured for the page you're on. If you don't see them, drag the file in from your computer instead.

:::tip
Toggle lists make the cleanest cards. If your source is plain prose, the conversion will still work, but you'll get better results from a structure where each card is one toggle, one bullet pair, or one row.
:::

## Supported types

The full table of formats and limits is on [File formats](/documentation/reference/file-formats). Short version:

- **Notion HTML export** (`.zip`) — the `.zip` Notion gives you when you export with "HTML" + "Include subpages".
- **HTML** — a single `.html` file or a folder of them.
- **Markdown** — `.md`, including Obsidian vaults.
- **CSV / XLSX** — one row per card.
- **PDF** — front/back per page pair, or AI-generated questions on paid.
- **PPT / PPTX** — one card per slide: the slide title is the front; the bullets, slide image, and speaker notes are the back. A deck with no slide text at all keeps the page-pair layout.

Drop the wrong format and 2anki tells you. The error message names the supported types so you don't have to guess.

## What happens to your file

We need the file long enough to convert it. After that:

- **Anonymous and Free account file uploads** — the temporary working files are wiped within two hours. The `.apkg` is sent straight back as the response, so we don't keep a copy.
- **Claude AI uploads and Notion conversions** are stored in your account so you can re-download from **My Decks**. Free accounts: removed within 24 hours. Subscription: kept while your sub is active. Lifetime: kept indefinitely.
- We don't read your content for any reason other than building your deck. We don't train models on it.

The full story is on the [privacy policy](/documentation/reference/privacy). The hard numbers are on [Limits and quotas](/documentation/help/limits).
