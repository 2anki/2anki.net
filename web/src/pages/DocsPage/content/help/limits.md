---
title: Limits and quotas
description: What's allowed on each plan, and how long your decks stick around.
---

2anki.net is free for the conversion features. The limits below keep the hosted service fast for everyone. If you self-host, you can change them — see [self-hosting](/documentation/reference/self-hosting).

## Cards per month

| Plan                    | Cards per month   |
| ----------------------- | ----------------- |
| Anonymous (no account)  | 21 per conversion |
| Free account            | 100 per month     |
| Subscription / Lifetime | Unlimited         |

The free monthly limit counts cards across **every** conversion path — file uploads, `.zip`, Notion, all of them — not just Notion. The counter resets at the start of each calendar month.

Without an account, each conversion is capped at 21 cards. Sign up for a free account to get the full 100 cards per month.

## File size

| Plan                    | Max upload size    |
| ----------------------- | ------------------ |
| Free                    | 100 MB per request |
| Subscription / Lifetime | ~10 GB per request |

Free covers anonymous and signed-in users without a paid plan.

## PDF pages

| Plan                    | Max pages per PDF |
| ----------------------- | ----------------- |
| Free                    | 100               |
| Subscription / Lifetime | No fixed cap      |

PDFs over the free limit return: _PDF exceeds maximum page limit of 100 for free and anonymous users._

## AI-generated flashcards

The **Use Claude AI** card option is a Subscription / Lifetime feature. Free accounts see the toggle but the conversion falls back to the standard parser.

## Chat

The Chat study assistant is part of every paid plan — Subscription, Day Pass, and Lifetime. On a free account, past conversations stay readable and decks you already made stay downloadable; sending messages requires a plan.

|                | Free                         | Paid plans         |
| -------------- | ---------------------------- | ------------------ |
| Messages       | — (past chats stay readable) | Unlimited          |
| Message length | —                            | 100 000 characters |

## Mind maps

| Plan                 | Saved maps | Nodes per map |
| -------------------- | ---------- | ------------- |
| Free account         | 3          | 50            |
| Subscription         | 25         | 250           |
| Lifetime / Auto Sync | Unlimited  | Unlimited     |

Deleting a map frees a slot right away — there's no monthly window. See [Mind maps](/documentation/cards/mind-maps).

## Photo to deck

Free accounts can turn 5 photos into decks per month. Subscription and Lifetime remove the cap. See [Photo to deck](/documentation/cards/photo-to-deck).

## PDF print export

Free accounts get 1 PDF export per month. Subscription and Lifetime are unlimited. See [Print or export to PDF](/documentation/reference/print-export).

## Image occlusion

Free accounts can build up to 3 images per deck. Subscription and Lifetime remove the cap. See [Image occlusion](/documentation/cards/image-occlusion).

## Storage

What "storage" means depends on which path you used.

### File upload (no Claude AI)

Your file lives on disk only long enough to build the deck. The `.apkg` is sent straight back as the response — we don't keep a copy. The temporary working files are wiped after **two hours**.

**Plan:** any (anonymous, Free account, Subscription, Lifetime — same window for all).

### Notion convert and Claude AI uploads

These paths build your deck in the background and store the `.apkg` in our bucket so you can re-download it from **My Decks** and so [sync](/documentation/sync/how-it-works) has something to update.

| Plan               | How long your decks stay in the bucket               |
| ------------------ | ---------------------------------------------------- |
| Free account       | Removed in the next daily cleanup (within 24 hours). |
| Subscription       | Kept for as long as your subscription is active.     |
| Lifetime (Patreon) | Kept indefinitely.                                   |

If your subscription lapses, your stored decks are removed in the next daily cleanup — re-convert and they come back. You can also delete a deck yourself from **My Decks** at any time.

## Free vs paid

Free covers the conversion paths most people need: drag in a file, get a deck back. The paid plans add AI-generated flashcards, larger uploads, longer storage, and Notion sync.

| Capability                                       | Free               | Subscription | Lifetime   |
| ------------------------------------------------ | ------------------ | ------------ | ---------- |
| Cards per month                                  | 100 (21 anonymous) | Unlimited    | Unlimited  |
| Anonymous file upload                            | ✓                  | ✓            | ✓          |
| Account features (history, favorites, templates) | sign-in required   | ✓            | ✓          |
| AI-generated flashcards (Claude)                 | —                  | ✓            | ✓          |
| Chat (study assistant)                           | —                  | Unlimited    | Unlimited  |
| Long-term deck storage                           | 24 h               | active sub   | indefinite |
| Auto Sync (Notion → Anki)                        | —                  | by request   | ✓          |

Auto Sync isn't sold as a plan — it's included with Lifetime, and on any subscription you can email [support@2anki.net](mailto:support@2anki.net) to have it switched on. See the [pricing page](/pricing) for the current plan list. Privacy details — what we read, what we don't — are on the [privacy policy](/documentation/reference/privacy).

If something looks wrong, [contact us](/documentation/help/contact).
