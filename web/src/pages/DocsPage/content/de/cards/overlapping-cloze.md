---
title: Überlappende Cloze
description: Verwandle eine Liste oder einen Absatz in einen Satz Karten, der jeweils ein Element versteckt.
---

Wenn du eine geordnete Abfolge auswendig lernst — die Schritte eines Prozesses, die Hirnnerven, die Zeilen eines Gedichts — willst du sie Zeile für Zeile pauken: ein Element verstecken, es mit den umliegenden Zeilen im Blick abrufen und dann zum nächsten gehen. Überlappende Cloze verwandelt eine einzelne Liste in genau diesen Satz Karten.

Jede Karte versteckt ein Element mit einer Cloze-Löschung. Eine Cloze pro Karte, sodass Anki jede Zeile für sich plant — kein Tag Wartezeit zwischen Geschwistern.

## Einschalten

1. Öffne **Card options**.
2. Unter **Card types** schalte **Cloze deletion cards** ein.
3. Wähle unter **Overlapping cloze** einen Stil.

Der Wähler bleibt deaktiviert, bis Cloze eingeschaltet ist.

## Die zwei Stile

Angenommen, du hast ein Notion-Toggle mit dem Titel **Pledge of Allegiance**, dessen Inhalt eine Aufzählungsliste ist:

- I pledge allegiance
- to the flag
- of the United States of America
- and to the republic for which it stands

Eine Liste aus 4 Elementen wird zu 4 Karten. Die Stile unterscheiden sich darin, wie viel der Liste jede Karte rund um die versteckte Zeile zeigt.

Eine fünfzeilige Liste, die durch ihre Karten wechselt:

**Show the whole list**

<overlapping-cloze-demo data-style="show-all"></overlapping-cloze-demo>

**Show nearby lines only**

<overlapping-cloze-demo data-style="windowed"></overlapping-cloze-demo>

**Show the whole list** hält jede Zeile sichtbar und versteckt jeweils eine. Die Karte für die dritte Zeile lautet:

> I pledge allegiance
> to the flag
> [...]
> and to the republic for which it stands

**Show nearby lines only** behält nur die Zeile davor und die Zeile danach und lässt den Rest weg. Die Karte für die dritte Zeile lautet:

> to the flag
> [...]
> and to the republic for which it stands

Die erste Zeile ist weg — du rufst die versteckte Zeile aus ihren direkten Nachbarn ab, nicht aus der ganzen Liste. Show the whole list ist am besten, wenn die volle Abfolge dein Gedächtnis anstößt; show nearby lines only ist näher an echter Rezitation.

## Funktioniert auch bei einem einzelnen Absatz

Ist eine Seite ein Absatz oder ein Zitat statt einer Liste, teilt überlappende Cloze sie für dich auf. Ein paar Sätze werden zu einer Karte pro Satz; ein einzelner Satz mit Kommas wird zu einer Karte pro Teilsatz. Umgebende Anführungszeichen und Guillemets werden zuerst entfernt.

Ein Zitat wie «You should not bother others, you should be kind, and otherwise do as you like» wird zu 3 Karten, jede versteckt einen Teilsatz.

Dasselbe gilt für ein Lied oder Gedicht, dessen Zeilen in getrennten Blöcken stehen — jede Zeile wird zu ihrer eigenen Karte.

## Was es auslöst

Überlappende Cloze wird ausgelöst, wenn die Antwort einer Karte eine Liste aus 2 oder mehr Elementen ist, oder wenn eine Seite ein einzelner Absatz ist, der sich in 2 oder mehr Sätze oder Teilsätze aufteilt. Ein einzelnes Element oder ein einzelner Teilsatz bleibt eine normale Karte. Andere Karten bleiben unberührt.

Das schließt Word-Dokumente ein. Ein .docx-Abschnitt — eine Überschrift gefolgt von einer Aufzählungsliste — wird normalerweise zu einer Karte pro Aufzählungspunkt, mit der Überschrift auf jeder Vorderseite. Mit eingeschalteter überlappender Cloze wird diese Liste stattdessen zu einer Cloze-Karte pro Aufzählungspunkt, die jeweils ihren eigenen Punkt verdeckt.

Das Ergebnis ist ein standardmäßiges Cloze-Deck — es lädt herunter, synchronisiert und lernt sich wie jedes andere.
