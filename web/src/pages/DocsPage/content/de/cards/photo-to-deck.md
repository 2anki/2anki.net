---
title: Foto zu Deck
description: Fotografiere oder lade ein Foto deiner Notizen hoch — Lehrbuchseite, Vorlesungsfolie, handschriftliche Notizen — und bekomme ein Anki-Deck zurück.
---

Foto zu Deck nimmt ein einzelnes Bild und schickt es an Claudes Vision-Modell, das den Inhalt liest und Frage-und-Antwort-Karten zurückgibt. Die Seite liegt unter [2anki.net/photo-to-deck](https://2anki.net/photo-to-deck).

**Plan:** Der kostenlose Plan bekommt 5 Fotos pro Monat. Kostenpflichtige Pläne nutzen KI-Credits.

## Wann du das nutzt

- Eine Lehrbuchseite, Vorlesungsfolie oder fotografierte Notizseite, die du als Karteikarten willst.
- Handschriftliche Notizen — Claude liest Schreibschrift und Druckschrift recht gut.
- Ein Whiteboard-Foto aus dem Unterricht oder einer Lernsitzung.

Wenn deine Quelle schon eine Datei ist — PDF, Markdown, eine Notion-Seite — nutze stattdessen den standardmäßigen Upload-Ablauf auf der Startseite. Foto zu Deck ist für die Momente, in denen die einfachste Eingabe ein Foto ist.

## Ein Deck bauen

1. Öffne [2anki.net/photo-to-deck](https://2anki.net/photo-to-deck). Du musst angemeldet sein.
2. (Optional) Benenne das Deck. Der Standard nutzt den Dateinamen des Fotos.
3. Wähle eine Kartendichte (mehr dazu unten).
4. Füge ein Foto hinzu. Auf zwei Wegen:
   - **Take a photo** — auf einem Handy öffnet das direkt die Rückkamera.
   - **Drop or pick** — zieh ein Bild in die Ablagezone oder klick, um eine Dateiauswahl zu öffnen.
5. (Optional) Schalte **Show source image on the back of each card** aus, wenn du nur Text auf der Rückseite willst. Standard ist ein.
6. Klick auf **Get flashcards**. Das Deck lädt als `.apkg` herunter, sobald es fertig ist.

Die Seite zeigt die Zahl der extrahierten Karten, sobald das Deck ankommt. Öffne die Datei in Anki zum Importieren.

## Unterstützte Formate und Größe

- **Bildtypen:** JPEG, PNG, WebP, GIF.
- **Größenlimit:** 10 MB pro Foto. Wenn du das Limit erreichst, mach das Foto in niedrigerer Auflösung oder komprimiere es vor dem Upload.
- **Sehr große Bilder** sind zusätzlich durch eine Token-Obergrenze auf der Modellseite begrenzt — wenn du eine "photo is too large"-Meldung schon unter 10 MB siehst, ist die Auflösung das Problem, nicht die Dateigröße.

## Kartendichte

Die drei Chips unter dem Decknamen entscheiden, wie viele Karten pro Bild:

- **Sparse — 3 bis 5 Karten.** Diagramme, Ein-Konzept-Folien, Vokabellisten, bei denen du nur die Schlagzeilen-Fakten willst.
- **Balanced — 6 bis 10 Karten.** Der Standard. Passt zur typischen Ausgabe des früheren festen Prompts — fang hier an.
- **Dense — 12 bis 20 Karten.** Lehrbuchseiten, dichte Vorlesungsfolien, fotografierte Notizen, bei denen du jeden einzelnen Fakt aufgefächert willst.

Das Modell zielt auf den Bereich; es trifft nicht immer die exakte Zahl. Deine Wahl wird zwischen Sitzungen im selben Browser gemerkt.

## Was auf der Karte landet

- **Vorderseite:** die Frage oder der Begriff, den Claude aus dem Bild extrahiert hat.
- **Rückseite:** die Antwort oder Definition. Wenn **Show source image on the back of each card** ein ist (Standard), wird das Originalfoto unter dem Antworttext eingebettet, sodass du beim Lernen gegen die Quelle prüfen kannst.
- **Tags:** jede Karte kommt mit 1 bis 3 Themen-Tags an, aus dem tatsächlichen Inhalt gezogen — kurz, klein geschrieben, snake_case (`enzymes`, `michaelis_menten`). Filtere in Ankis Tag-Browser nach Tag, um eine Teilmenge zu lernen.

## Kostenloser Plan und Kontingent

Der kostenlose Plan ist auf 5 Fotos pro Kalendermonat begrenzt — Vision-Aufrufe kosten auf unserer Seite echtes Geld. Wenn du das Limit erreichst, zeigt die Seite, wie viele du genutzt hast, und einen Weg zum Upgrade. Der Zähler setzt sich am 1. jedes Monats zurück.

Kostenpflichtige Pläne (Subscription oder Lifetime) nutzen KI-Credits statt des kostenlosen Monatslimits — viel mehr Fotos, begrenzt durch dein Credit-Guthaben.

## Tipps für bessere Ergebnisse

- **Eng zuschneiden.** Wenn nur ein Viertel des Fotos der Inhalt ist, der dich interessiert, schneide es vor dem Upload zu. Claude verschwendet Tokens (und dein Kontingent) mit dem Rest.
- **Tageslicht schlägt Neonröhren.** Scharfe, kontrastreiche Fotos werden sauberer extrahiert als dunkle oder verschattete.
- **Eine Folie pro Foto.** Ein Foto von zwei Lehrbuchseiten auf einmal zwingt das Modell zu wählen, was es priorisiert. Zwei Einzelseiten-Fotos schlagen meist ein Doppelseiten-Foto.
- **Handschrift funktioniert — ordentliche Handschrift besser.** Wenn deine für einen Freund unleserlich ist, ist sie es auch für Claude.
- **Balanced probiert und zu wenige Karten bekommen?** Wechsle zu Dense und lade erneut hoch. Ein erneuter Lauf kostet im kostenlosen Plan einen weiteren Kontingentpunkt, wähle die Dichte also möglichst vor dem ersten Lauf.

## Wenn etwas nicht funktioniert

- **"Photo is too large"** — die Auflösung des Bildes überschreitet die Token-Obergrenze des Vision-Modells. Reduziere die Auflösung oder mach einen engeren Zuschnitt.
- **"Free plan is 5 photos per month"** — du hast das Limit erreicht. Warte bis zum 1. oder mach ein Upgrade.
- **Die Karten kamen falsch oder spärlich zurück** — probier dasselbe Foto in höherer Dichte. Wenn Dense immer noch zu wenige Karten erzeugt, ist das Bild wahrscheinlich zu kontrastarm, als dass das Modell es sicher lesen könnte. Fotografiere erneut mit besserem Licht.
- **Du willst lieber deine eigenen Kartengrenzen zeichnen** auf einem Diagramm — nutze stattdessen [Image Occlusion](/documentation/cards/image-occlusion). Foto zu Deck ist für die Frage-und-Antwort-Extraktion; Image Occlusion ist für räumliche "Was ist hinter der Abdeckung"-Karten.
