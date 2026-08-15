---
title: AI flashcard generation
description: When 2anki should write the cards for you — Claude for any PDF, and a PDF-only question generator that also uses Claude.
---

Two card options send your source to an AI model instead of running the normal toggle/bullet parser. Use them when your source isn't already shaped like flashcards — long-form PDFs, lecture transcripts, dense study material — and you want the model to pull the question-answer pairs out for you.

**Plan:** Subscription or Lifetime. Free accounts see the toggles but the conversion falls back to the standard parser.

## When to use this

- Your source is a PDF that's all prose — a textbook chapter, an article, lecture notes — and there are no toggles or bullets to convert.
- You've tried the standard parser and it produced too few cards, or none.
- You have a specific angle you want the cards to take ("focus on dates and names", "use clinical vignettes", "skip the introduction").

If your source is already structured — Notion toggles, Obsidian bullets, a spreadsheet with question and answer columns — the standard parser will be faster and more accurate. Skip AI for those.

## Generate Flashcards with Claude AI

The general-purpose option. Sends your content to Anthropic's Claude and uses the response as your deck.

1. On the upload screen, open the settings panel.
2. Switch **Generate Flashcards with Claude AI** on.
3. (Optional) Open **User instructions** and write a sentence or two about the kind of cards you want.
4. Upload your file. The job runs in the background — you can leave the page and come back to **My Decks** to download.

The result is a normal `.apkg`. Cards arrive pre-tagged with 1–3 topic tags drawn from the content — you can filter or browse by tag in Anki's tag browser the moment the deck opens. You can re-download the deck from **My Decks** for as long as your plan keeps it (see [Limits and quotas](/documentation/help/limits) for storage windows).

**Card volume — Comprehensive AI mode.** Subscription and Lifetime plans get a **Comprehensive AI mode** toggle on the Card options page under **PDF & AI**. Turn it on to target 200–500 cards per upload for chapter-scale material: the converter splits long uploads into chunks, runs them in parallel, and follows up on the thinnest chunks with a top-up pass so a 50-page chapter lands as one full deck instead of a sparse sample. The total is capped at 500 to keep the deck reviewable. Conversions take longer than the default mode. Leave the toggle off if you want the faster default volume. Free accounts don't see the toggle — the standard AI conversion runs at the default volume.

### Writing good user instructions

The model does better with a clear angle than with a long brief. One or two sentences is plenty.

Useful instructions:

- "Focus on USMLE Step 1 high-yield. Skip background paragraphs."
- "Make every card a clinical vignette ending in a question."
- "Use the exact wording from the source on the back."
- "Mostly cloze deletions, with a few multiple-choice for the key facts."

Skip instructions like "make great flashcards" or "explain everything" — the model already tries to do that.

## Generate Questions from Single PDF File Uploads

A narrower option, scoped to single PDFs. Sends the PDF to Anthropic Claude to generate question-and-answer pairs page by page.

1. Open the settings panel before uploading.
2. Switch **Generate Questions from Single PDF File Uploads** on.
3. Upload a single PDF. ZIPs and Markdown don't use this path.

Use this when you want question generation tuned to a specific page-by-page rhythm. The output runs through the same packaging step, so the resulting `.apkg` opens in Anki just like any other.

## Storage and privacy

AI conversions take longer than the standard parser — the deck builds in the background and is stored in your account so you can re-download it. Plan windows:

| Plan         | How long the AI deck is kept           |
| ------------ | -------------------------------------- |
| Free         | Falls back to standard parser (no AI)  |
| Subscription | Kept while your subscription is active |
| Lifetime     | Kept indefinitely                      |

We send the content to the model only to build your deck. We don't train on it. Full details on the [privacy policy](/documentation/reference/privacy).

## Common mistakes

- **Empty PDF.** If the model can't find anything to turn into a card, the conversion fails with _Claude couldn't find any content to turn into flashcards in this Notion page_ (the same message fires for PDFs). Check that the PDF has selectable text — scanned images won't work without OCR first.
- **Conflicting options.** Turning on both **Generate Flashcards with Claude AI** and the standard toggle options doesn't double the cards. Claude takes over for the whole document.
- **Cost expectation.** Each AI conversion uses model credits on our end. We don't pass per-card pricing through, but very large PDFs may take several minutes to finish.

## Related

- [Card options](/documentation/cards/card-options) — the rest of the toggles
- [File formats](/documentation/reference/file-formats) — what PDFs we accept
- [Limits and quotas](/documentation/help/limits) — Claude AI is a paid option
