---
title: Common problems
description: The errors users actually hit, with the fix on the same page.
---

If you saw an error and want the fix, find the heading below that matches what you saw. If your problem isn't here, [contact us](/documentation/help/contact) or [report a bug](/documentation/help/bug-report).

## Is 2anki down?

Check the [status page](/status) — it shows whether the API, database, and Notion connection are healthy. If the page itself is unreachable, the server is likely down; check the community on Reddit for updates.

## "Please select a file to upload."

**What you saw.** A red error appears the moment you submit, before anything uploads.

**Why it happened.** The form was sent without a file attached.

**How to fix it.** Drag a file onto the upload area or click it to pick one from your computer. See [supported formats](/documentation/reference/file-formats).

## "The uploaded file appears to be invalid. Please try again."

**What you saw.** The upload starts but fails immediately.

**Why it happened.** The browser sent a file with no name. This usually happens when an extension or background process intercepts the upload.

**How to fix it.** Try a different browser, or disable extensions that touch downloads or uploads (privacy tools, "save-to-cloud" extensions). Then re-attach the file.

## "[file] appears to be empty. Please re-export your file and try again."

**What you saw.** The upload returns this message with the name of your file.

**Why it happened.** The file is 0 bytes — usually because an export failed silently or the file copied while the source app was still writing.

**How to fix it.** Re-export from the source (Notion, Obsidian, Excel, etc.). Confirm the file has content by opening it locally before uploading.

## "[file] is already an Anki deck. 2anki converts source files like Notion HTML exports, not existing decks."

**What you saw.** You tried to upload an `.apkg`.

**Why it happened.** 2anki creates Anki decks; it doesn't read them. Uploading an existing `.apkg` isn't a flow we support.

**How to fix it.** Upload the source you used to make the deck (HTML export, Markdown, PDF, CSV) — not the deck itself. To open an `.apkg` you already have, see [Open your deck in Anki](/documentation/start-here/open-in-anki). To print or share it as a PDF, use [Print Decks](/print).

## "PDF exceeds maximum page limit of 100 for free and anonymous users."

**What you saw.** A PDF upload fails right after you submit it.

**Why it happened.** Free accounts cap PDFs at 100 pages so the conversion stays fast and free.

**How to fix it.** Split the PDF into smaller files (every PDF reader has a "split" option), or [subscribe](/pricing) to remove the cap. See [Limits and quotas](/documentation/help/limits) for the full list.

## "This PDF is password-protected."

**What you saw.** You uploaded a PDF and the upload area switched to a password input with the file name shown above it.

**Why it happened.** The PDF was created with an open password — Anki can't read it, and neither can 2anki, until you unlock it.

**How to fix it.** Type the password into the input and click **Unlock**. The file is decrypted in memory, converted, and the password is discarded — we don't store it. If you don't know the password, ask whoever shared the PDF, or remove the password in your PDF reader (most readers have a **File → Save as → Properties → Security → No Security** option) and re-upload.

If you click anywhere else and the input goes away, drop the file in again — the password prompt comes back.

## Notion Markdown export produces 0 cards

**What you saw.** You exported a Notion page as Markdown and uploaded it, but got 0 cards — even though the page has toggles.

**Why it happened.** Notion's Markdown export flattens toggle blocks into plain text. The toggles that 2anki turns into flashcards are stripped from the file before it reaches the converter.

**How to fix it.** Re-export the same page from Notion as **HTML** instead of Markdown. The toggles are preserved in HTML and convert correctly.

## "Could not create a deck using your file and rules."

**What you saw.** The upload finishes but produces no deck.

**Why it happened.** 2anki couldn't find anything that looks like a flashcard. By default it looks for toggle blocks. When there are no toggles, 2anki now falls back to the document's own structure — headings with their content, bulleted or numbered lists, two-column tables, and question-and-answer text — and ships the best match if it's good enough. This message means none of those cleared the quality bar either, so no deck was built rather than a low-quality one.

**How to fix it.** Give the page a clearer structure: a heading followed by its explanation, a two-column table of terms and definitions, or lines marked `Q:` and `A:`. Then convert again. You can also open [Card options](/documentation/cards/card-options) and turn on the option that matches your source — for Markdown bullet hierarchies, **Markdown Nested Bullet Points** — or [contact us](/documentation/help/contact) with an example.

## "Claude couldn't find any content to turn into flashcards in this Notion page."

**What you saw.** You enabled Claude AI generation and the conversion failed with this message.

**Why it happened.** The page Claude received was empty or only contained layout elements (buttons, placeholders) — nothing it could turn into a question.

**How to fix it.** Add headings with explanations, toggle lists, or question-and-answer text to the page, then convert again.

## A Notion page won't show up in the picker

**What you saw.** You connected Notion but a page you want to convert isn't listed.

**Why it happened.** Notion only shares pages you've explicitly given the 2anki integration access to.

**How to fix it.** Open the page in Notion → **Share** → **Add connections** → pick **2anki**. Then refresh the picker.

## My Google Doc converted to 0 cards

**What you saw.** You picked a Doc from Google Drive, the conversion finished, and the deck has no cards.

**Why it happened.** 2anki reads Docs as bulleted outlines. A top-level bullet becomes the question; bullets indented under it become the answer. Docs written as flowing paragraphs, or with bullets that all sit at the same indent level, don't give us a question-and-answer shape to turn into cards. Headings followed by paragraphs work too, but only if every heading has a paragraph under it.

**How to fix it.** Open your Doc, restructure the content as bullets where each question is at the top level and the answer is indented one step under it, then pick the Doc again. The full bullet example is on the [file formats](/documentation/reference/file-formats) page.

## Some images are missing from my deck

**What you saw.** Cards show up but pictures are broken.

**Why it happened.** You probably uploaded a single `.html` file instead of the full `.zip`. Notion's HTML export references images in an `assets/` folder, and uploading just the `.html` leaves the images behind.

**How to fix it.** Upload the original `.zip` instead. If your browser auto-extracts zips, turn that off — in Safari, **Preferences → General**, uncheck **Open "safe" files after downloading**.
