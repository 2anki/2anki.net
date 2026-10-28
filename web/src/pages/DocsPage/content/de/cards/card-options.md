---
title: Kartenoptionen
description: Jedes Kästchen auf dem Upload-Bildschirm, was es macht und wann du es einschaltest.
---

Kartenoptionen ändern, wie 2anki deine Quelle in Karteikarten verwandelt. Die meisten sind Aus-oder-Ein-Schalter. Die Standardwerte sind so abgestimmt, dass ein frischer Upload "einfach funktioniert" — fass sie an, wenn du eine andere Deck-Form willst.

## Wie du Optionen setzt

- **Auf dem Upload-Bildschirm** — klick auf das Einstellungssymbol neben dem Upload-Bereich, um jede Option für diese Konvertierung zu sehen.
- **In den Kontoeinstellungen** — `Settings → Card options` speichert Standardwerte, die für jeden neuen Upload gelten. Du kannst sie pro Upload trotzdem überschreiben.
- **Pro Notion-Seite** — wenn du über die Notion-Integration konvertierst, werden Optionen gegen die Seite gespeichert, sodass der nächste Sync dieselbe Form nutzt.

## Deck-Form

| Option          | Standard             | Was sie macht                                                                                                                              |
| --------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Deck name       | —                    | Eigener Name für die heruntergeladene `.apkg`. Leer lassen, um den Namen der Quelle zu nutzen.                                             |
| Font size       | 20                   | Grundschriftgröße für Kartentext, in Pixeln.                                                                                               |
| Text color      | Default              | Wähle aus einer Menge lesbarer Farben oder behalte Default, um Ankis Theme zu folgen, damit Text im hellen und Nachtmodus lesbar bleibt.   |
| Text alignment  | Default              | Zwing Kartentext nach links, in die Mitte oder nach rechts. Behalte Default, um die eigene Ausrichtung der Vorlage unangetastet zu lassen. |
| Toggle mode     | Close nested toggles | Steuert, ob verschachtelte Toggles auf der Kartenrückseite offen oder geschlossen gerendert werden.                                        |
| Page emoji      | Icon first           | Wo das Seiten-Emoji im Deck-Titel erscheint — zuerst, zuletzt oder deaktiviert.                                                            |
| Basic note type | `n2a-basic`          | Der Anki-Notiztyp-Name, den 2anki für Basic-Karten nutzt. Ändere ihn, um deine eigene Vorlage einzuklinken.                                |
| Cloze note type | `n2a-cloze`          | Dasselbe, für Cloze-Karten.                                                                                                                |
| Input note type | `n2a-input`          | Dasselbe, für Karten mit getippter Eingabe.                                                                                                |

## Karteninhalt

| Option                                          | Standard | Was sie macht                                                                                                                                                                              |
| ----------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Use All Toggle Lists                            | On       | Greift bei hochgeladenen Notion-Exporten auch Toggles in Listen, Callouts oder Spalten auf, nicht nur die auf oberster Ebene. Off bedeutet, nur Toggles auf oberster Ebene werden genutzt. |
| Use Plain Text for Back                         | Off      | Entfernt Formatierung von der Rückseite der Karten, sodass nur der Textinhalt bleibt.                                                                                                      |
| Maximum One Toggle Per Card                     | On       | Beschränkt jede Karte auf einen einzelnen Toggle der obersten Ebene. Verschachtelte Toggles bleiben auf der Rückseite der übergeordneten Karte, nicht als eigene Karten.                   |
| Nested Toggles Become Their Own Cards           | Aus      | Macht jeden Toggle, der in einem anderen steckt, zu einer eigenen Karte, mit seinem Titel als Frage. Toggles ohne Inhalt werden übersprungen.                                              |
| Preserve Newlines in the Toggle Header and Body | On       | Behält SHIFT-Enter-Zeilenumbrüche in Toggles, statt sie zusammenzufalten.                                                                                                                  |
| Markdown Nested Bullet Points                   | On       | Liest Markdown-Aufzählungshierarchien (Obsidian-Stil) als Vorder-/Rückseiten-Paare.                                                                                                        |
| Disable Indented Bullets                        | Off      | Verhindert, dass eingerückte Aufzählungen jeweils zu ihrer eigenen Karte werden.                                                                                                           |

