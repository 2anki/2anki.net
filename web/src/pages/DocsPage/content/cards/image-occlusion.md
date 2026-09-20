---
title: Image occlusion
description: Cover parts of an image and recall them — anatomy, diagrams, maps, screenshots.
---

<figure>
  <iframe
    src="https://www.youtube.com/embed/roQ3awaVa2E"
    title="2anki — build an image occlusion deck on the web canvas"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen
    width="100%"
    style="aspect-ratio: 16 / 9; border: 0; border-radius: var(--radius-md);"
  ></iframe>
</figure>

Image occlusion cards show you a picture with bits hidden. You try to recall what's behind the cover, then flip the card to see if you got it right. The canvas tool at [2anki.net/image-occlusion](https://2anki.net/image-occlusion) lets you draw the covers yourself — no Anki add-on, no plugin install.

**Plan:** Free accounts can use any source, including Notion import, up to 3 images per deck. Subscription and Lifetime allow up to 20 uploaded images at a time.

## When to use this

- You're studying something visual where the layout itself is the answer — anatomy diagrams, brain regions, chemical structures, ECGs, maps, UI screenshots, code diagrams.
- A basic question/answer card would be slower than just seeing the picture and recalling the labels.
- You already have a diagram with labels and want to test yourself on those labels in place.

If your source is text — toggles, bullets, prose — basic or cloze cards are faster. Image occlusion is only worth the setup for genuinely spatial content.

## Build a deck

1. Open [2anki.net/image-occlusion](https://2anki.net/image-occlusion).
2. Name the deck (the field at the top of the left panel). Defaults to "My image deck".
3. Add images. Three ways:
   - **Upload** — drag images into the queue or use the file picker.
   - **Paste** — copy an image to your clipboard (screenshot tool, a Notion page, anywhere) and paste anywhere on the page.
   - **Import from Notion** — click the Notion button on the queue if you're signed in and connected. Pick images from your Notion pages. Free accounts can use this too, within the 3-images-per-deck cap.
4. Click an image in the queue to load it onto the canvas on the right.
5. Draw a rectangle on each part you want to hide. Each box becomes one flashcard. Add a label to each box if you want extra context on the card back.
6. (Optional) Add a header — short text above the image — to give the card a title or a question stem.
7. Repeat for every image in the queue.
8. Pick a mode at the bottom of the left panel:
   - **Hide all, reveal one** — every box is covered; only the one you're studying is shown when you flip.
   - **Hide one at a time** — only the box you're studying is covered; everything else stays visible.
9. Click **Download deck** to get the `.apkg`. Open it in Anki.

:::tip
The canvas is much easier to use on a laptop or desktop than on a phone. Anki review afterwards works fine on any device.
:::

## Drafts and saving

Signed-in users get auto-save: changes to deck name, mode, header, and boxes are saved as a draft every second or so. Close the tab and your work is still there when you come back. Drafts are removed after a successful download.

Anonymous users (no sign-in) can still build a deck and download it, but the work isn't saved between sessions.

## Hide all vs. hide one — what changes

For a single image with three labelled boxes, **Hide all** creates 3 cards: each card shows the image with all three boxes covered, with one box revealed on the back. **Hide one** creates 3 cards too, but each shows the image with two boxes visible and one covered, then the covered one revealed.

Use **Hide all** when knowing one label shouldn't give away the others (it's harder). Use **Hide one** when the surrounding labels are useful context (it's easier and faster).

## Common mistakes

- **No boxes drawn.** The **Download deck** button stays disabled until at least one image has a box on it. The card count next to the button is your guide — make sure it's not zero.
- **Tiny boxes.** A box smaller than ~20 pixels is hard to click on phone review. Draw covers that fit the thing you're hiding plus a little padding.
- **Trying to crop the image.** The boxes hide content; they don't crop. To trim the image, edit it before uploading.

## Related

- [Card types](/documentation/cards/card-types) — basic, cloze, input, MCQ
- [Card options](/documentation/cards/card-options) — the rest of the conversion settings
- [Limits and quotas](/documentation/help/limits) — what each plan includes
