---
title: Mindmaps
description: Baue einen Baum in deinem Browser und lade ihn als Anki-Deck herunter.
---

Der Mindmap-Editor unter [2anki.net/mindmaps](https://2anki.net/mindmaps) lässt dich eine Hierarchie in deinem Browser skizzieren — Themen, Unterthemen, verschachtelte Konzepte — und als `.apkg`-Deck exportieren. Im Export-Dialog kannst du vor dem Herunterladen einen Kartentyp wählen.

**Plan:** Kostenlose Konten können 3 gespeicherte Maps und 50 Knoten pro Map haben. Abonnenten bekommen 25 Maps und 250 Knoten pro Map. Lifetime und Auto-Sync geben unbegrenzte Maps und Knoten.

## Ein Deck bauen

1. Öffne [2anki.net/mindmaps](https://2anki.net/mindmaps) und klick auf **New map**.
2. Doppelklick auf den Wurzelknoten, um ihn zu benennen (z. B. "Brachial plexus").
3. Wähle einen Knoten und drück **Tab**, um ein Kind hinzuzufügen, oder **Enter**, um ein Geschwister hinzuzufügen. Doppelklick oder **F2** zum Umbenennen eines Knotens inline.
4. Mach weiter, bis die Hierarchie widerspiegelt, was du lernst.
5. Klick auf **Download deck** im rechten Panel, gib dem Deck einen Namen und bestätige.
6. Öffne die `.apkg` in Anki.

## Tastaturmodell

| Taste               | Was sie macht                                                       |
| ------------------- | ------------------------------------------------------------------- |
| Tab                 | Fügt dem gewählten Knoten einen Kindknoten hinzu                    |
| Enter               | Fügt einen Geschwisterknoten auf derselben Ebene hinzu              |
| Backspace           | Löscht den gewählten Knoten (Bestätigung nötig, wenn er Kinder hat) |
| Doppelklick oder F2 | Bearbeitet die Knotenbeschriftung inline                            |

## Wie Karten erzeugt werden

Der Export-Dialog bietet drei Kartentypen. **Cloze** ist der Standard.

### Cloze (Standard)

Jeder Pfad von der Wurzel zum Blatt wird zu einer Cloze-Karte. Jeder Knoten entlang des Pfades — außer dem letzten Blatt — wird in eine Cloze-Löschung gehüllt. Das Blatt ist der Kontextanker, der den Pfad zusammenhält.

Eine Map mit der Wurzel **Science → Biology → Genetics** erzeugt eine Karte:

```
{{c1::Science}} → {{c2::Biology}} → Genetics
```

Eine Stern-Map — **Anatomy → Bone** und **Anatomy → Muscle** — erzeugt zwei Karten:

```
{{c1::Anatomy}} → Bone
{{c1::Anatomy}} → Muscle
```

Die im Dialog gezeigte Kartenzahl entspricht der Zahl der Blattknoten (Knoten ohne Kinder).

### Basic

Jede **Kante** (Eltern-→-Kind-Verbindung) wird zu einer Basic-Karte: Die Elternbeschriftung ist die Vorderseite, die Kindbeschriftung die Rückseite.

Eine einfache Stern-Map — eine Wurzel mit drei Kindern — erzeugt drei Karten:

- Root → Child A
- Root → Child B
- Root → Child C

Ein tieferer Baum erzeugt eine Karte pro Verbindung. Die gezeigte Kartenzahl entspricht der Zahl der Kanten.

Knoten ohne Kanten (isolierte Knoten) erzeugen in keinem Modus Karten.

### Whole map

Der ganze Baum wird zu einer einzelnen Karte. Die Rückseite der Karte zeigt eine interaktive, einklappbare Mindmap, direkt in Anki gerendert — keine Internetverbindung nötig. Schwenke und zoome, um den Baum beim Lernen zu erkunden.

## Grenzen im kostenlosen Plan

- **3 gespeicherte Maps.** Das Löschen einer Map macht sofort einen Platz frei; es gibt kein monatliches Fenster.
- **50 Knoten pro Map.** Der Editor zeigt eine Meldung, wenn du das Limit erreichst. Abonnenten bekommen 250 Knoten pro Map, Lifetime und Auto-Sync haben kein Knotenlimit.

## Bilder in Knoten

Du kannst jedem Knoten ein Bild hinzufügen. Beim Export wird das Bild in die `.apkg` eingebettet, sodass Anki es auf der Karte zeigt — keine Internetverbindung während des Lernens nötig.

**Ein Bild einfügen (Cmd/Strg+V):** klick irgendwo auf das Canvas (nicht in ein Texteingabefeld), dann einfügen. Ein neuer Knoten erscheint in der Mitte des sichtbaren Canvas mit dem Bild als Inhalt.

**Eine Bilddatei ablegen:** zieh eine Datei aus deinem Dateimanager und leg sie irgendwo auf dem Canvas ab. Der neue Knoten erscheint dort, wo du sie abgelegt hast.

**Akzeptierte Formate:** PNG, JPEG, GIF, WebP. SVG wird nicht akzeptiert.

**Größenlimit:** 5 MB pro Bild. Größere Dateien werden abgelehnt.

**Ein Bild pro Knoten.** Wenn du ein zweites Bild auf einen bestehenden Knoten einfügst oder ablegst, ersetzt das neue Bild das alte.

**Beschriftungen funktionieren weiterhin.** Ein Knoten kann sowohl ein Bild als auch eine Textbeschriftung haben. Die Beschriftung erscheint unter dem Bild im Editor und auf der exportierten Karte.

## Import aus OPML oder Brainstorms

Du kannst bestehende Gliederungen auch direkt unter [2anki.net/upload](https://2anki.net/upload) konvertieren — ohne deinen Inhalt im Editor neu einzugeben.

- **OPML** (`.opml`) — exportiert aus OmniOutliner, iThoughtsX oder jedem Outliner, der OPML unterstützt. Leg die Datei auf der Upload-Seite ab.
- **Brainstorms JSON** (`.brainstorms.json`) — exportiert aus Brainstorms (iOS/macOS) über die JSON-Export-Option. Der Dateiname muss auf `.brainstorms.json` enden.

Jede Eltern-→-Kind-Verbindung wird zu einer Basic-Karte, nach derselben Regel wie im Editor.

## Was das nicht ist

- Der Editor ist nur für Desktop. Auf einem Handy oder Tablet erklärt ein Banner das, und es lädt kein Canvas.
- Maps sind privat. Es gibt in v1 keine Funktionen zum Teilen, Einbetten oder für Zusammenarbeit.
- Das native `.xmind`-Format von XMind wird nicht unterstützt — exportiere zuerst aus XMind nach OPML.
- KI-Erstellung (Map aus einem Thema, Karten aus einer Map) ist in v1 nicht verfügbar.

## Verwandt

- [Kartentypen](/documentation/cards/card-types) — basic, cloze, input, MCQ
- [Grenzen und Kontingente](/documentation/help/limits) — was jeder Plan enthält
