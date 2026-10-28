---
title: Häufige Probleme
description: Die Fehler, die Nutzer wirklich treffen, mit der Lösung auf derselben Seite.
---

Wenn du einen Fehler gesehen hast und die Lösung willst, finde die Überschrift unten, die zu dem passt, was du gesehen hast. Wenn dein Problem nicht dabei ist, [kontaktiere uns](/documentation/help/contact) oder [melde einen Fehler](/documentation/help/bug-report).

Die Fehlermeldungen unten sind in Anführungszeichen genau so belassen, wie 2anki sie ausgibt.

## Is 2anki down?

Prüfe die [Statusseite](/status) — sie zeigt, ob API, Datenbank und Notion-Verbindung gesund sind. Wenn die Seite selbst nicht erreichbar ist, ist der Server wahrscheinlich down; sieh in der Community auf Reddit nach Updates.

## "Please select a file to upload."

**Was du gesehen hast.** Ein roter Fehler erscheint in dem Moment, in dem du absendest, bevor irgendetwas hochlädt.

**Warum es passiert ist.** Das Formular wurde ohne angehängte Datei gesendet.

**Wie du es behebst.** Zieh eine Datei auf den Upload-Bereich oder klick darauf, um eine von deinem Computer auszuwählen. Siehe [unterstützte Formate](/documentation/reference/file-formats).

## "The uploaded file appears to be invalid. Please try again."

**Was du gesehen hast.** Der Upload startet, schlägt aber sofort fehl.

**Warum es passiert ist.** Der Browser hat eine Datei ohne Namen gesendet. Das passiert meist, wenn eine Erweiterung oder ein Hintergrundprozess den Upload abfängt.

**Wie du es behebst.** Versuch einen anderen Browser, oder deaktiviere Erweiterungen, die Downloads oder Uploads berühren (Datenschutz-Tools, „Save-to-cloud“-Erweiterungen). Häng die Datei dann erneut an.

## "[file] appears to be empty. Please re-export your file and try again."

**Was du gesehen hast.** Der Upload gibt diese Meldung mit dem Namen deiner Datei zurück.

**Warum es passiert ist.** Die Datei hat 0 Byte — meist, weil ein Export stillschweigend fehlgeschlagen ist oder die Datei kopiert wurde, während die Quell-App noch schrieb.

**Wie du es behebst.** Exportiere erneut aus der Quelle (Notion, Obsidian, Excel usw.). Bestätige, dass die Datei Inhalt hat, indem du sie vor dem Hochladen lokal öffnest.

## "[file] is already an Anki deck. 2anki converts source files like Notion HTML exports, not existing decks."

**Was du gesehen hast.** Du hast versucht, eine `.apkg` hochzuladen.

**Warum es passiert ist.** 2anki erstellt Anki-Decks; es liest sie nicht. Eine bestehende `.apkg` hochzuladen ist kein Weg, den wir unterstützen.

**Wie du es behebst.** Lade die Quelle hoch, aus der du das Deck gemacht hast (HTML-Export, Markdown, PDF, CSV) — nicht das Deck selbst. Um eine `.apkg` zu öffnen, die du schon hast, siehe [Öffne dein Deck in Anki](/documentation/start-here/open-in-anki). Um es als PDF zu drucken oder zu teilen, nutze [Print Decks](/print).

## "PDF exceeds maximum page limit of 100 for free and anonymous users."

**Was du gesehen hast.** Ein PDF-Upload schlägt direkt nach dem Absenden fehl.

**Warum es passiert ist.** Kostenlose Konten begrenzen PDFs auf 100 Seiten, wenn die Seiten zu Bildkarten werden, damit die Konvertierung schnell und kostenlos bleibt.

**Wie du es behebst.** Teile das PDF in kleinere Dateien (jeder PDF-Reader hat eine „Teilen“-Option), oder [abonniere](/pricing), um die Grenze zu entfernen. Siehe [Grenzen und Kontingente](/documentation/help/limits) für die vollständige Liste.

## "This PDF is password-protected."

**Was du gesehen hast.** Du hast ein PDF hochgeladen, und der Upload-Bereich wechselte zu einem Passwortfeld mit dem Dateinamen darüber.

**Warum es passiert ist.** Das PDF wurde mit einem Öffnen-Passwort erstellt — Anki kann es nicht lesen, und 2anki auch nicht, bis du es entsperrst.

**Wie du es behebst.** Tipp das Passwort ins Feld und klick auf **Unlock**. Die Datei wird im Speicher entschlüsselt, konvertiert, und das Passwort wird verworfen — wir speichern es nicht. Wenn du das Passwort nicht kennst, frag denjenigen, der das PDF geteilt hat, oder entferne das Passwort in deinem PDF-Reader (die meisten Reader haben eine Option **File → Save as → Properties → Security → No Security**) und lade erneut hoch.

