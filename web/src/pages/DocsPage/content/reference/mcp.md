---
title: MCP connector
description: The hosted 2anki MCP server — tools, limits, and how it authenticates.
---

2anki runs a hosted MCP (Model Context Protocol) server, so AI assistants can build Anki decks on your account. Connect it once and ask for flashcards from inside a conversation — the assistant calls 2anki and returns a download link for a ready `.apkg`.

**Server URL:** `https://2anki.net/mcp`

For step-by-step connection instructions for Claude and ChatGPT, see [Use 2anki inside Claude or ChatGPT](/documentation/start-here/use-in-claude). The connector is open to every signed-in account — no request needed.

## Tools

| Tool                | What it does                                                                     |
| ------------------- | -------------------------------------------------------------------------------- |
| `convert_to_deck`   | Turn text, Markdown, CSV/TSV, or a URL into a finished deck                      |
| `create_deck`       | Build a deck from structured cards — supports subdecks via a per-card deck field |
| `photo_to_deck`     | Turn a photo of notes, a textbook page, or a slide into cards                    |
| `get_deck_preview`  | Show a deck's cards before downloading                                           |
| `list_my_decks`     | List the decks on your account                                                   |
| `deck_capabilities` | Discover available note types and card options                                   |

## Authentication

The server uses OAuth 2.1. The first time an assistant connects, 2anki opens a sign-in and consent screen; approve it once and the connection persists. Revoke it any time by removing the connector in the assistant's settings.

## Limits

Conversions through MCP count against the same plan limits as the web app: free accounts have a monthly card limit and a photo quota; paid plans convert without limits. Individual requests are capped at 5 MB of text, 500 cards per deck, and 10 MB per photo.

## Feedback

Something the tools can't do? Email [support@2anki.net](mailto:support@2anki.net). Bugs go to [GitHub issues](https://github.com/2anki/server/issues).
