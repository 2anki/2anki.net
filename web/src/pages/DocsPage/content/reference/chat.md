---
title: Chat — study assistant
description: Paste notes or attach a file, ask for cards, work through a concept. Conversations are saved.
---

Chat is a study assistant built on Claude. Paste your notes or attach a file, then ask it to make cards, explain something, or work through a topic by going back and forth. Open it at [2anki.net/chat](https://2anki.net/chat). Sign-in required.

**Plan:** Part of every paid plan — Subscription, Day Pass, and Lifetime. On a free account you can read your past conversations and download decks you already made, but sending messages requires a plan.

## When to use this

- Your source isn't structured enough for the standard parser and you want to turn it into cards interactively.
- A standard upload returned too few cards (or none) and you want a second pass with a different angle.
- You want to think through a concept before making cards — explanation first, cards second.
- You're stuck on a specific upload error and want help working out why a file isn't converting.

Chat handles files directly now — attach a PDF, an image, a Notion export, or a document and it works from the content. For bulk conversion, or a Notion page whose toggles already map cleanly to cards, the standard [upload flow](/documentation/start-here/upload-a-file) is still faster and deterministic. Reach for chat when you want to shape the cards interactively.

## Start a conversation

1. Open [2anki.net/chat](https://2anki.net/chat).
2. Either click one of the starter chips ("Make 10 cards from notes I'll paste", "Explain a concept, then make cards", "Turn this into cloze cards: [paste]") or type your own prompt.
3. Send. The assistant replies, streaming the response as it generates.
4. When the assistant proposes cards, you'll see them inline as front/back previews. You can keep iterating or download an `.apkg` from there.

Past conversations stay in the sidebar on the left. Click any to reopen. You can rename a conversation or delete it from the same row.

## Attach files

Attach study material straight to a message — you don't need the upload page for a single file. Click the attach button, pick your files, and send with or without a prompt. With no prompt, chat makes cards from what you attached.

What you can attach:

- PDFs and images (PNG, JPEG, GIF, WebP) go to the model as-is — it reads the pages or the picture directly.
- Notion exports (.zip), Word documents (.docx), Markdown (.md), and plain text (.txt) are read into text before the model sees them.

Limits per message:

- Up to 5 files.
- 10 MB per file.
- 25 MB across all files.

Go over any limit and the message is rejected before it sends, with a note saying which file or total to trim.

**Regenerating a turn.** Regenerate reuses the PDF or image you attached to that turn, so you don't re-upload to try a different angle. Attached PDFs and images are kept for 90 days, then deleted. Regenerate an older turn after that and chat asks you to attach the file again.

## Writing useful prompts

A clear prompt beats a long one. Three patterns that work:

**Paste your notes, then ask.** "Here are my notes on the citric acid cycle. Make 12 cards focused on enzymes and their products." — paste the notes after.

**Ask for explanation first.** "Explain why beta-blockers work in heart failure. Then make 5 cards from your explanation." — useful when you're not sure what the right questions are yet.

**Hand off a stuck upload.** If the upload page told you 0 cards were created, click **Open in chat** from the error. The conversation prefills with the filename and you can describe what's in the file.

The same advice that works for [AI flashcards](/documentation/cards/ai-flashcards) works here — be specific about what to focus on, what to skip, and what tone you want.

## Conversation limits

|                | Free                              | Paid plans         |
| -------------- | --------------------------------- | ------------------ |
| Messages       | — (reading past chats stays free) | Unlimited          |
| Message length | —                                 | 100 000 characters |

See [Limits and quotas](/documentation/help/limits) for the full plan table.

## What we store

- The text of every message in every conversation (so you can reopen them). A Notion export, document, Markdown, or plain-text file you attach becomes part of that message text.
- Any PDF or image you attach, kept for 90 days so you can regenerate the turn, then deleted.
- The user account that owns the conversation.
- Nothing else — we don't run analytics on what you ask, and we don't train models on your conversations.

Delete a conversation any time using the trash icon in the sidebar. Deletion is immediate and final — the conversation can't be restored. For the full data picture, see the [privacy policy](/documentation/reference/privacy).

## Common mistakes

- **Pasting more than the message limit.** Each message caps at 100 000 characters. Split a longer source across multiple messages.
- **Attaching a file type chat can't take.** Chat accepts PDF, images, Notion .zip exports, .docx, .md, and .txt. Export or convert anything else to one of those first.
- **Treating Chat as the only path.** For source that already has structure, the standard parser is faster, deterministic, and free.

## Related

- [AI flashcards](/documentation/cards/ai-flashcards) — automatic Claude generation as part of upload, for files instead of pasted text
- [Limits and quotas](/documentation/help/limits) — message quotas by plan
- [Privacy policy](/documentation/reference/privacy) — what we store, what we don't
