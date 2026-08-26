---
title: Wenn Sync hängen bleibt
description: Drei Dinge, die du versuchen kannst, wenn dein Deck sich nicht aktualisiert.
---

Sync läuft alle fünf Minuten im Hintergrund. Meistens bemerkst du ihn nicht. Wenn er doch hängen bleibt, ist es fast immer eines der drei Dinge unten.

**Plan:** Lifetime (Sync ist durch denselben Zugang gesteuert wie [Wie Sync funktioniert](/documentation/sync/how-it-works))

## Seite wurde nicht synchronisiert

Du hast eine Notion-Seite bearbeitet. Das Deck in Anki hat sich nicht aktualisiert. Versuch, der Reihe nach:

1. **Warte fünf Minuten.** Sync fragt in einem Fünf-Minuten-Takt ab, um innerhalb der Rate-Limits von Notions kostenlosem Tarif zu bleiben. Wenn du gerade erst bearbeitet hast, ist er vielleicht noch nicht gelaufen.
2. **Öffne das Ankify-Dashboard.** Jede abonnierte Seite zeigt die letzte Laufzeit und einen etwaigen Fehler aus diesem Lauf. Wenn du einen Fehler siehst, zeigt er meist direkt auf die Ursache.
3. **Prüfe, ob die Seite noch mit der 2anki-Integration geteilt ist.** Notion verliert die Verbindung manchmal nach einer Workspace-Änderung. Öffne die Seite in Notion, klick auf **Share → Add connections**, und füge 2anki erneut hinzu.
4. **Prüfe, ob Anki geöffnet ist und AnkiConnect läuft.** Sync schreibt über AnkiConnect nach Anki — wenn Anki nicht auf dem Gerät geöffnet ist, das das Deck hält, wird der Lauf auf unserer Seite abgeschlossen, aber das Deck ändert sich nicht.

Wenn das Dashboard zeigt, dass Läufe erfolgreich sind, das Deck sich aber trotzdem nicht aktualisiert, ist es fast immer AnkiConnect. Starte Anki neu, und löse dann einen manuellen Sync aus dem Dashboard aus.

## Ich habe nach dem erneuten Import doppelte Karten bekommen

Anki warnt nicht vor Duplikaten. Sie tauchen einfach im Deck auf, und man merkt es oft erst beim Lernen. Sync merkt sich deine Karten unter deinem Konto, deshalb aktualisieren Änderungen die vorhandenen Karten, statt Kopien anzulegen. Wenn sich ein Deck während des Juli-Exportfehlers verdoppelt hat, ist das eine einmalige Aufräumaktion: Räum das zusätzliche Set einmal auf, dann bleibt es sauber.

Die Schritte zum Aufräumen und warum das passiert findest du in [Update your deck, keep your reviews](/documentation/cards/duplicate-cards).

## Ich sehe zwei Kopien derselben Karten

Behalte die Kopien, die deinen Lernverlauf tragen; welches Set das ist, hängt davon ab, wann du das Deck zum ersten Mal gebaut hast. Hast du es vor Juli 2026 gebaut, schalte in deinen Kartenoptionen **Karten ihren Notion-Blöcken zuordnen** ein und lade die Seite erneut hoch, damit der Import deine Originale aktualisiert; räum danach das übrig gebliebene Set weg. Hast du es im Juli 2026 oder später gebaut, lass die Option aus.

1. Öffne in Anki **Browse** und wähle das Deck.
2. Sortiere nach der Spalte **Created**, um die Kopien zu gruppieren.
3. Lösche die Kopien mit 0 Reviews über **Notes → Delete**. Behalte die mit deinen echten Review-Zahlen.

Künftige Importe derselben Seite aktualisieren die verbliebenen Karten an Ort und Stelle. Vollständige Anleitung: [Update your deck, keep your reviews](/documentation/cards/duplicate-cards).

Wenn beide Kopien einen Lernverlauf haben, der dir wichtig ist, [kontaktiere uns](/documentation/help/contact), bevor du eines löschst. Wir können manchmal zusammenführen.

## Ich habe den Zugriff versehentlich entzogen

Wenn du 2anki aus deinem Notion-Workspace entfernt hast, stoppt Sync und das Dashboard zeigt einen Authentifizierungsfehler. Zum Wiederherstellen:

1. Geh zu [2anki.net](https://2anki.net/) und melde dich erneut mit Notion an.
2. Teile die Seiten, die du synchronisieren willst, erneut — öffne jede in Notion, klick auf **Share → Add connections**, und wähle 2anki.
3. Bestehende Abonnements setzen beim nächsten Lauf wieder ein. Du musst nicht erneut abonnieren.

Dein Kartenverlauf geht nicht verloren. Das Dashboard merkt sich, welche Notion-Seiten welchen Anki-Decks zugeordnet waren.

## Immer noch hängen?

Wenn nichts davon geholfen hat:

- Sieh in [Häufige Probleme](/documentation/help/common-problems) für jede Fehlermeldung, die du siehst.
- [Kontaktiere uns](/documentation/help/contact) — nenne den Namen der Notion-Seite, den Zeitstempel des Ankify-Laufs und die Fehlermeldung aus dem Dashboard.
