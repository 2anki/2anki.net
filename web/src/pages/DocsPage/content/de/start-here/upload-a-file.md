---
title: Stattdessen eine Datei hochladen
description: Für PDFs, Folien, Tabellen oder einen Notion-HTML-Export.
---

<figure>
  <iframe
    src="https://www.youtube.com/embed/y3Fcx-WGWnA"
    title="2anki — make Anki cards from your Notion toggles in 30 seconds"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen
    width="100%"
    style="aspect-ratio: 16 / 9; border: 0; border-radius: var(--radius-md);"
  ></iframe>
</figure>

Der Upload funktioniert ohne Konto. Du wirfst eine Datei hinein, 2anki baut das Deck, und du lädst eine `.apkg` herunter. Gut für einmalige Konvertierungen oder Quellen, die nicht in Notion liegen.

Ohne Konto ist jede Konvertierung auf 21 Karten begrenzt. Registriere ein kostenloses Konto, um 100 Karten pro Monat über alle Konvertierungswege zu bekommen. Siehe [Grenzen und Kontingente](/documentation/help/limits).

**Plan:** Kostenlos (anonym, keine Anmeldung nötig)

## Wann Upload statt Notion verbinden

Lade hoch, wenn:

- Die Quelle ein PDF, eine Foliensammlung, eine Tabelle, eine CSV oder eine Markdown-Datei ist.
- Du keinen Notion-Workspace hast oder die Seite nicht in Notion liegt.
- Du eine schnelle Einmal-Konvertierung willst und keine künftigen Änderungen ins Deck fließen sollen.

Nutze [Notion verbinden](/documentation/start-here/connect-notion), wenn die Quelle eine Notion-Seite ist und das Deck sich beim Bearbeiten aktualisieren soll.

## Eine Datei hineinwerfen

1. Geh zu [2anki.net/upload](https://2anki.net/upload).
2. Zieh deine Datei auf den Ablagebereich, oder klick, um eine auszuwählen.
3. Öffne das Einstellungspanel, wenn du Kartenoptionen ändern möchtest. Die Standardwerte sind für die erste Nutzung abgestimmt — siehe [Kartenoptionen](/documentation/cards/card-options) für die Bedeutung jeder Option.
4. Klick auf **Convert**. Wenn es fertig ist, klick auf **Download**, um die `.apkg` zu holen.
5. Öffne die Datei in Anki — siehe [Öffne dein Deck in Anki](/documentation/start-here/open-in-anki).

## Von Dropbox oder Google Drive hochladen

Wenn deine Datei in einem Cloud-Speicher liegt, musst du sie nicht erst herunterladen.

- **Dropbox** — klick auf **Choose from Dropbox** im Upload-Bildschirm, melde dich einmal an, und wähle die Datei. Die Auswahl unterstützt dieselben Formate wie der reguläre Upload.
- **Google Drive** — klick auf **Choose from Google Drive**. Du kannst jede Datei wählen, die 2anki akzeptiert, plus native Google Docs, Sheets und Slides. Native Google-Dateien werden zuerst in eine Aufzählungs-Gliederung umgewandelt — siehe [Häufige Probleme](/documentation/help/common-problems#my-google-doc-converted-to-0-cards) für die Struktur, die Karten erzeugt.

Beide Schaltflächen sind nur sichtbar, wenn die Integration für die Seite, auf der du bist, konfiguriert ist. Wenn du sie nicht siehst, zieh die Datei stattdessen von deinem Computer hinein.

:::tip
Toggle-Listen ergeben die saubersten Karten. Wenn deine Quelle einfacher Fließtext ist, funktioniert die Konvertierung trotzdem, aber du bekommst bessere Ergebnisse aus einer Struktur, in der jede Karte ein Toggle, ein Aufzählungspaar oder eine Zeile ist.
:::

## Unterstützte Typen

Die vollständige Tabelle der Formate und Grenzen findest du unter [Dateiformate](/documentation/reference/file-formats). Kurzfassung:

- **Notion-HTML-Export** (`.zip`) — das `.zip`, das Notion dir gibt, wenn du mit „HTML“ + „Include subpages“ exportierst.
- **HTML** — eine einzelne `.html`-Datei oder ein Ordner davon.
- **Markdown** — `.md`, einschließlich Obsidian-Vaults.
- **CSV / XLSX** — eine Zeile pro Karte.
- **PDF** — Vorder-/Rückseite pro Seitenpaar, oder KI-generierte Fragen im kostenpflichtigen Plan.
- **PPT / PPTX** — eine Karte pro Folie: Der Folientitel ist die Vorderseite, Stichpunkte, Folienbild und Notizen die Rückseite. Folien ohne Text behalten das Seitenpaar-Layout.

Wirf das falsche Format hinein, und 2anki sagt es dir. Die Fehlermeldung nennt die unterstützten Typen, damit du nicht raten musst.

## Was mit deiner Datei passiert

Wir brauchen die Datei nur so lange, um sie zu konvertieren. Danach:

- **Anonyme und kostenlose Konto-Uploads** — die temporären Arbeitsdateien werden innerhalb von zwei Stunden gelöscht. Die `.apkg` wird direkt als Antwort zurückgeschickt, wir behalten also keine Kopie.
- **Claude-KI-Uploads und Notion-Konvertierungen** werden in deinem Konto gespeichert, damit du sie unter **My Decks** erneut herunterladen kannst. Kostenlose Konten: innerhalb von 24 Stunden entfernt. Abo: behalten, solange dein Abo aktiv ist. Lifetime: unbegrenzt behalten.
- Wir lesen deine Inhalte aus keinem anderen Grund als dem Bau deines Decks. Wir trainieren keine Modelle damit.

Die ganze Geschichte findest du in der [Datenschutzerklärung](/documentation/reference/privacy). Die harten Zahlen stehen unter [Grenzen und Kontingente](/documentation/help/limits).
