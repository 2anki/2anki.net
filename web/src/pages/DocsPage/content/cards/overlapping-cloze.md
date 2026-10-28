---
title: Overlapping cloze
description: Turn a list or a paragraph into a set of cards that hide one item at a time.
---

When you're memorizing an ordered sequence — the steps of a process, the cranial nerves, the lines of a poem — you want to drill it line by line: hide one item, recall it with the surrounding lines in view, then move to the next. Overlapping cloze turns a single list into exactly that set of cards.

Each card hides one item with a cloze deletion. One cloze per card, so Anki schedules each line on its own — no waiting a day between siblings.

## Turn it on

1. Open **Card options**.
2. Under **Card types**, turn on **Cloze deletion cards**.
3. In **Overlapping cloze**, pick a style.

The picker stays disabled until Cloze is on.

## The two styles

Say you have a Notion toggle titled **Pledge of Allegiance** whose contents are a bulleted list:

- I pledge allegiance
- to the flag
- of the United States of America
- and to the republic for which it stands

A list of 4 items becomes 4 cards. The styles differ in how much of the list each card shows around the hidden line.

A five-line list, cycling through its cards:

**Show the whole list**

<overlapping-cloze-demo data-style="show-all"></overlapping-cloze-demo>

**Show nearby lines only**

<overlapping-cloze-demo data-style="windowed"></overlapping-cloze-demo>

**Show the whole list** keeps every line visible, hiding one at a time. The card for the third line reads:

> I pledge allegiance
> to the flag
> [...]
> and to the republic for which it stands

**Show nearby lines only** keeps just the line before and the line after, dropping the rest. The card for the third line reads:

> to the flag
> [...]
> and to the republic for which it stands

The first line is gone — you recall the hidden line from its immediate neighbours, not the whole list. Show the whole list is best when the full sequence jogs your memory; show nearby lines only is closer to true recitation.

## Works on a single paragraph too

If a page is one paragraph or quote instead of a list, overlapping cloze splits it for you. A few sentences become one card per sentence; a single sentence with commas becomes one card per clause. Surrounding quote marks and guillemets are stripped first.

A quote like «You should not bother others, you should be kind, and otherwise do as you like» becomes 3 cards, each hiding one clause.

The same goes for a song or poem whose lines sit in separate blocks — each line becomes its own card.

## What fires it

Overlapping cloze fires when a card's answer is a list of 2 or more items, or when a page is a single paragraph that splits into 2 or more sentences or clauses. A single item or clause stays a normal card. Other cards are untouched.

This includes Word documents. A .docx section — a heading followed by a bullet list — normally converts to one card per bullet, with the heading on each front. With overlapping cloze on, that list becomes one cloze card per bullet instead, each hiding its own bullet.

The result is a standard Cloze deck — it downloads, syncs, and studies like any other.