Wenn du irgendwo anders klickst und das Feld verschwindet, wirf die Datei erneut hinein — die Passwortabfrage kommt zurück.

## Notion Markdown export produces 0 cards

**Was du gesehen hast.** Du hast eine Notion-Seite als Markdown exportiert und hochgeladen, aber 0 Karten bekommen — obwohl die Seite Toggles hat.

**Warum es passiert ist.** Notions Markdown-Export flacht Toggle-Blöcke in einfachen Text ab. Die Toggles, die 2anki in Karteikarten verwandelt, werden aus der Datei entfernt, bevor sie den Konverter erreicht.

**Wie du es behebst.** Exportiere dieselbe Seite aus Notion stattdessen als **HTML**. Die Toggles bleiben in HTML erhalten und konvertieren korrekt.

## "Could not create a deck using your file and rules."

**Was du gesehen hast.** Der Upload wird abgeschlossen, erzeugt aber kein Deck.

**Warum es passiert ist.** 2anki konnte nichts finden, das wie eine Karteikarte aussieht. Standardmäßig sucht es nach Toggle-Blöcken; ohne Toggles musst du eine andere Option aktivieren.

**Wie du es behebst.** Öffne [Kartenoptionen](/documentation/cards/card-options) und schalte die Option ein, die zu deiner Quelle passt — für Markdown-Aufzählungshierarchien **Markdown Nested Bullet Points**; für Notion-Exporte ohne Toggles strukturiere deine Quelle um, oder [kontaktiere uns](/documentation/help/contact) mit einem Beispiel.

## "Claude couldn't find any content to turn into flashcards in this Notion page."

**Was du gesehen hast.** Du hast die Claude-KI-Generierung aktiviert, und die Konvertierung schlug mit dieser Meldung fehl.

**Warum es passiert ist.** Die Seite, die Claude erhalten hat, war leer oder enthielt nur Layout-Elemente (Buttons, Platzhalter) — nichts, das es in eine Frage verwandeln konnte.

**Wie du es behebst.** Füge der Seite Überschriften mit Erklärungen, Toggle-Listen oder Frage-und-Antwort-Text hinzu, und konvertiere dann erneut.

## A Notion page won't show up in the picker

**Was du gesehen hast.** Du hast Notion verbunden, aber eine Seite, die du konvertieren willst, ist nicht aufgelistet.

**Warum es passiert ist.** Notion teilt nur Seiten, denen du der 2anki-Integration ausdrücklich Zugriff gegeben hast.

**Wie du es behebst.** Öffne die Seite in Notion → **Share** → **Add connections** → wähle **2anki**. Aktualisiere dann die Auswahl.

## My Google Doc converted to 0 cards

**Was du gesehen hast.** Du hast ein Doc aus Google Drive gewählt, die Konvertierung wurde abgeschlossen, und das Deck hat keine Karten.

**Warum es passiert ist.** 2anki liest Docs als Aufzählungs-Gliederungen. Ein Top-Level-Aufzählungspunkt wird zur Frage; darunter eingerückte Punkte werden zur Antwort. Docs, die als fließende Absätze geschrieben sind, oder mit Aufzählungspunkten, die alle auf derselben Einrückungsebene sitzen, geben uns keine Frage-und-Antwort-Struktur, aus der wir Karten machen können. Überschriften, gefolgt von Absätzen, funktionieren auch, aber nur, wenn jede Überschrift einen Absatz darunter hat.

**Wie du es behebst.** Öffne dein Doc, strukturiere den Inhalt als Aufzählungspunkte um, bei denen jede Frage auf der obersten Ebene steht und die Antwort einen Schritt darunter eingerückt ist, und wähle dann das Doc erneut. Das vollständige Aufzählungsbeispiel steht auf der Seite [Dateiformate](/documentation/reference/file-formats).

## Some images are missing from my deck

**Was du gesehen hast.** Karten erscheinen, aber Bilder sind kaputt.

**Warum es passiert ist.** Du hast wahrscheinlich eine einzelne `.html`-Datei statt des vollständigen `.zip` hochgeladen. Notions HTML-Export verweist auf Bilder in einem `assets/`-Ordner, und wenn du nur die `.html` hochlädst, bleiben die Bilder zurück.

**Wie du es behebst.** Lade stattdessen das originale `.zip` hoch. Wenn dein Browser Zips automatisch entpackt, schalte das aus — in Safari, **Preferences → General**, deaktiviere **Open "safe" files after downloading**.
