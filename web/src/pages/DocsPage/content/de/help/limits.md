---
title: Grenzen und Kontingente
description: Was auf jedem Plan erlaubt ist und wie lange deine Decks bleiben.
---

2anki.net ist für die Konvertierungsfunktionen kostenlos. Die Grenzen unten halten den gehosteten Dienst für alle schnell. Wenn du selbst hostest, kannst du sie ändern — siehe [Self-Hosting](/documentation/reference/self-hosting).

## Karten pro Monat

| Plan                    | Karten pro Monat     |
| ----------------------- | -------------------- |
| Anonym (kein Konto)     | 21 pro Konvertierung |
| Kostenloses Konto       | 100 pro Monat        |
| Subscription / Lifetime | Unbegrenzt           |

Das kostenlose Monatslimit zählt Karten über **jeden** Konvertierungsweg — Datei-Uploads, `.zip`, Notion, alle davon — nicht nur Notion. Der Zähler setzt sich zu Beginn jedes Kalendermonats zurück.

Ohne Konto ist jede Konvertierung auf 21 Karten begrenzt. Registriere ein kostenloses Konto, um die vollen 100 Karten pro Monat zu bekommen.

## Dateigröße

| Plan                    | Max. Upload-Größe  |
| ----------------------- | ------------------ |
| Free                    | 100 MB pro Anfrage |
| Subscription / Lifetime | ~10 GB pro Anfrage |

Free umfasst anonyme und angemeldete Nutzer ohne kostenpflichtigen Plan.

## PDF-Seiten

| Plan                    | Max. Seiten pro PDF |
| ----------------------- | ------------------- |
| Free                    | 100                 |
| Subscription / Lifetime | Keine feste Grenze  |

PDFs über dem kostenlosen Limit geben zurück: _PDF exceeds maximum page limit of 100 for free and anonymous users._

## KI-generierte Karteikarten

Die Kartenoption **Use Claude AI** ist eine Subscription-/Lifetime-Funktion. Kostenlose Konten sehen den Schalter, aber die Konvertierung fällt auf den Standard-Parser zurück.

## Chat

Der Chat-Lernassistent ist Teil jedes bezahlten Plans — Subscription, Day Pass und Lifetime. Mit einem kostenlosen Konto bleiben bisherige Unterhaltungen lesbar und bereits erstellte Decks herunterladbar; zum Senden von Nachrichten brauchst du einen Plan.

|                  | Free                               | Bezahlte Pläne  |
| ---------------- | ---------------------------------- | --------------- |
| Nachrichten      | — (bisherige Chats bleiben lesbar) | Unbegrenzt      |
| Nachrichtenlänge | —                                  | 100 000 Zeichen |

## Speicherung

Was „Speicherung“ bedeutet, hängt davon ab, welchen Weg du genutzt hast.

### Datei-Upload (ohne Claude AI)

Deine Datei liegt nur so lange auf der Festplatte, wie es dauert, das Deck zu bauen. Die `.apkg` wird direkt als Antwort zurückgeschickt — wir behalten keine Kopie. Die temporären Arbeitsdateien werden nach **zwei Stunden** gelöscht.

**Plan:** beliebig (anonym, kostenloses Konto, Subscription, Lifetime — dasselbe Zeitfenster für alle).

### Notion-Konvertierung und Claude-KI-Uploads

Diese Wege bauen dein Deck im Hintergrund und speichern die `.apkg` in unserem Bucket, damit du es unter **My Decks** erneut herunterladen kannst und damit [Sync](/documentation/sync/how-it-works) etwas zum Aktualisieren hat.

| Plan               | Wie lange deine Decks im Bucket bleiben                             |
| ------------------ | ------------------------------------------------------------------- |
| Kostenloses Konto  | In der nächsten täglichen Bereinigung entfernt (binnen 24 Stunden). |
| Subscription       | Behalten, solange dein Abo aktiv ist.                               |
| Lifetime (Patreon) | Unbegrenzt behalten.                                                |

Wenn dein Abo ausläuft, werden deine gespeicherten Decks in der nächsten täglichen Bereinigung entfernt — konvertiere erneut, und sie kommen zurück. Du kannst ein Deck auch jederzeit selbst unter **My Decks** löschen.

## Free vs. kostenpflichtig

Free deckt die Konvertierungswege ab, die die meisten Leute brauchen: eine Datei hineinziehen, ein Deck zurückbekommen. Die kostenpflichtigen Pläne fügen KI-generierte Karteikarten, größere Uploads, längere Speicherung und Notion-Sync hinzu.

| Fähigkeit                                      | Free            | Subscription    | Lifetime   |
| ---------------------------------------------- | --------------- | --------------- | ---------- |
| Karten pro Monat                               | 100 (21 anonym) | Unbegrenzt      | Unbegrenzt |
| Anonymer Datei-Upload                          | ✓               | ✓               | ✓          |
| Kontofunktionen (Verlauf, Favoriten, Vorlagen) | Anmeldung nötig | ✓               | ✓          |
| KI-generierte Karteikarten (Claude)            | —               | ✓               | ✓          |
| Chat (Lernassistent)                           | —               | Unbegrenzt      | Unbegrenzt |
| Langzeit-Deckspeicherung                       | 24 h            | aktives Abo     | unbegrenzt |
| Auto Sync (Notion → Anki)                      | —               | 30 $/Mo. Add-on | ✓          |

Siehe die [Preisseite](/pricing) für die aktuelle Planliste. Datenschutzdetails — was wir lesen, was nicht — findest du in der [Datenschutzerklärung](/documentation/reference/privacy).

Wenn etwas falsch aussieht, [kontaktiere uns](/documentation/help/contact).
