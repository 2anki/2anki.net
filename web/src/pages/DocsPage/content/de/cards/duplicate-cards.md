---
title: Deck aktualisieren, Lernfortschritt behalten
description: Warum erneutes Hochladen früher doppelte Karten erzeugte, was jede Karte stabil hält, und wie du vorhandene Kopien loswirst.
---

Bearbeite eine Notion-Seite, konvertiere sie erneut, und 2anki aktualisiert deine bestehenden Notion-Karten, statt dir eine zweite Kopie zu geben. Jede Karte trägt eine versteckte ID, und Anki nutzt diese ID, um eine bekannte Karte von einer neuen zu unterscheiden. Diese Seite erklärt, was diese ID setzt, was sie stabil hält, und was du tun kannst, wenn du bereits Duplikate hast.

Du hast schon Duplikate? [Direkt zum Aufräumen](#vorhandene-duplikate-aufräumen).

## Warum du jede Karte doppelt hattest

Karten wurden früher über ihren Text identifiziert. Ein einziges geändertes Wort, ein anderer Deck-Name oder eine geänderte Karten-Option, und die ID änderte sich mit. Auch dass Notion sein Exportformat stillschweigend geändert hat — passiert im Juli — hatte denselben Effekt. Anki las die geänderten Karten als brandneu und legte sie neben die Originale. So wurde aus einer kleinen Änderung eine komplette zweite Kopie des Decks.

Wenn du angemeldet bist, werden Karten aus Notion an dem Notion-Block verankert, aus dem sie stammen — der driftet nicht — und 2anki merkt sich diesen Anker unter deinem Konto. Ein Deck umzubenennen oder Optionen zu ändern berührt ihre Identität nicht mehr. Nur wirklich neuer Inhalt erzeugt neue Karten.

Du hast noch ein verdoppeltes Deck aus dem Juli? Räum es einmal auf (siehe unten), dann bleibt es sauber. Angemeldet kommen keine neuen Duplikate dazu, weil deine Karten bereits zu dem passen, was du importiert hast. Abgemeldet kann eine spätere Formatänderung von Notion ein Deck noch einmal aufspalten — dann einmal mehr aufräumen.

## Woran 2anki erkennt, dass eine Karte dieselbe ist

Melde dich vor dem Konvertieren an, dann merkt sich 2anki die ID jeder Karte unter deinem Konto — erneute Uploads landen auf denselben Karten, auch über Umbenennungen und Notion-Formatänderungen hinweg.

- **Angemeldet, Notion-Toggle-Uploads**: 2anki merkt sich die ID jeder Karte unter deinem Konto, verankert am Notion-Block, aus dem sie stammt (siehe Tabelle unten). Benenne das Deck um, formuliere eine Karte um oder exportiere nach einer Notion-Formatänderung neu — dein Lernfortschritt bleibt erhalten.
- **Abgemeldet, oder Karten ohne Notion-Block** (einfacher Text auf einer Seite, Markdown, CSV, Tabellen): Karten werden über den Deck-Namen und die Vorderseite identifiziert. Lass den Deck-Namen beim erneuten Hochladen gleich, und beachte: eine umformulierte Karte sieht Anki als neue. Lösch dann die alte Kopie.
- **Synchronisierte Notion-Seiten**: hier ändert sich nichts. Sync läuft immer unter deinem Konto und merkt sich jede Karte über ihren Notion-Block. Ändere den Text beliebig — dein Lernfortschritt bleibt.

## Was einen Notion-Toggle stabil hält

Notion gibt jedem Block eine eigene ID. Manche Aktionen behalten diese ID; einige ersetzen sie durch eine neue. Ist die ID neu, kann nichts 2anki sagen, dass es dieselbe Karte ist — Anki sieht eine neue Karte. Das ist Notions Verhalten, nicht etwas, das 2anki steuert.

| In Notion …                                         | Die ID des Toggles   | In Anki bekommst du                                                                      |
| --------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| Überschrift oder Inhalt direkt bearbeiten           | Bleibt gleich        | Die Karte wird aktualisiert, Lernfortschritt bleibt                                      |
| Auf der Seite ziehen oder umsortieren               | Bleibt gleich        | Keine Änderung                                                                           |
| Unter einen anderen Toggle einrücken oder ausrücken | Bleibt gleich        | Wird je nach Karten-Optionen eventuell eine eigene Karte — oder nicht mehr               |
| Ausschneiden und woanders einfügen                  | Wird neu             | Eine neue Karte. Die alte bleibt                                                         |
| Den Block duplizieren                               | Wird neu             | Eine neue Karte                                                                          |
| Auf eine andere Seite kopieren                      | Wird neu             | Eine neue Karte                                                                          |
| Löschen                                             | Existiert nicht mehr | Die Karte fehlt bei der nächsten Konvertierung; entferne sie in Anki, wenn du sie siehst |

Wenn du einen Toggle per Ausschneiden-und-Einfügen verschoben hast und jetzt ein Duplikat siehst — das ist der Grund. Um einen Toggle ohne neue Karte zu verschieben, zieh ihn stattdessen.

## Und das Deck selbst?

Anki ordnet Decks über den Namen zu, so wie Karten über die ID. Ändert sich der Name des Decks — weil die Seite umbenannt wurde oder sich ihr Emoji geändert hat — legt der nächste Import ein frisches Deck mit dem neuen Namen an. Deine bestehenden Karten bleiben, wo sie sind; nur neue Karten landen im frischen Deck. Im Juli hat eine Notion-Exportänderung kurzzeitig dazu geführt, dass 2anki das Emoji von selbst aus Deck-Namen entfernt hat — genau dieser Fall. Der Fehler ist behoben; Deck-Namen behalten ihr Emoji wieder. Passiert es aus einem anderen Grund, benenne das Deck in Anki vor dem Import auf den neuen Namen um, oder zieh die Streuner hinterher rüber und lösch das leere Deck.

## Ein Workflow für saubere Updates

- **Direkt bearbeiten.** Ändere den Text im Toggle, statt ihn zu löschen und neu zu schreiben.
- **Per Ziehen verschieben**, nicht ausschneiden und einfügen, wenn Karte und Lernfortschritt erhalten bleiben sollen.
- **Bei Nicht-Notion-Dateien den Deck-Namen stabil halten** und damit rechnen, dass eine umformulierte Vorderseite als neue Karte ankommt.
- **Notion-Decks frei umbenennen und Optionen ändern.** Beides berührt die Identität dieser Karten nicht mehr.
- **Mit Ankis Standardeinstellungen importieren.** Updates funktionieren ohne besondere Import-Optionen.

## Vorhandene Duplikate aufräumen

Echte Duplikate entstehen auf zwei Wegen: ein Deck, das sich während des Juli-Exportfehlers verdoppelt hat, oder — wenn du abgemeldet konvertierst — ein erneuter Upload, nachdem Notion etwas an der Seite geändert hat. Angemeldet landen Updates auf deinen bestehenden Karten, du sammelst also keine neuen Kopien.

So oder so: Behalten willst du die Kopien mit deinem Lernfortschritt:

1. Öffne in Anki **Browse**.
2. Wähle das Deck und klick auf die Spalte **Created**, um nach Erstellungsdatum zu sortieren. Rechtsklick auf die Spaltenüberschrift und die Spalte **Reviews** hinzufügen, falls sie fehlt.
3. Die gerade erstellten Kopien sind die Duplikate. Sie haben **0 Reviews**. Deine Originale sind die älteren, mit deinen echten Review-Zahlen.
4. Wähle die 0-Review-Kopien aus und lösch sie über **Notes → Delete** in der Menüleiste.

Zukünftige Re-Importe derselben Quelle aktualisieren die behaltenen Karten an Ort und Stelle.

Wenn beide Kopien Lernfortschritt haben, der dir wichtig ist, [melde dich bei uns](/documentation/help/contact), bevor du etwas löschst. Manchmal können wir sie zusammenführen.
