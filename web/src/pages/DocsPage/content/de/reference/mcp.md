---
title: MCP-Connector
description: Der gehostete 2anki-MCP-Server — Tools, Limits und Anmeldung.
---

2anki betreibt einen gehosteten MCP-Server (Model Context Protocol), damit KI-Assistenten Anki-Decks auf deinem Konto bauen können. Einmal verbinden und mitten im Gespräch nach Karteikarten fragen — der Assistent ruft 2anki auf und liefert einen Download-Link für eine fertige `.apkg`.

**Server-URL:** `https://2anki.net/mcp`

Schritt-für-Schritt-Anleitungen für Claude und ChatGPT findest du unter [2anki in Claude oder ChatGPT nutzen](/documentation/start-here/use-in-claude). Der Connector steht jedem angemeldeten Konto offen — keine Freischaltung nötig.

## Tools

| Tool                | Was es macht                                                                     |
| ------------------- | -------------------------------------------------------------------------------- |
| `convert_to_deck`   | Text, Markdown, CSV/TSV oder eine URL in ein fertiges Deck verwandeln            |
| `create_deck`       | Ein Deck aus strukturierten Karten bauen — Subdecks über ein Deck-Feld pro Karte |
| `photo_to_deck`     | Ein Foto von Notizen, einer Buchseite oder einer Folie in Karten verwandeln      |
| `get_deck_preview`  | Die Karten eines Decks vor dem Download anzeigen                                 |
| `list_my_decks`     | Die Decks auf deinem Konto auflisten                                             |
| `deck_capabilities` | Verfügbare Notiztypen und Karten-Optionen entdecken                              |

## Anmeldung

Der Server nutzt OAuth 2.1. Beim ersten Verbinden öffnet 2anki eine Anmelde- und Zustimmungsseite; einmal bestätigen, und die Verbindung bleibt bestehen. Du kannst sie jederzeit widerrufen, indem du den Connector in den Einstellungen des Assistenten entfernst.

## Limits

Konvertierungen über MCP zählen gegen dieselben Plan-Limits wie die Web-App: kostenlose Konten haben ein monatliches Kartenlimit und ein Foto-Kontingent; bezahlte Pläne konvertieren ohne Limits. Einzelne Anfragen sind auf 5 MB Text, 500 Karten pro Deck und 10 MB pro Foto begrenzt.

## Feedback

Etwas, das die Tools nicht können? Schreib an [support@2anki.net](mailto:support@2anki.net). Fehler gehören in die [GitHub-Issues](https://github.com/2anki/server/issues).
