---
title: KI-Karteikartenerstellung
description: Wann 2anki die Karten für dich schreiben soll — Claude für jedes PDF und ein PDF-only-Fragengenerator, der ebenfalls Claude nutzt.
---

Zwei Kartenoptionen schicken deine Quelle an ein KI-Modell, statt den normalen Toggle-/Aufzählungs-Parser laufen zu lassen. Nutze sie, wenn deine Quelle nicht schon wie Karteikarten geformt ist — lange PDFs, Vorlesungstranskripte, dichtes Lernmaterial — und du willst, dass das Modell die Frage-Antwort-Paare für dich herauszieht.

**Plan:** Subscription oder Lifetime. Kostenlose Konten sehen die Toggles, aber die Konvertierung fällt auf den Standard-Parser zurück.

## Wann du das nutzt

- Deine Quelle ist ein PDF, das komplett Fließtext ist — ein Lehrbuchkapitel, ein Artikel, Vorlesungsnotizen — und es gibt keine Toggles oder Aufzählungen zum Konvertieren.
- Du hast den Standard-Parser probiert und er hat zu wenige Karten erzeugt, oder keine.
- Du hast einen bestimmten Blickwinkel, den die Karten einnehmen sollen ("konzentriere dich auf Daten und Namen", "nutze klinische Fallvignetten", "überspringe die Einleitung").

Wenn deine Quelle schon strukturiert ist — Notion-Toggles, Obsidian-Aufzählungen, eine Tabelle mit Frage- und Antwortspalten — ist der Standard-Parser schneller und genauer. Überspringe KI für diese.

## Generate Flashcards with Claude AI

Die Allzweckoption. Schickt deinen Inhalt an Anthropics Claude und nutzt die Antwort als dein Deck.

1. Öffne im Upload-Bildschirm das Einstellungspanel.
2. Schalte **Generate Flashcards with Claude AI** ein.
3. (Optional) Öffne **User instructions** und schreib ein oder zwei Sätze über die Art von Karten, die du willst.
4. Lade deine Datei hoch. Der Job läuft im Hintergrund — du kannst die Seite verlassen und zu **My Decks** zum Herunterladen zurückkommen.

Das Ergebnis ist eine normale `.apkg`. Karten kommen mit 1–3 Themen-Tags aus dem Inhalt vorgetaggt an — du kannst in Ankis Tag-Browser nach Tag filtern oder stöbern, sobald das Deck sich öffnet. Du kannst das Deck aus **My Decks** erneut herunterladen, solange dein Plan es behält (siehe [Grenzen und Kontingente](/documentation/help/limits) für Speicherfenster).

**Kartenmenge — Comprehensive AI mode.** Subscription- und Lifetime-Pläne bekommen einen **Comprehensive AI mode**-Schalter auf der Kartenoptionen-Seite unter **PDF & AI**. Schalte ihn ein, um 200–500 Karten pro Upload für kapitelgroßes Material anzuzielen: Der Konverter teilt lange Uploads in Chunks, lässt sie parallel laufen und geht die dünnsten Chunks mit einem Nachschub-Durchlauf an, sodass ein 50-seitiges Kapitel als ein volles Deck statt einer spärlichen Auswahl landet. Die Gesamtsumme ist bei 500 gedeckelt, um das Deck lernbar zu halten. Konvertierungen dauern länger als im Standardmodus. Lass den Schalter aus, wenn du die schnellere Standardmenge willst. Kostenlose Konten sehen den Schalter nicht — die standardmäßige KI-Konvertierung läuft mit der Standardmenge.

### Gute User instructions schreiben

Das Modell macht es besser mit einem klaren Blickwinkel als mit einem langen Briefing. Ein oder zwei Sätze reichen völlig.

Nützliche Anweisungen:

- "Focus on USMLE Step 1 high-yield. Skip background paragraphs."
- "Make every card a clinical vignette ending in a question."
- "Use the exact wording from the source on the back."
- "Mostly cloze deletions, with a few multiple-choice for the key facts."

Überspringe Anweisungen wie "make great flashcards" oder "explain everything" — das versucht das Modell ohnehin schon.

## Generate Questions from Single PDF File Uploads

Eine engere Option, auf einzelne PDFs beschränkt. Schickt das PDF an Anthropic Claude, um Seite für Seite Frage-und-Antwort-Paare zu erzeugen.

1. Öffne das Einstellungspanel vor dem Hochladen.
2. Schalte **Generate Questions from Single PDF File Uploads** ein.
3. Lade ein einzelnes PDF hoch. ZIPs und Markdown nutzen diesen Weg nicht.

Nutze das, wenn du eine Fragenerstellung willst, die auf einen bestimmten Seite-für-Seite-Rhythmus abgestimmt ist. Die Ausgabe läuft durch denselben Verpackungsschritt, sodass die resultierende `.apkg` sich in Anki wie jede andere öffnet.

## Speicherung und Datenschutz

KI-Konvertierungen dauern länger als der Standard-Parser — das Deck baut sich im Hintergrund und wird in deinem Konto gespeichert, damit du es erneut herunterladen kannst. Plan-Fenster:

| Plan         | Wie lange das KI-Deck behalten wird         |
| ------------ | ------------------------------------------- |
| Free         | Fällt auf Standard-Parser zurück (keine KI) |
| Subscription | Behalten, solange dein Abo aktiv ist        |
| Lifetime     | Unbegrenzt behalten                         |

Wir schicken den Inhalt nur an das Modell, um dein Deck zu bauen. Wir trainieren nicht damit. Volle Details in der [Datenschutzerklärung](/documentation/reference/privacy).

## Häufige Fehler

- **Leeres PDF.** Wenn das Modell nichts findet, woraus es eine Karte machen könnte, scheitert die Konvertierung mit _Claude couldn't find any content to turn into flashcards in this Notion page_ (dieselbe Meldung erscheint für PDFs). Prüfe, ob das PDF auswählbaren Text hat — gescannte Bilder funktionieren ohne vorheriges OCR nicht.
- **Widersprüchliche Optionen.** Beide einzuschalten, **Generate Flashcards with Claude AI** und die Standard-Toggle-Optionen, verdoppelt die Karten nicht. Claude übernimmt für das ganze Dokument.
- **Kostenerwartung.** Jede KI-Konvertierung nutzt auf unserer Seite Modell-Credits. Wir geben keine Preise pro Karte weiter, aber sehr große PDFs können mehrere Minuten bis zum Abschluss brauchen.

## Verwandt

- [Kartenoptionen](/documentation/cards/card-options) — der Rest der Schalter
- [Dateiformate](/documentation/reference/file-formats) — welche PDFs wir akzeptieren
- [Grenzen und Kontingente](/documentation/help/limits) — Claude AI ist eine kostenpflichtige Option