Ein Toggle, der in einem anderen verschachtelt ist, zählt als Antworttext der übergeordneten Karte und bleibt deshalb auf deren Rückseite (offen oder eingeklappt, je nach **Toggle mode**), statt eine eigene Karte zu werden. Damit jeder Toggle eine eigene Karte wird, lass sie auf oberster Ebene statt sie zu verschachteln. Nur bei einem hochgeladenen Notion-Export (nicht bei der Notion-Sync-Integration) kannst du außerdem **Cherry-pick** aktivieren und jeden verschachtelten Toggle mit 🍒 markieren, oder mit **Nested toggles with inline code become their own cards** (braucht **Cloze Deletion**) einen verschachtelten Toggle, dessen Titel Inline-`code` enthält, zu einer eigenen Cloze-Karte machen.

## Kartentypen

| Option                       | Standard | Was sie macht                                                                                               |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| Cloze Deletion               | On       | Erstellt Cloze-Karten aus Inline-`code`-Schnipseln.                                                         |
| Treat Bold Text as Input     | Off      | Fetter Text wird entfernt und in ein Feld mit getippter Antwort verwandelt. Gut für Faktenabruf.            |
| Basic and Reversed           | Off      | Erstellt die Vorder-/Rückseiten-Karte und eine umgekehrte Kopie.                                            |
| Just the Reversed Flashcards | Off      | Erstellt nur die umgekehrte Karte. Nützlich, wenn die Rückseite als Prompt nützlicher ist (z. B. ein Bild). |

## Filtern

| Option                                                           | Standard | Was sie macht                                                                                                                                                 |
| ---------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enable Cherry Picking Using 🍒 Emoji                             | Off      | Erstellt nur Karten aus Toggles, die ein 🍒-Emoji enthalten. Nützlich, um ein paar Karten aus einer langen Seite herauszupicken.                              |
| Only Create Flashcards From Toggles That Don't Have The 🥑 Emoji | Off      | Überspringt Toggles, die ein 🥑-Emoji enthalten. Nützlich, um Teile einer Seite als noch-nicht-fertig zu markieren.                                           |
| Treat Strikethrough as Tags                                      | Off      | Behandelt durchgestrichenen Text als Anki-Tags. Durchgestrichenes in einem Toggle wird zu einem Tag lokal für diese Karte; außerhalb ist es ein globaler Tag. |

## Links und Formatierung

| Option                                        | Standard | Was sie macht                                                                                                   |
| --------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| Add Notion Link                               | Off      | Fügt einen Link zur Notion-Seite hinzu, auf der das Toggle erstellt wurde.                                      |
| Remove Underlines                             | Off      | Entfernt Unterstreichungsformatierung. Hilft, wenn Notion-Unterstreichungen mit Ankis Link-Styling kollidieren. |
| Remove the MP3 Links Created From Audio Files | On       | Entfernt die automatisch erzeugten `.mp3`-Links, die manche Notion-Exporte hinterlassen.                        |

## Codeblöcke

| Option     | Standard | Was sie macht                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code theme | GitHub   | Setzt die Syntaxhervorhebungsfarben für Code in deinen Karten. Wähle GitHub, One Dark, Solarized oder Dracula. Jedes wechselt zwischen einer hellen und dunklen Palette, um zu deinem Anki-Theme zu passen. Volle Färbung braucht die Notion-Verbindung — HTML- und ZIP-Uploads verlieren die Sprache, sodass hochgeladener Code den gefärbten Container ohne Farben pro Token behält. |

## PDF und KI

| Option                                | Standard | Was sie macht                                                                                                                                                                                                                                               |
| ------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process PDF Files                     | On       | Konvertiert PDFs aus ZIP-Uploads und fügt jeder PowerPoint-Karte das Bild ihrer Folie hinzu. Aus: ZIP-Uploads sind schneller fertig, aber PowerPoint-Karten verlieren ihre Folienbilder, und ältere .ppt-Dateien und Folien ohne Text ergeben keine Karten. |
| Generate Flashcards with Claude AI    | Off      | Schickt Inhalt an Anthropic Claude und nutzt dessen Ausgabe als Deck. Kostenpflichtig.                                                                                                                                                                      |
| User instructions                     | —        | Freiform-Prompt, der an Claude geschickt wird, wenn **Generate Flashcards with Claude AI** ein ist. Beispiel: _"Focus on USMLE high-yield. Skip the introduction."_                                                                                         |
| Convert Image Quiz HTML to Anki Cards | Off      | Nutzt OCR, um Bild-und-Antwort-Paare aus HTML-Quizzen zu ziehen. Premium, experimentell.                                                                                                                                                                    |

