---
title: Photo to deck
description: Snap or upload a photo of your notes — textbook page, lecture slide, handwritten notes — and get an Anki deck back.
---

Photo to deck takes a single image and sends it to Claude's vision model, which reads the content and returns question-and-answer cards. The page is at [2anki.net/photo-to-deck](https://2anki.net/photo-to-deck).

**Plan:** Free plan gets 5 photos per month. Paid plans use AI credits.

## When to use this

- A textbook page, lecture slide, or photographed page of notes you want as flashcards.
- Handwritten notes — Claude reads cursive and printed handwriting reasonably well.
- A whiteboard photo from class or a study session.

If your source is already a file — PDF, markdown, a Notion page — use the standard upload flow on the home page instead. Photo to deck is for the moments where the easiest input is a photo.

## Build a deck

1. Open [2anki.net/photo-to-deck](https://2anki.net/photo-to-deck). You'll need to be signed in.
2. (Optional) Name the deck. The default uses the photo's filename.
3. Pick a card density (more on this below).
4. Add a photo. Two ways:
   - **Take a photo** — on a phone, this opens the rear camera directly.
   - **Drop or pick** — drag an image into the dropzone, or click to open a file picker.
5. (Optional) Toggle **Show source image on the back of each card** off if you only want text on the back. Default is on.
6. Click **Get flashcards**. The deck downloads as a `.apkg` when ready.

The page shows the number of cards extracted once the deck arrives. Open the file in Anki to import.

## Supported formats and size

- **Image types:** JPEG, PNG, WebP, GIF.
- **Size cap:** 10 MB per photo. If you hit the cap, take the photo at a lower resolution or compress it before upload.
- **Very large images** are also bounded by a token ceiling on the model side — if you see a "photo is too large" message even under 10 MB, the resolution is the issue, not the file size.

## Card density

The three chips under the deck name decide how many cards per image:

- **Sparse — 3 to 5 cards.** Diagrams, single-concept slides, vocabulary lists where you want headline facts only.
- **Balanced — 6 to 10 cards.** The default. Matches the typical output of the prior fixed prompt — start here.
- **Dense — 12 to 20 cards.** Textbook pages, dense lecture slides, photographed notes where you want every distinct fact fanned out.

The model targets the range; it doesn't always hit the exact count. Your choice is remembered between sessions on the same browser.

## What ends up on the card

- **Front:** the question or term Claude extracted from the image.
- **Back:** the answer or definition. If **Show source image on the back of each card** is on (default), the original photo is embedded under the answer text so you can verify against the source while reviewing.
- **Tags:** every card arrives with 1 to 3 topic tags drawn from the actual content — short, lowercase, snake_case (`enzymes`, `michaelis_menten`). Filter by tag in Anki's tag browser to study a subset.

## Free plan and quota

The free plan is capped at 5 photos per calendar month — vision calls cost real money on our side. When you hit the limit, the page shows how many you've used and a path to upgrade. The counter resets on the 1st of each month.

Paid plans (Subscription or Lifetime) draw on AI credits instead of the free monthly count — far more photos, up to your credit allowance.

## Tips for better results

- **Crop tight.** If only a quarter of the photo is the content you care about, crop it before upload. Claude wastes tokens (and your quota) reading the rest.
- **Daylight beats fluorescents.** Sharp, high-contrast photos extract more cleanly than dim or shadowed ones.
- **One slide per photo.** A photo of two textbook pages at once forces the model to choose what to prioritize. Two single-page photos usually beat one double-page photo.
- **Handwriting works — neat handwriting works better.** If yours is illegible to a friend, it'll be illegible to Claude too.
- **Tried Balanced and got too few cards?** Switch to Dense and re-upload. Re-running costs another quota point on the free plan, so pick the density before the first run when you can.

## When something doesn't work

- **"Photo is too large"** — the image's resolution exceeds the vision model's token ceiling. Reduce resolution or take a tighter crop.
- **"Free plan is 5 photos per month"** — you've hit the cap. Wait until the 1st, or upgrade.
- **The cards came back wrong or sparse** — try the same photo at a higher density. If Dense still produces too few cards, the image is probably too low-contrast for the model to read confidently. Retake with better light.
- **You'd rather draw your own card boundaries** on a diagram — use [Image occlusion](/documentation/cards/image-occlusion) instead. Photo to deck is for question-and-answer extraction; image occlusion is for spatial "what's behind the cover" cards.
