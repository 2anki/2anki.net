---
title: Card types
description: The four card shapes 2anki makes, and when each fires.
---

2anki produces four card shapes. Which one you get depends on what's in your source — bold text becomes a typed answer, code becomes a cloze, a checked option in a toggle becomes an MCQ, and everything else stays as a basic front/back card.

**Plan:** Free (all four card types work on every plan)

## Basic

The default. The toggle's heading becomes the front; the toggle's contents become the back.

In Notion:

- A toggle with the heading "What is the capital of Albania?" and "Tirana!" inside.

In Markdown (with **Markdown Nested Bullet Points** on):

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

You also get **Basic and Reversed** as a card option — that creates the front/back card and a second card with front and back swapped. Useful for vocabulary. See [Card options](/documentation/cards/card-options).

## Cloze

Cloze hides part of a sentence. You see "The capital of France is [...]" and type or recall "Paris".

2anki turns inline code into clozes. Wrap the hidden text in backticks (Markdown) or `<code>` tags (HTML):

```
- The capital of `France` is `Paris`
```

```html
<details>
  <summary>The capital of <code>Albania</code> is <code>Tirana</code></summary>
</details>
```

### Cloze hints

To show a hint instead of `[...]`, append `::your hint` after the answer inside the code-formatted cloze. The hint takes the place of the blank on the front, so you get a nudge before you recall the answer.

```
- The capital of France is `Paris::capital`
```

That renders the front as "The capital of France is [capital]", with Paris as the answer.

### Cloze from toggle content

Code inside the toggle's content can become the cloze too. When the markers are in the content instead of the heading, the content becomes the cloze and the heading becomes the hint:

```html
<details>
  <summary>European capitals</summary>
  <p>The capital of <code>Albania</code> is <code>Tirana</code></p>
</details>
```

Tables and bulleted lists inside the toggle keep their structure in the resulting card. This is controlled by the **Inline code toggles become cloze** card option, which is off by default and needs **Cloze Deletion** turned on. Leave it off and a toggle with inline code in its body stays a basic card — heading on the front, content on the back.

A toggle nested inside another toggle is normally answer text for the parent card, so inline code in its title shows as code on the parent's back rather than becoming a cloze. Turn on **Nested cloze toggles become their own cards** (off by default, needs **Cloze Deletion**) and each nested toggle whose title has inline code becomes its own cloze card, while the parent card keeps that title as bold text:

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

That gives a basic card for the parent with both lines on the back, plus a cloze card "To manage acute withdrawal use [...]". Nested toggles without inline code stay folded into the parent.

You can also use Anki's native cloze syntax directly when you want explicit numbering or hints:

```
{{c1::Canberra::city}} was founded in {{c2::1913::year}}
```

The **Cloze Deletion** card option controls whether code-as-cloze fires — it's on by default. See [HTML](/documentation/cards/html) and [Markdown and Obsidian](/documentation/cards/markdown) for more examples.

## Input

Input cards make you type the answer. You see the question, type, and Anki marks it right or wrong by exact match.

Turn on **Treat Bold Text as Input** in card options. Then bold text on the back becomes the typed-answer field:

```
- What is 21 + 21 = **42**
```

```html
<details>
  <summary>What is 21 + 21?</summary>
  <p><strong>42</strong></p>
</details>
```

Best for facts where exact spelling matters — dates, names, equation results. Skip it for definitions or anything where wording can vary.

## Multiple choice

MCQ cards show a vignette plus 2–7 options; on the back, the correct option highlights green and the explanation reveals.

Author one by making a Notion toggle whose title is the question. Inside the toggle, add a to-do block per option (`/to-do`) and check exactly one — or add a bulleted list and bold exactly one option's full text. The checked or bolded option is the correct answer.

In Notion's markdown shortcuts:

```markdown
> Which antibiotic class inhibits cell wall synthesis?

    - [ ]  Fluoroquinolones
    - [x]  Beta-lactams
    - [ ]  Macrolides
    - [ ]  Aminoglycosides
```

The full guide with step-by-step worked examples lives on [Multiple choice questions](/documentation/cards/mcq).

MCQ is opt-in. Switch it **On** in [Card options](/card-options) under the **Multiple choice** group, then upload. Detection works on Notion HTML exports and on plain markdown. Toggles that don't match the MCQ shape fall through to Basic, Cloze, or Input as usual.

## How to switch between them

You don't pick a card type per card. You pick a card option, and 2anki applies it across the whole upload:

- **Basic** is the default whenever a toggle has nothing else going on.
- **Cloze** fires automatically when **Cloze Deletion** is on (default) and your toggle contains code.
- **Input** fires when **Treat Bold Text as Input** is on and your toggle has bold text on the back.
- **Multiple choice** fires when a Notion toggle's children are to-do blocks with one checked, or bulleted items with one fully bolded.

If a single toggle has both code and bold text, cloze wins. If you want a different mix, split the toggle in your source.

The full card option list with defaults is on [Card options](/documentation/cards/card-options). The card templates Anki uses (`n2a-basic`, `n2a-cloze`, `n2a-input`, `n2a-mcq`) are listed in the [glossary](/documentation/reference/glossary).
