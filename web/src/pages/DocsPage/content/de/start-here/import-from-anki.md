---
title: Ein Anki-Deck in Notion importieren
description: Verwandle eine .apkg in Notion-Toggle-Seiten — kostenlos bis 1.000 Notizen pro Import.
---

Die Umkehrung von allem anderen, was 2anki macht. Du lädst eine bestehende `.apkg` hoch, und wir bauen die Karten als Toggles innerhalb einer Notion-Seite nach. Nützlich, um ein altes Deck zurück in bearbeitbare Notizen zu holen, oder um jemandem ein Lern-Deck zu geben, der in Notion statt in Anki arbeitet.

**Plan:** Kostenlos bis 1.000 Notizen pro Import. Abo und Lifetime heben das Limit auf 10.000 Notizen pro Import an.

## Wann du das nutzt

- Du hast ein Anki-Deck und willst die Karten als Notion-Inhalt, den du umschreiben kannst.
- Du gibst ein Lernset an ein Teammitglied oder eine Mitstudierende weiter, die schon in Notion lebt.
- Du willst ein Deck überarbeiten — Tippfehler beheben, Fragen umschreiben, Vorlagen ändern — und es dann über den normalen 2anki-Weg wieder herausgeben.

Das ist eine einmalige Kopie, kein Live-Sync. Änderungen in Notion nach dem Import fließen nicht in die originale `.apkg` zurück. Für laufenden Sync siehe [Wie Sync funktioniert](/documentation/sync/how-it-works).

## Den Import ausführen

1. Öffne [2anki.net/import](https://2anki.net/import). Wenn du Notion noch nicht verbunden hast, wirst du zuerst dorthin geschickt — siehe [Notion verbinden](/documentation/start-here/connect-notion).
2. Zieh deine `.apkg` auf den Upload-Bereich, oder klick, um eine auszuwählen. Hier funktionieren nur `.apkg`-Dateien.
3. Wähle ein Ziel:
   - **Quick import** erstellt eine neue „2anki Imports“-Seite in deinem Workspace.
   - **Choose a page** lässt dich den Import unter einer bestehenden Top-Level-Seite verschachteln. Es tauchen nur Seiten auf, die du mit der 2anki-Integration geteilt hast.
4. Klick auf **Import to selected page** (oder **Quick import**). Die Fortschrittsleiste zeigt Karten, während sie ankommen.
5. Wenn es fertig ist, klick auf **Open in Notion**, um direkt zur neuen Seite zu springen.

:::tip
Karten werden zu Toggles — die Vorderseite ist die Toggle-Zusammenfassung, die Rückseite ist der Inhalt darin. Cloze-Karten behalten ihre `{{c1::...}}`-Syntax, damit du sie später erneut importieren kannst.
:::

## Häufige Fehler

- **Falscher Dateityp.** Die Seite akzeptiert nur `.apkg`. Wenn du eine `.colpkg` (vollständiges Collection-Backup) hast, öffne sie zuerst in Anki und exportiere das gewünschte Deck als `.apkg`.
- **Deck über dem Notizen-Limit.** Ein großer Import schlägt nicht fehl: Er bringt die ersten 1.000 Notizen im kostenlosen Plan (10.000 bei Abo und Lifetime) und fügt oben auf der Seite einen Hinweis hinzu. Um den Rest zu importieren, teile das Deck in Anki (Rechtsklick → **Export** mit einer gefilterten Teilmenge) und importiere jeden Teil, oder [upgrade](/pricing) für das höhere Limit.
- **Seite nicht in der Auswahl.** Die Ziel-Auswahl zeigt nur Seiten, auf die die 2anki-Integration Zugriff hat. Öffne die Seite in Notion → **Share** → **Add connections** → wähle **2anki**.

## Verwandt

- [Notion verbinden](/documentation/start-here/connect-notion) — die Workspace-Verbindung, die dieser Weg nutzt
- [Grenzen und Kontingente](/documentation/help/limits) — was jeder Plan enthält
- [Preise](/pricing) — das Import-Limit auf 10.000 Notizen anheben
