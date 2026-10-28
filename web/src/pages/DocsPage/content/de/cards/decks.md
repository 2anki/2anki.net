---
title: Was ist ein Deck?
description: Wie 2anki eine Notion-Seite oder -Datenbank in ein Anki-Deck verwandelt und wie du änderst, welche Blöcke eins erzeugen.
---

Ein **Deck** ist ein Beutel voller Karteikarten in Anki. Jede Karte, die du lernst, liegt in genau einem Deck. Wenn 2anki eine Notion-Seite liest, muss es entscheiden, wo ein Deck endet und das nächste beginnt — das ist eine _Deck-Grenze_.

**Plan:** Kostenlos

## Die Standardregel

Standardmäßig erzeugen zwei Notion-Blocktypen eine Deck-Grenze:

- **page** — jede Notion-Seite ist ihr eigenes Deck.
- **database** — jede Notion-Datenbank ist ihr eigenes Deck.

Wenn du 2anki also auf eine Seite namens _Pharmacology_ zeigst, die eine Unterseite _Antibiotics_ enthält, bekommst du ein Deck namens _Pharmacology_ und ein Unterdeck namens _Antibiotics_. Karten unter jeder Überschrift oder jedem Toggle landen im passenden Deck.

Im kostenlosen Plan liest 2anki die ersten 100 Blöcke einer Seite. Längere Seiten werden teilweise konvertiert, und die Zeile des Decks unter Meine Stapel zeigt, wie viele Blöcke konvertiert wurden. Kostenpflichtige Pläne konvertieren die ganze Seite.

## Ändern, welche Blöcke ein Deck erzeugen

Regeln gelten jeweils für **eine Notion-Seite**. Um die Deck-Grenzen zu ändern:

1. Geh zu [2anki.net/notion](https://2anki.net/notion) und finde die Seite.
2. Klick auf das **Settings** (Zahnrad)-Symbol daneben.
3. Unter **Decks and sub-decks → Deck boundaries** schaltest du die Blocktypen um.

Die unterstützten Grenztypen sind `page` und `database`. Wähle mindestens einen — wenn du beide abwählst, nutzt 2anki den Standard, um ein leeres Deck zu vermeiden.

| Auswahl                        | Was du bekommst                                                           |
| ------------------------------ | ------------------------------------------------------------------------- |
| `page` + `database` (Standard) | Seiten und Datenbanken werden jeweils zu einem Deck                       |
| nur `page`                     | Nur Seiten werden zu Decks; Datenbanken werden ins Elterndeck eingebettet |
| nur `database`                 | Nur Datenbanken werden zu Decks; Unterseiten werden eingebettet           |

## Unterdecks vs. Deck-Grenzen

Eine **Deck-Grenze** startet ein brandneues Deck auf oberster Ebene. Ein **Unterdeck** verschachtelt sich in ein bestehendes Deck. Es sind getrennte Einstellungen auf derselben Seite.

Wenn du willst, dass eine Notion-Unterseite zu einem _Unterdeck_ statt zu einem separaten Deck auf oberster Ebene wird, lass `page` als Deck-Grenze ausgewählt und füge `child_page` (oder welchen Block auch immer) unten zu **Sub-decks** hinzu.

Siehe [Parser-Regeln](/documentation/cards/parser-rules) für die vollständige Aufschlüsselung jeder Regelgruppe und [Notion-Blöcke, die wir unterstützen](/documentation/cards/notion-blocks) für das, was jeder Block auf der Karte selbst bewirkt.
