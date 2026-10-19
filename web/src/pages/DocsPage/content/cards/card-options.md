---
title: Card options
description: Every checkbox on the upload screen, what it does, and when to turn it on.
---

Card options change how 2anki turns your source into flashcards. Most are off-or-on toggles. Defaults are tuned so a fresh upload "just works" — touch them when you want a different shape of deck.

## How to set options

- **On the upload screen** — click the settings icon next to the upload area to see every option for that conversion.
- **In account settings** — `Settings → Card options` saves defaults that apply to every new upload. You can still override per upload.
- **Per Notion page** — when you convert through the Notion integration, options are saved against the page so the next sync uses the same shape.

## Deck shape

| Option          | Default              | What it does                                                                                                              |
| --------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Deck name       | —                    | Custom name for the downloaded `.apkg`. Leave empty to use the source's name.                                             |
| Font size       | 20                   | Base font size for card text, in pixels.                                                                                  |
| Text color      | Default              | Pick from a set of readable colors, or keep Default to follow Anki's theme so text stays legible in light and night mode. |
| Text alignment  | Default              | Force card text left, center, or right. Keep Default to leave the template's own alignment untouched.                     |
| Toggle mode     | Close nested toggles | Controls whether nested toggles render open or closed on the card back.                                                   |
| Page emoji      | Icon first           | Where the page emoji shows up in the deck title — first, last, or disabled.                                               |
| Basic note type | `n2a-basic`          | The Anki note type name 2anki uses for basic cards. Change it to plug your own template in.                               |
| Cloze note type | `n2a-cloze`          | Same, for cloze cards.                                                                                                    |
| Input note type | `n2a-input`          | Same, for typed-input cards.                                                                                              |

## Card content

| Option                                          | Default | What it does                                                                                                            |
| ----------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| Use All Toggle Lists                            | On      | Picks up toggles inside lists, callouts or columns, not just top-level ones. Off means only top-level toggles are used. |
| Use Plain Text for Back                         | Off     | Strips formatting from the back of cards so only the text content remains.                                              |
| Maximum One Toggle Per Card                     | On      | Keeps each card to a single top-level toggle. Nested toggles stay on the parent card's back, not as separate cards.     |
| Preserve Newlines in the Toggle Header and Body | On      | Keeps SHIFT-Enter line breaks inside toggles instead of collapsing them.                                                |
| Markdown Nested Bullet Points                   | On      | Reads Markdown bullet hierarchies (Obsidian-style) as front/back pairs.                                                 |
| Disable Indented Bullets                        | Off     | Stops indented bullets from each becoming their own card.                                                               |

A toggle nested inside another is answer text for its parent, so it stays on the parent card's back (shown open or collapsed by **Toggle mode**) rather than becoming its own card. To get a card per toggle, keep each one at the top level instead of nesting them, or turn on **Cherry-pick** and mark each toggle with 🍒. On an uploaded Notion export (not the Notion sync integration), a nested toggle whose title holds inline `code` can become its own cloze card with **Nested toggles with inline code become their own cards**, which needs **Cloze Deletion** on.

## Card types

| Option                       | Default | What it does                                                                                     |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| Cloze Deletion               | On      | Creates cloze cards from inline `code` snippets.                                                 |
| Treat Bold Text as Input     | Off     | Bold text is removed and turned into a typed-answer field. Good for fact recall.                 |
| Basic and Reversed           | Off     | Creates the front/back card and a reversed copy.                                                 |
| Just the Reversed Flashcards | Off     | Only creates the reversed card. Useful when the back is more useful as a prompt (e.g. an image). |

## Filtering

| Option                                                           | Default | What it does                                                                                                                        |
| ---------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Enable Cherry Picking Using 🍒 Emoji                             | Off     | Only creates cards from toggles that contain a 🍒 emoji. Useful for picking out a few cards from a long page.                       |
| Only Create Flashcards From Toggles That Don't Have The 🥑 Emoji | Off     | Skips toggles that contain a 🥑 emoji. Useful for marking parts of a page as not-yet-ready.                                         |
| Treat Strikethrough as Tags                                      | Off     | Treats strikethrough text as Anki tags. Strikethrough inside a toggle becomes a tag local to that card; outside, it's a global tag. |

## Links and formatting

