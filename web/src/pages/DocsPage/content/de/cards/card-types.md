---
title: Kartentypen
description: Die vier Kartenformen, die 2anki macht, und wann jede greift.
---

2anki erzeugt vier Kartenformen. Welche du bekommst, hängt davon ab, was in deiner Quelle steht — fetter Text wird zu einer getippten Antwort, Code wird zu einer Cloze, eine abgehakte Option in einem Toggle wird zu einem MCQ, und alles andere bleibt eine einfache Vorder-/Rückseiten-Karte.

**Plan:** Kostenlos (alle drei Kartentypen funktionieren in jedem Plan)

## Basic

Der Standard. Die Überschrift des Toggles wird zur Vorderseite; der Inhalt des Toggles wird zur Rückseite.

In Notion:

- Ein Toggle mit der Überschrift "What is the capital of Albania?" und "Tirana!" darin.

In Markdown (mit **Markdown Nested Bullet Points** ein):

```
- What is the capital of France?
  - Paris
```

In HTML:

```html
<details>
  <summary>What is the capital of Albania?</summary>
  <p>Tirana</p>
</details>
```

Du bekommst außerdem **Basic and Reversed** als Kartenoption — das erzeugt die Vorder-/Rückseiten-Karte und eine zweite Karte mit vertauschter Vorder- und Rückseite. Nützlich für Vokabeln. Siehe [Kartenoptionen](/documentation/cards/card-options).

## Cloze

Cloze versteckt einen Teil eines Satzes. Du siehst "The capital of France is [...]" und tippst oder rufst "Paris" ab.

2anki verwandelt Inline-Code in Clozes. Umschließe den versteckten Text mit Backticks (Markdown) oder `<code>`-Tags (HTML):

```
- The capital of `France` is `Paris`
```

```html
<details>
  <summary>The capital of <code>Albania</code> is <code>Tirana</code></summary>
</details>
```

### Cloze-Hinweise

Um statt `[...]` einen Hinweis zu zeigen, häng `::dein hinweis` nach der Antwort in der codeformatierten Cloze an. Der Hinweis nimmt auf der Vorderseite den Platz der Lücke ein, sodass du einen Anstoß bekommst, bevor du die Antwort abrufst.

```
- The capital of France is `Paris::capital`
```

Das rendert die Vorderseite als "The capital of France is [capital]", mit Paris als Antwort.

### Cloze aus Toggle-Inhalt

Code im Inhalt des Toggles kann auch zur Cloze werden. Wenn die Marker im Inhalt statt in der Überschrift stehen, wird der Inhalt zur Cloze und die Überschrift zum Hinweis:

```html
<details>
  <summary>European capitals</summary>
  <p>The capital of <code>Albania</code> is <code>Tirana</code></p>
</details>
```

Tabellen und Aufzählungslisten im Toggle behalten ihre Struktur in der resultierenden Karte. Das wird von der Kartenoption **Inline code toggles become cloze** gesteuert, die standardmäßig aus ist und **Cloze Deletion** eingeschaltet braucht. Lass sie aus, und ein Toggle mit Inline-Code in seinem Körper bleibt eine Basic-Karte — Überschrift auf der Vorderseite, Inhalt auf der Rückseite.

Ein Toggle, der in einem anderen Toggle verschachtelt ist, zählt normalerweise als Antworttext der übergeordneten Karte. Inline-Code in seinem Titel erscheint dann als Code auf deren Rückseite, statt zu einem Cloze zu werden. Schalte **Nested toggles with inline code become their own cards** ein (standardmäßig aus, braucht **Cloze Deletion**), und jeder verschachtelte Toggle mit Inline-Code im Titel wird zu einer eigenen Cloze-Karte, während die übergeordnete Karte den Titel als fetten Text behält:

```html
<details>
  <summary>Management of alcohol-related liver disease</summary>
  <details>
    <summary>Complete abstinence is the most important step</summary>
  </details>
  <details>
    <summary>
      To manage acute withdrawal use <code>benzodiazepines</code>
    </summary>
  </details>
</details>
```

