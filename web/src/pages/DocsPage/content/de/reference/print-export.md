---
title: Drucken oder als PDF exportieren
description: Verwandle eine .apkg in ein druckbares PDF — für Papierlernen, zum Teilen oder als Sicherung.
---

Das Druck-Tool unter [2anki.net/print](https://2anki.net/print) nimmt ein bestehendes Anki-Deck (`.apkg`) und verwandelt es in ein PDF, das du drucken oder jemandem geben kannst. Nützlich für Papierlernen, zum Teilen mit einer Kommilitonin, die Anki nicht nutzt, oder um eine Papierkopie eines Decks zu behalten.

**Plan:** Subscription oder Lifetime. Kostenlose Konten sehen die Seite, aber der Export gibt eine "PDF export is available to subscribers and lifetime members"-Meldung zurück.

## Wann du das nutzt

- Du willst ohne Bildschirmzeit auf Papier lernen.
- Du teilst ein Lernset mit jemandem, der Anki nicht nutzt.
- Du willst eine gedruckte Sicherung eines wichtigen Decks.

Dieses Tool liest ein Deck, nicht deine Quelle. Wenn du noch keine `.apkg` hast, [lade zuerst eine Datei hoch](/documentation/start-here/upload-a-file), um eine zu bekommen, und komm dann hierher zurück.

## Ein Deck als PDF exportieren

1. Öffne [2anki.net/print](https://2anki.net/print).
2. Zieh deine `.apkg` auf den Ablagebereich oder klick, um eine auszuwählen.
3. Öffne das Layout-Panel und passe das Aussehen an:
   - **Paper size** — A4, Letter oder Legal.
   - **Orientation** — Hoch- oder Querformat.
   - **Margins** — Narrow, Normal oder Wide.
   - **Background colour** — wähle eine Farbe, wenn deine Karten ein dunkles Theme nutzen und du einen hellen Druck willst, oder umgekehrt.
4. Das PDF lädt herunter, sobald es fertig ist. Der Dateiname entspricht dem Deck (`MyDeck.apkg` → `MyDeck.pdf`).
5. Öffne das PDF und drucke oder teile es.

## Was im PDF steht

Das PDF zeigt die Karten in Deck-Reihenfolge. Jede Karte rendert Vorder- und Rückseite gestapelt auf der Seite, mit demselben HTML und CSS, das Anki nutzen würde. Medien (Bilder, Audio) rendern als Bild — Audio ist im Druck still, denn Papier spielt keinen Ton.

Kartenvorlagen mit sehr komplexem CSS rendern womöglich nicht genau so wie in Anki. Wenn eine Karte schräg aussieht, probier für den Druck eine unserer [Start-Vorlagen](/documentation/cards/templates) — sie sind darauf ausgelegt, auf Papier sauber zu rendern.

## Datenschutz

Hochgeladene `.apkg`-Dateien werden innerhalb von **2 Stunden** nach dem Export entfernt. Das PDF wird als Antwort zurückgeschickt und nicht auf unseren Servern behalten. Nichts über deine Karten wird aus einem anderen Grund gelesen als dem, das PDF zu erzeugen.

## Häufige Fehler

- **Falscher Dateityp.** Das Druck-Tool akzeptiert nur `.apkg`. Wenn deine Quelle ein Notion-Export, eine Markdown-Datei oder ein PDF ist, geh zuerst auf die [Upload-Seite](/documentation/start-here/upload-a-file), um die `.apkg` zu machen, und komm dann hierher zurück.
- **Sehr große Decks.** Der kostenlose Druck deckt Decks bis 1000 Karten ab. Größere Decks geben "PDF export supports up to 1000 cards." zurück. Mach ein Upgrade für unbegrenzt, oder teile das Deck in Anki (nutze ein gefiltertes Deck oder exportiere ein Unterdeck) und lass jedes durch das Druck-Tool laufen.
- **Kostenloser Plan versucht zu exportieren.** Der Export gibt statt eines PDFs die Upgrade-Meldung zurück. Siehe [Preise](/pricing) für Pläne, oder nutze einen kurzen [Day oder Week Pass](/documentation/reference/plans), wenn du es einmalig brauchst.

## Verwandt

- [Notiztypen und Vorlagen](/documentation/cards/templates) — Vorlagen, die gut drucken
- [Grenzen und Kontingente](/documentation/help/limits) — Pläne und Speicherfenster
- [Pläne und Pässe](/documentation/reference/plans) — einmaliger Zugang für einen einzelnen Export