## Medien

| Option                | Standard | Was sie macht                                                                                                                                                                                                                                              |
| --------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Embed images in cards | On       | Packt Bild-Bytes ins Deck, sodass Karten offline rendern. Ausschalten, um das Deck klein zu halten — Karten verweisen weiter über den Namen auf die Bilder, aber die Bytes werden nicht mitgeliefert. Nutze das, wenn ein Upload das Größenlimit erreicht. |

## Audio

Anki liest Karten mit seiner Stimme auf dem Gerät vor. Es wird keine Audiodatei zum Deck hinzugefügt — die Stimme spielt beim Lernen ab, und die Sprache muss auf dem Gerät installiert sein.

| Option                | Standard    | Was sie macht                                                                                                                                                                                                                                                                                         |
| --------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read cards aloud      | Off         | Erkennt die Sprache der Vorderseite automatisch. Japanisch, Koreanisch und Chinesisch werden erkannt; alles andere wird auf Englisch gelesen.                                                                                                                                                         |
| Pick a voice yourself | Don't speak | Wähle eine Sprache und welche Seite Anki liest — Vorderseite, Rückseite oder beide. Gilt für Basic-, Input- und Cloze-Karten. Eine Wahl hier hat Vorrang vor der automatischen Erkennung oben. Sprachen: English (US), Spanish, French, German, Japanese, Mandarin (Simplified), Portuguese (Brazil). |

Wenn die gewählte Sprache keine installierte Stimme auf dem Anki-Gerät hat, bleibt das Audio still.

Lernst du Japanisch? Siehe [Notion → Anki für Japanisch](/documentation/cards/notion-to-anki-japanese) dafür, wie abgebaute Sätze, Lesungen und angehängtes Audio hinüberkommen.

## Multiple Choice

Diese greifen nur, wenn **Enable MCQ** ein ist. Siehe [Multiple-Choice-Fragen](/documentation/cards/mcq) für den vollständigen Leitfaden.

| Option                     | Standard    | Was sie macht                                                                                                               |
| -------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| Enable MCQ                 | Off         | Erkennt Multiple-Choice-Toggles und erzeugt interaktive MCQ-Karten statt einfacher.                                         |
| TTS for the question       | Don't speak | Liest die Frage vor. Sprachen: English (US), Spanish, French, German, Japanese, Mandarin (Simplified), Portuguese (Brazil). |
| TTS for the correct answer | Don't speak | Liest die richtige Antwort vor. Dieselbe Sprachliste.                                                                       |
| TTS for extra              | Don't speak | Liest die Erklärung vor. Dieselbe Sprachliste.                                                                              |

## Debugging

| Option                                          | Standard | Was sie macht                                                                                                                                   |
| ----------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Share Files for Debugging When Conversion Fails | Off      | Wenn eine Konvertierung scheitert, schickt die Datei und Fehlerdetails an das 2anki-Team. Standardmäßig aus, um deine Notizen privat zu halten. |

## Interne Optionsschlüssel

Die Optionsschlüssel, die 2anki intern nutzt (praktisch, wenn du einen Fehlerbericht einreichst): `add-notion-link`, `all`, `paragraph`, `cherry`, `avocado`, `tags`, `cloze`, `enable-input`, `basic-reversed`, `reversed`, `no-underline`, `max-one-toggle-per-card`, `remove-mp3-links`, `perserve-newlines`, `process-pdfs`, `markdown-nested-bullet-points`, `disable-indented-bullets`, `image-quiz-html-to-anki`, `embed-images`, `claude-ai-flashcards`, `share-files-for-debugging`, `mcq-enabled`, `mcq-tts-question`, `mcq-tts-correct-answer`, `mcq-tts-extra`, `tts-auto-detect`, `tts-manual-lang`, `tts-manual-side`, `font-size`, `toggle-mode`, `code-theme`, `page-emoji`, `basic_model_name`, `cloze_model_name`, `input_model_name`, `user-instructions`.
