---
title: 2anki in Claude oder ChatGPT nutzen
description: Den 2anki-MCP-Server verbinden und Anki-Decks direkt aus einem Gespräch bauen.
---

2anki läuft als MCP-Connector, sodass ein KI-Assistent deine Anki-Decks für dich bauen kann. Füge Vorlesungsnotizen in ein Gespräch ein, frag nach Karteikarten, und bekomm einen Download-Link für eine fertige `.apkg` — ohne den Chat zu verlassen.

**Der Connector steht jedem angemeldeten Konto offen.** Melde dich auf [2anki.net](https://2anki.net/) an, füge den Connector hinzu und bestätige die Zustimmungsseite einmal. Kostenlose Konten behalten ihr monatliches Kartenlimit; bezahlte Pläne konvertieren ohne Limits.

## Mit Claude verbinden

<ol class="steps">
<li>

**Connector-Einstellungen öffnen.** Geh in Claude (Web oder Desktop) zu **Settings → Connectors** und wähle **Add custom connector**.

</li>
<li>

**Den 2anki-Server hinzufügen.** Gib `https://2anki.net/mcp` als URL ein und bestätige.

</li>
<li>

**Anmelden.** Claude öffnet eine 2anki-Anmelde- und Zustimmungsseite. Einmal bestätigen; die Verbindung bleibt über Gespräche hinweg bestehen.

</li>
<li>

**Nutzen.** Bitte Claude in einem beliebigen Gespräch um Karteikarten — „mach aus diesen Notizen ein Anki-Deck". Claude ruft 2anki auf und antwortet mit einem Download-Link für die `.apkg`.

</li>
</ol>

## Mit ChatGPT verbinden

<ol class="steps">
<li>

**Developer mode aktivieren.** Geh in ChatGPT zu **Settings → Apps & Connectors → Advanced settings** und schalte **Developer mode** ein (setzt einen bezahlten ChatGPT-Plan voraus).

</li>
<li>

**Den Connector anlegen.** Wähle unter **Apps & Connectors** den Punkt **Create**, gib `https://2anki.net/mcp` als MCP-Server-URL ein und wähle **OAuth** als Anmeldemethode.

</li>
<li>

**Anmelden.** ChatGPT öffnet die 2anki-Anmelde- und Zustimmungsseite. Einmal bestätigen.

</li>
<li>

**Nutzen.** Beginne eine Nachricht, füge den 2anki-Connector über das Tool-Menü des Eingabefelds hinzu und frag nach einem Deck.

</li>
</ol>

## Was der Assistent kann

- Eingefügten Text, Notizen oder eine Dokument-Zusammenfassung in ein fertiges Deck mit Download-Link verwandeln
- Ein Foto handschriftlicher Notizen, einer Buchseite oder einer Folie in Karten konvertieren
- Notiztypen (Basic, umgekehrt, Lückentext) und Karten-Optionen wählen, inklusive Subdecks
- Die Karten eines Decks vor dem Download anzeigen
- Deine bereits erstellten Decks auflisten

Kostenlose Konten behalten ihr normales monatliches Kartenlimit; bezahlte Pläne konvertieren ohne Limits — dieselben [Pläne und Limits](/documentation/reference/plans) wie in der Web-App.

## Wenn etwas fehlschlägt

- Wenn die Anmeldung in einer Schleife hängt oder der Assistent meldet, dass er sich nicht anmelden kann: Stell sicher, dass du auf [2anki.net](https://2anki.net/) angemeldet bist, und füge den Connector dann erneut hinzu.
- Wenn die Verbindung nicht mehr funktioniert: Entferne den Connector und füge ihn erneut hinzu, um die Anmeldung neu zu starten.
- Alles andere: Schreib an [support@2anki.net](mailto:support@2anki.net).
