---
title: Image Occlusion
description: Verdecke Teile eines Bildes und rufe sie ab — Anatomie, Diagramme, Karten, Screenshots.
---

<figure>
  <iframe
    src="https://www.youtube.com/embed/roQ3awaVa2E"
    title="2anki — build an image occlusion deck on the web canvas"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen
    width="100%"
    style="aspect-ratio: 16 / 9; border: 0; border-radius: var(--radius-md);"
  ></iframe>
</figure>

Image-Occlusion-Karten zeigen dir ein Bild mit verdeckten Teilen. Du versuchst abzurufen, was hinter der Abdeckung steckt, und drehst die Karte dann um, um zu sehen, ob du richtig lagst. Das Canvas-Tool unter [2anki.net/image-occlusion](https://2anki.net/image-occlusion) lässt dich die Abdeckungen selbst zeichnen — kein Anki-Add-on, keine Plugin-Installation.

**Plan:** Kostenlose Konten können jede Quelle nutzen, auch den Notion-Import, bis zu 3 Bilder pro Deck. Subscription und Lifetime erlauben bis zu 20 hochgeladene Bilder auf einmal.

## Wann du das nutzt

- Du lernst etwas Visuelles, wo das Layout selbst die Antwort ist — Anatomiediagramme, Hirnregionen, chemische Strukturen, EKGs, Karten, UI-Screenshots, Code-Diagramme.
- Eine einfache Frage/Antwort-Karte wäre langsamer, als einfach das Bild zu sehen und die Beschriftungen abzurufen.
- Du hast bereits ein Diagramm mit Beschriftungen und willst dich an Ort und Stelle auf diese Beschriftungen prüfen.

Wenn deine Quelle Text ist — Toggles, Aufzählungen, Fließtext — sind einfache oder Cloze-Karten schneller. Image Occlusion lohnt den Aufwand nur bei wirklich räumlichem Inhalt.

## Ein Deck bauen

1. Öffne [2anki.net/image-occlusion](https://2anki.net/image-occlusion).
2. Benenne das Deck (das Feld oben im linken Panel). Standard ist "My image deck".
3. Bilder hinzufügen. Auf drei Wegen:
   - **Upload** — zieh Bilder in die Warteschlange oder nutze die Dateiauswahl.
   - **Paste** — kopiere ein Bild in deine Zwischenablage (Screenshot-Tool, eine Notion-Seite, irgendwoher) und füge es irgendwo auf der Seite ein.
   - **Import from Notion** — klick auf den Notion-Button an der Warteschlange, wenn du angemeldet und verbunden bist. Wähle Bilder aus deinen Notion-Seiten. Kostenlose Konten können das auch nutzen, innerhalb der Grenze von 3 Bildern pro Deck.
4. Klick auf ein Bild in der Warteschlange, um es auf das Canvas rechts zu laden.
5. Zeichne ein Rechteck über jeden Teil, den du verstecken willst. Jedes Kästchen wird zu einer Karteikarte. Füge jedem Kästchen eine Beschriftung hinzu, wenn du zusätzlichen Kontext auf der Kartenrückseite willst.
6. (Optional) Füge einen Header hinzu — kurzer Text über dem Bild — um der Karte einen Titel oder eine Fragestellung zu geben.
7. Wiederhole das für jedes Bild in der Warteschlange.
8. Wähle unten im linken Panel einen Modus:
   - **Hide all, reveal one** — jedes Kästchen ist verdeckt; nur das, das du gerade lernst, wird beim Umdrehen gezeigt.
   - **Hide one at a time** — nur das Kästchen, das du gerade lernst, ist verdeckt; alles andere bleibt sichtbar.
9. Klick auf **Download deck**, um die `.apkg` zu bekommen. Öffne sie in Anki.

:::tip
Das Canvas lässt sich auf einem Laptop oder Desktop viel leichter bedienen als auf einem Handy. Das Anki-Lernen danach funktioniert auf jedem Gerät gut.
:::

## Entwürfe und Speichern

Angemeldete Nutzer bekommen Auto-Speichern: Änderungen an Deckname, Modus, Header und Kästchen werden etwa jede Sekunde als Entwurf gespeichert. Schließe den Tab, und deine Arbeit ist noch da, wenn du zurückkommst. Entwürfe werden nach einem erfolgreichen Download entfernt.

Anonyme Nutzer (nicht angemeldet) können trotzdem ein Deck bauen und herunterladen, aber die Arbeit wird nicht zwischen Sitzungen gespeichert.

## Hide all vs. hide one — was sich ändert

Für ein einzelnes Bild mit drei beschrifteten Kästchen erzeugt **Hide all** 3 Karten: Jede Karte zeigt das Bild mit allen drei verdeckten Kästchen, wobei auf der Rückseite ein Kästchen aufgedeckt wird. **Hide one** erzeugt ebenfalls 3 Karten, aber jede zeigt das Bild mit zwei sichtbaren und einem verdeckten Kästchen, dann wird das verdeckte aufgedeckt.

Nutze **Hide all**, wenn das Wissen um eine Beschriftung die anderen nicht verraten soll (es ist schwerer). Nutze **Hide one**, wenn die umliegenden Beschriftungen nützlicher Kontext sind (es ist leichter und schneller).

## Häufige Fehler

- **Keine Kästchen gezeichnet.** Der **Download deck**-Button bleibt deaktiviert, bis mindestens ein Bild ein Kästchen hat. Die Kartenzahl neben dem Button ist dein Anhaltspunkt — achte darauf, dass sie nicht null ist.
- **Winzige Kästchen.** Ein Kästchen kleiner als ~20 Pixel ist beim Handy-Lernen schwer zu treffen. Zeichne Abdeckungen, die zu dem passen, was du versteckst, plus etwas Rand.
- **Versuchen, das Bild zuzuschneiden.** Die Kästchen verdecken Inhalt; sie schneiden nicht zu. Um das Bild zu beschneiden, bearbeite es vor dem Hochladen.

## Verwandt

- [Kartentypen](/documentation/cards/card-types) — basic, cloze, input, MCQ
- [Kartenoptionen](/documentation/cards/card-options) — der Rest der Konvertierungseinstellungen
- [Grenzen und Kontingente](/documentation/help/limits) — was jeder Plan enthält
