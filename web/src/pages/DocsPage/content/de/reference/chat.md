---
title: Chat — Lernassistent
description: Notizen einfügen oder eine Datei anhängen, nach Karten fragen, ein Konzept durcharbeiten. Unterhaltungen werden gespeichert.
---

Chat ist ein Lernassistent, gebaut auf Claude. Füge deine Notizen ein oder häng eine Datei an, dann bitte ihn, Karten zu machen, etwas zu erklären, oder arbeite ein Thema im Hin und Her durch. Öffne ihn unter [2anki.net/chat](https://2anki.net/chat). Anmeldung erforderlich.

**Plan:** Teil jedes bezahlten Plans — Subscription, Day Pass und Lifetime. Mit einem kostenlosen Konto kannst du deine bisherigen Unterhaltungen lesen und bereits erstellte Decks herunterladen; zum Senden von Nachrichten brauchst du einen Plan.

## Wann du das nutzt

- Deine Quelle ist nicht strukturiert genug für den Standard-Parser, und du willst sie interaktiv in Karten verwandeln.
- Ein Standard-Upload hat zu wenige Karten (oder keine) zurückgegeben, und du willst einen zweiten Durchlauf mit einem anderen Blickwinkel.
- Du willst ein Konzept durchdenken, bevor du Karten machst — Erklärung zuerst, Karten danach.
- Du hängst an einem bestimmten Upload-Fehler fest und willst Hilfe, herauszufinden, warum eine Datei nicht konvertiert.

Chat verarbeitet Dateien jetzt direkt — häng ein PDF, ein Bild, einen Notion-Export oder ein Dokument an, und er arbeitet aus dem Inhalt. Für Massenkonvertierung oder eine Notion-Seite, deren Toggles schon sauber auf Karten abbilden, ist der Standard-[Upload-Ablauf](/documentation/start-here/upload-a-file) weiterhin schneller und deterministisch. Greif zu Chat, wenn du die Karten interaktiv formen willst.

## Eine Unterhaltung starten

1. Öffne [2anki.net/chat](https://2anki.net/chat).
2. Klick entweder auf einen der Start-Chips ("Make 10 cards from notes I'll paste", "Explain a concept, then make cards", "Turn this into cloze cards: [paste]") oder tippe deinen eigenen Prompt.
3. Sende. Der Assistent antwortet und streamt die Antwort, während er sie erzeugt.
4. Wenn der Assistent Karten vorschlägt, siehst du sie inline als Vorder-/Rückseiten-Vorschauen. Du kannst weiter iterieren oder von dort eine `.apkg` herunterladen.

Vergangene Unterhaltungen bleiben in der Seitenleiste links. Klick auf eine beliebige, um sie wieder zu öffnen. Du kannst eine Unterhaltung aus derselben Zeile umbenennen oder löschen.

## Dateien anhängen

Häng Lernmaterial direkt an eine Nachricht an — für eine einzelne Datei brauchst du die Upload-Seite nicht. Klick auf den Anhängen-Button, wähle deine Dateien und sende sie mit oder ohne Prompt. Ohne Prompt macht Chat Karten aus dem, was du angehängt hast.

Was du anhängen kannst:

- PDFs und Bilder (PNG, JPEG, GIF, WebP) gehen unverändert an das Modell — es liest die Seiten oder das Bild direkt.
- Notion-Exporte (.zip), Word-Dokumente (.docx), Markdown (.md) und einfacher Text (.txt) werden in Text umgewandelt, bevor das Modell sie sieht.

Grenzen pro Nachricht:

- Bis zu 5 Dateien.
- 10 MB pro Datei.
- 25 MB über alle Dateien.

Überschreitest du eine Grenze, wird die Nachricht abgelehnt, bevor sie sendet, mit einem Hinweis, welche Datei oder Summe du kürzen musst.

**Einen Turn neu generieren.** Neugenerieren nutzt das PDF oder Bild wieder, das du an diesen Turn angehängt hast, sodass du für einen anderen Blickwinkel nichts erneut hochladen musst. Angehängte PDFs und Bilder werden 90 Tage aufbewahrt, dann gelöscht. Generierst du danach einen älteren Turn neu, bittet Chat dich, die Datei erneut anzuhängen.

## Nützliche Prompts schreiben

Ein klarer Prompt schlägt einen langen. Drei Muster, die funktionieren:

**Füge deine Notizen ein, dann frag.** "Here are my notes on the citric acid cycle. Make 12 cards focused on enzymes and their products." — füge die Notizen danach ein.

**Bitte zuerst um Erklärung.** "Explain why beta-blockers work in heart failure. Then make 5 cards from your explanation." — nützlich, wenn du noch nicht sicher bist, was die richtigen Fragen sind.

**Übergib einen festgefahrenen Upload.** Wenn die Upload-Seite dir sagte, dass 0 Karten erstellt wurden, klick im Fehler auf **Open in chat**. Die Unterhaltung füllt sich mit dem Dateinamen vor, und du kannst beschreiben, was in der Datei steht.

Der gleiche Rat, der für [KI-Karteikarten](/documentation/cards/ai-flashcards) funktioniert, funktioniert hier — sei konkret, worauf du dich konzentrieren willst, was du überspringst und welchen Ton du willst.

## Unterhaltungsgrenzen

|                  | Free                               | Bezahlte Pläne  |
| ---------------- | ---------------------------------- | --------------- |
| Nachrichten      | — (bisherige Chats bleiben lesbar) | Unbegrenzt      |
| Nachrichtenlänge | —                                  | 100 000 Zeichen |

Siehe [Grenzen und Kontingente](/documentation/help/limits) für die vollständige Plantabelle.

## Was wir speichern

- Den Text jeder Nachricht in jeder Unterhaltung (damit du sie wieder öffnen kannst). Ein Notion-Export, ein Dokument, Markdown oder eine Textdatei, die du anhängst, wird Teil dieses Nachrichtentexts.
- Jedes PDF und Bild, das du anhängst, 90 Tage aufbewahrt, damit du den Turn neu generieren kannst, dann gelöscht.
- Das Nutzerkonto, dem die Unterhaltung gehört.
- Nichts sonst — wir betreiben keine Analytik darüber, was du fragst, und wir trainieren keine Modelle mit deinen Unterhaltungen.

Lösche eine Unterhaltung jederzeit über das Papierkorb-Symbol in der Seitenleiste. Die Löschung ist sofortig und endgültig — die Unterhaltung kann nicht wiederhergestellt werden. Für das vollständige Datenbild siehe die [Datenschutzerklärung](/documentation/reference/privacy).

## Häufige Fehler

- **Mehr als das Nachrichtenlimit einfügen.** Jede Nachricht ist auf 100 000 Zeichen begrenzt. Teile eine längere Quelle über mehrere Nachrichten auf.
- **Einen Dateityp anhängen, den Chat nicht nimmt.** Chat akzeptiert PDF, Bilder, Notion-.zip-Exporte, .docx, .md und .txt. Exportiere oder konvertiere alles andere zuerst in eines davon.
- **Chat als einzigen Weg behandeln.** Für Quellen, die schon Struktur haben, ist der Standard-Parser schneller, deterministisch und kostenlos.

## Verwandt

- [KI-Karteikarten](/documentation/cards/ai-flashcards) — automatische Claude-Erstellung als Teil des Uploads, für Dateien statt eingefügten Text
- [Grenzen und Kontingente](/documentation/help/limits) — Nachrichtenkontingente nach Plan
- [Datenschutzerklärung](/documentation/reference/privacy) — was wir speichern, was nicht
