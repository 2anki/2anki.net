---
title: What is a deck?
description: How 2anki turns a Notion page or database into an Anki deck, and how to change which blocks create one.
---

A **deck** is a bag of flashcards in Anki. Every card you study lives in exactly one deck. When 2anki reads a Notion page, it has to decide where one deck ends and the next one begins — that's a _deck boundary_.

**Plan:** Free

## The default rule

By default, two Notion block types create a deck boundary:

- **page** — every Notion page is its own deck.
- **database** — every Notion database is its own deck.

So if you point 2anki at a page called _Pharmacology_ that contains a sub-page _Antibiotics_, you'll get a deck named _Pharmacology_ and a sub-deck named _Antibiotics_. Cards under each heading or toggle end up in the matching deck.

On the free plan, 2anki reads the first 200 blocks of a page. Longer pages convert partially, and the deck's row on My decks says how many blocks were converted. Paid plans convert the whole page.

## Change which blocks create a deck

Rules apply to **one Notion page** at a time. To change the deck boundaries:

1. Go to [2anki.net/notion](https://2anki.net/notion) and find the page.
2. Click the **Settings** (gear) icon next to it.
3. Under **Decks and sub-decks → Deck boundaries**, toggle the block types.

The supported boundary types are `page` and `database`. Pick at least one — if you deselect both, 2anki uses the default to avoid an empty deck.

| Selection                     | What you get                                                        |
| ----------------------------- | ------------------------------------------------------------------- |
| `page` + `database` (default) | Pages and databases each become a deck                              |
| `page` only                   | Only pages become decks; databases get inlined into the parent deck |
| `database` only               | Only databases become decks; child pages get inlined                |

## Sub-decks vs deck boundaries

A **deck boundary** starts a brand-new top-level deck. A **sub-deck** nests inside an existing deck. They're separate settings on the same page.

If you want a Notion sub-page to become a _sub-deck_ instead of a separate top-level deck, leave `page` selected as a deck boundary and add `child_page` (or whichever block) to **Sub-decks** below.

See [Parser rules](/documentation/cards/parser-rules) for the full breakdown of every rule group, and [Notion blocks we support](/documentation/cards/notion-blocks) for what each block does on the card itself.