Das ergibt eine Basic-Karte für den übergeordneten Toggle mit beiden Zeilen auf der Rückseite, plus eine Cloze-Karte "To manage acute withdrawal use [...]". Verschachtelte Toggles ohne Inline-Code bleiben in der übergeordneten Karte.

Du kannst auch Ankis native Cloze-Syntax direkt nutzen, wenn du explizite Nummerierung oder Hinweise willst:

```
{{c1::Canberra::city}} was founded in {{c2::1913::year}}
```

Die Kartenoption **Cloze Deletion** steuert, ob Code-als-Cloze greift — sie ist standardmäßig ein. Siehe [HTML](/documentation/cards/html) und [Markdown und Obsidian](/documentation/cards/markdown) für weitere Beispiele.

## Input

Input-Karten lassen dich die Antwort tippen. Du siehst die Frage, tippst, und Anki markiert sie durch exakte Übereinstimmung als richtig oder falsch.

Schalte **Treat Bold Text as Input** in den Kartenoptionen ein. Dann wird fetter Text auf der Rückseite zum Feld mit getippter Antwort:

```
- What is 21 + 21 = **42**
```

```html
<details>
  <summary>What is 21 + 21?</summary>
  <p><strong>42</strong></p>
</details>
```

Am besten für Fakten, bei denen die exakte Schreibweise zählt — Daten, Namen, Gleichungsergebnisse. Überspringe es für Definitionen oder alles, wo die Formulierung variieren kann.

## Multiple Choice

MCQ-Karten zeigen eine Vignette plus 2–7 Optionen; auf der Rückseite hebt sich die richtige Option grün hervor und die Erklärung wird aufgedeckt.

Verfasse eine, indem du ein Notion-Toggle machst, dessen Titel die Frage ist. Füge im Toggle einen To-do-Block pro Option hinzu (`/to-do`) und hake genau einen ab — oder füge eine Aufzählungsliste hinzu und setz den vollen Text genau einer Option fett. Die abgehakte oder fettgedruckte Option ist die richtige Antwort.

In Notions Markdown-Kürzeln:

```markdown
> Which antibiotic class inhibits cell wall synthesis?

    - [ ]  Fluoroquinolones
    - [x]  Beta-lactams
    - [ ]  Macrolides
    - [ ]  Aminoglycosides
```

Der vollständige Leitfaden mit schrittweisen Beispielen liegt auf [Multiple-Choice-Fragen](/documentation/cards/mcq).

MCQ ist opt-in. Schalte es **On** in [Kartenoptionen](/card-options) unter der Gruppe **Multiple choice**, dann lade hoch. Die Erkennung funktioniert auf Notion-HTML-Exporten und auf reinem Markdown. Toggles, die nicht zur MCQ-Form passen, fallen wie üblich auf Basic, Cloze oder Input zurück.

## Wie du zwischen ihnen wechselst

Du wählst keinen Kartentyp pro Karte. Du wählst eine Kartenoption, und 2anki wendet sie auf den ganzen Upload an:

- **Basic** ist der Standard, wann immer ein Toggle sonst nichts vorhat.
- **Cloze** greift automatisch, wenn **Cloze Deletion** ein ist (Standard) und dein Toggle Code enthält.
- **Input** greift, wenn **Treat Bold Text as Input** ein ist und dein Toggle fetten Text auf der Rückseite hat.
- **Multiple choice** greift, wenn die untergeordneten Blöcke eines Notion-Toggles To-do-Blöcke mit einem abgehakten sind, oder Aufzählungselemente mit einem voll fettgedruckten.

Wenn ein einzelnes Toggle sowohl Code als auch fetten Text hat, gewinnt Cloze. Wenn du eine andere Mischung willst, teile das Toggle in deiner Quelle.

Die vollständige Kartenoptionsliste mit Standardwerten steht auf [Kartenoptionen](/documentation/cards/card-options). Die Kartenvorlagen, die Anki nutzt (`n2a-basic`, `n2a-cloze`, `n2a-input`, `n2a-mcq`), sind im [Glossar](/documentation/reference/glossary) aufgeführt.