| Option                                        | Default | What it does                                                                             |
| --------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| Add Notion Link                               | Off     | Adds a link to the Notion page where the toggle was created.                             |
| Remove Underlines                             | Off     | Drops underline formatting. Helps when Notion underlines clash with Anki's link styling. |
| Remove the MP3 Links Created From Audio Files | On      | Strips the auto-generated `.mp3` links left behind by some Notion exports.               |

## Code blocks

| Option     | Default | What it does                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code theme | GitHub  | Sets the syntax-highlighting colors for code in your cards. Choose GitHub, One Dark, Solarized, or Dracula. Each switches between a light and dark palette to match your Anki theme. Full coloring needs the Notion connection — HTML and ZIP uploads drop the language, so uploaded code keeps the themed container without per-token colors. |

## PDF and AI

| Option                                | Default | What it does                                                                                                                                      |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process PDF Files                     | On      | Converts PDFs found in ZIP uploads. Turn off to skip PDFs and speed up large archives.                                                            |
| Generate Flashcards with Claude AI    | Off     | Sends content to Anthropic Claude and uses its output as the deck. Paid.                                                                          |
| User instructions                     | —       | Free-form prompt sent to Claude when **Generate Flashcards with Claude AI** is on. Example: _"Focus on USMLE high-yield. Skip the introduction."_ |
| Convert Image Quiz HTML to Anki Cards | Off     | Uses OCR to pull image-and-answer pairs from HTML quizzes. Premium experimental.                                                                  |

## Media

| Option                | Default | What it does                                                                                                                                                                                                   |
| --------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Embed images in cards | On      | Pack image bytes into the deck so cards render offline. Turn off to keep the deck small — cards still reference the images by name, but the bytes don't ship. Use this when an upload is hitting the size cap. |

## Audio

Anki reads cards aloud with its on-device voice. No audio file is added to the deck — the voice plays at review time, and the language needs to be installed on the device.

| Option                | Default     | What it does                                                                                                                                                                                                                                                                           |
| --------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read cards aloud      | Off         | Detects the front language automatically. Japanese, Korean, and Chinese are detected; everything else reads in English.                                                                                                                                                                |
| Pick a voice yourself | Don't speak | Choose a language and which side Anki reads — front, back, or both. Applies to basic, input, and cloze cards. A pick here takes precedence over the automatic detection above. Languages: English (US), Spanish, French, German, Japanese, Mandarin (Simplified), Portuguese (Brazil). |

If the picked language has no installed voice on the Anki device, the audio stays silent.

Studying Japanese? See [Notion → Anki for Japanese](/documentation/cards/notion-to-anki-japanese) for how mined sentences, readings, and attached audio come across.

## Multiple choice

These only fire when **Enable MCQ** is on. See [Multiple choice questions](/documentation/cards/mcq) for the full guide.

| Option                     | Default     | What it does                                                                                                                     |
| -------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Enable MCQ                 | Off         | Detects multiple-choice toggles and produces interactive MCQ cards instead of basic ones.                                        |
| TTS for the question       | Don't speak | Read the question aloud. Languages: English (US), Spanish, French, German, Japanese, Mandarin (Simplified), Portuguese (Brazil). |
| TTS for the correct answer | Don't speak | Read the correct answer aloud. Same language list.                                                                               |
| TTS for extra              | Don't speak | Read the explanation aloud. Same language list.                                                                                  |

## Debugging

| Option                                          | Default | What it does                                                                                                          |
| ----------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| Share Files for Debugging When Conversion Fails | Off     | If a conversion fails, sends the file and error details to the 2anki team. Off by default to keep your notes private. |

## Internal option keys

The option keys 2anki uses internally (handy if you're filing a bug report): `add-notion-link`, `all`, `paragraph`, `cherry`, `avocado`, `tags`, `cloze`, `enable-input`, `basic-reversed`, `reversed`, `no-underline`, `max-one-toggle-per-card`, `remove-mp3-links`, `perserve-newlines`, `process-pdfs`, `markdown-nested-bullet-points`, `disable-indented-bullets`, `image-quiz-html-to-anki`, `embed-images`, `claude-ai-flashcards`, `share-files-for-debugging`, `mcq-enabled`, `mcq-tts-question`, `mcq-tts-correct-answer`, `mcq-tts-extra`, `tts-auto-detect`, `tts-manual-lang`, `tts-manual-side`, `font-size`, `toggle-mode`, `code-theme`, `page-emoji`, `basic_model_name`, `cloze_model_name`, `input_model_name`, `user-instructions`.
