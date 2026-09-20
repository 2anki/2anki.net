---
title: Use 2anki inside Claude or ChatGPT
description: Connect the 2anki MCP server and build Anki decks straight from a conversation.
---

2anki runs as an MCP connector, so an AI assistant can build your Anki decks for you. Paste lecture notes into a conversation, ask for flashcards, and get a download link for a ready `.apkg` — without leaving the chat.

**The connector is open to every signed-in account.** Sign in at [2anki.net](https://2anki.net/), add the connector, and approve the consent screen once. Free accounts keep their monthly card limit; paid plans have no monthly card limit, and photos draw on your AI credits.

## Connect to Claude

<ol class="steps">
<li>

**Open connector settings.** In Claude (web or desktop), go to **Settings → Connectors** and choose **Add custom connector**.

</li>
<li>

**Add the 2anki server.** Enter `https://2anki.net/mcp` as the URL and confirm.

</li>
<li>

**Sign in.** Claude opens a 2anki sign-in and consent screen. Approve it once; the connection persists across conversations.

</li>
<li>

**Use it.** In any conversation, ask Claude to make flashcards — "turn these notes into an Anki deck". Claude calls 2anki and replies with a download link for the `.apkg`.

</li>
</ol>

## Connect to ChatGPT

<ol class="steps">
<li>

**Enable developer mode.** In ChatGPT, go to **Settings → Apps & Connectors → Advanced settings** and turn on **Developer mode** (requires a paid ChatGPT plan).

</li>
<li>

**Create the connector.** Under **Apps & Connectors**, choose **Create**, enter `https://2anki.net/mcp` as the MCP server URL, and pick **OAuth** as the authentication method.

</li>
<li>

**Sign in.** ChatGPT opens the 2anki sign-in and consent screen. Approve it once.

</li>
<li>

**Use it.** Start a message, add the 2anki connector from the composer's tools menu, and ask for a deck.

</li>
</ol>

## What the assistant can do

- Turn pasted text, notes, or a document summary into a finished deck with a download link
- Convert a photo of handwritten notes, a textbook page, or a slide into cards
- Choose note types (Basic, reversed, cloze) and card options, including subdecks
- Preview a deck's cards before you download
- List the decks you've already created

Free accounts keep their normal monthly card limit; paid plans have no monthly card limit, and photos draw on your AI credits — the same [plans and limits](/documentation/reference/plans) as the web app.

## If something fails

- If the sign-in loops or the assistant reports it can't authenticate, make sure you're signed in at [2anki.net](https://2anki.net/), then add the connector again.
- If the connection stops working, remove the connector and add it again to re-run the sign-in.
- Anything else: email [support@2anki.net](mailto:support@2anki.net).
