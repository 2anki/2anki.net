# Voice guide

Source of truth for every user-facing string in 2anki. If a copy decision isn't covered here, default to the shortest sentence that gives the user what they need.

**Register:** Stripe/Linear, not Muji/MoMA. This is a productivity tool — the voice is understated in *tone* (no performing, no cheering) but generous with *context* (counts, names, next steps). A quiet tool that tells you exactly what happened. Muji would say "Done"; we say "Done — 34 cards in Pharmacology." The restraint is emotional, not informational.

---

## Who we're writing for

Self-directed learners. Often students, professionals studying for certifications, language learners, autodidacts. They chose Anki on purpose. They are not beginners to the concept of studying — they know what spaced repetition is and why it works. They want their notes turned into cards fast, not a tutorial on learning theory.

They are busy. They are converting notes between tools, not browsing. Respect their time in every sentence.

## Voice in one line

Quietly confident. Specific. Direct. Understated in tone, generous with context.

## Six principles

### 1. Specific over generic

Name the thing. If you know the deck name, say it. If you know the count, show it. Generic copy feels like the product doesn't know what just happened.

- **No:** "Your content is ready"
- **Yes:** "Your deck is ready: Organic Chemistry Ch. 4"
- **No:** "An error occurred"
- **Yes:** "Couldn't read this Notion export"
- **No:** "File uploaded successfully"
- **Yes:** "12 cards found in Biochemistry.zip"

### 2. Direct, no hedging

Say what to do. Don't pad with qualifiers, apologies, or softeners. The user came here to do a thing — help them do it.

- **No:** "We hope you'll consider upgrading"
- **Yes:** "Upgrade for unlimited cards"
- **No:** "Please feel free to try again"
- **Yes:** "Try again"
- **No:** "You may want to check your file format"
- **Yes:** "Check your file format"

### 3. What happened + what to do

Every error and warning answers two questions: what went wrong, and what the user should do next. One without the other is incomplete.

- **No:** "Upload failed"
- **Yes:** "Upload failed — file is over the 50 MB limit. Try splitting it."
- **No:** "Invalid format"
- **Yes:** "This file type isn't supported. Use .zip, .html, .md, .csv, or .apkg."
- **No:** "Connection error"
- **Yes:** "Couldn't reach Notion. Check your connection and try again."

### 4. No fake warmth

Don't perform enthusiasm. A tool that works well doesn't need to cheer. Sincerity over excitement.

- **No:** "Awesome! Your deck is ready 🎉"
- **Yes:** "Your deck is ready."
- **No:** "Oops! Something went wrong"
- **Yes:** "Something broke on our end. Try again in a moment."
- **No:** "Yay! You're all set!"
- **Yes:** "Done."

### 5. Acknowledge the learner where it's natural — don't force it

The product exists in the learning ecosystem. Reference it when it adds meaning. Never when it's performative.

- **Yes:** "Built for spaced repetition" (on landing — positions the product)
- **Yes:** "245 cards from your export" (on a result screen — specific and useful)
- **No:** "Great job uploading!" (patronizing)
- **No:** "Let's learn together!" (forced familiarity)
- **No:** "Happy studying!" (sign-off fluff)

### 6. Understated, not silent

Let the result speak. Where most products add fanfare, we add data. The restraint is in the emotion, not the information — say less about how you feel, more about what happened.

- **No:** "Congratulations! Your account has been upgraded to Pro! 🎉 You now have access to all features."
- **Yes:** "Upgraded to Pro. Unlimited cards, PDF support, priority support."
- **No:** "We're thrilled to let you know your deck has been successfully created with 87 cards!"
- **Yes:** "87 cards. Ready to download."
- **No:** "Welcome back! We missed you."
- **Yes:** "Alexander Alemayhu" (just show who's logged in — no performance)

---

## Protected strings — do not rewrite

Some strings are controlled by external systems, legal requirements, or brand guidelines. Never change these during a copy sweep.

| String | Reason |
|--------|--------|
| OAuth button labels ("Sign in with Google", "Continue with Notion") | Dictated by provider brand guidelines |
| Stripe plan names and price display | Must match Stripe dashboard exactly |
| "100 cards per month" (marketing copy on `/pricing`) and `Your monthly limit: N cards` (in-product display) | Business constraint — any change requires explicit approval. In product UI (sidebar counter, banner, account), use the personal phrasing so the number can vary per user without lying. The marketing string on `/pricing` stays as-is for organic SEO and brand consistency. |
| "Anki", "AnkiWeb", "Notion", "Quizlet" | Third-party trademarks — spelling and capitalization are fixed |
| Terms of Service, Privacy Policy page content | Legal copy — changes require legal review |
| Email addresses (support@2anki.net) | Operational — don't rephrase or restyle |
| API error codes and technical identifiers | Consumed by code, not just humans |

When in doubt about whether a string is protected, flag it in ASK_HUMAN.md before rewriting.

---

## Showing user data inline

When the product displays user-generated names (deck titles, filenames, folder names), follow these rules:

**Formatting:**
- Render in medium weight (`font-weight: 500`) to distinguish from surrounding copy.
- No quotes around names in UI — the weight difference is enough. Use quotes only in plain-text contexts (emails, logs).
- Preserve the user's original casing. Never title-case or lowercase their text.

**Truncation:**
- Truncate with ellipsis (`…`) after 40 characters in tables and lists.
- Show full name in a `title` attribute on hover.
- Never truncate in success messages or error messages — if it's too long, wrap.

**Fallbacks:**
- If the name is empty or null, use the generic noun: "Untitled deck", "Untitled export".
- Never show "null", "undefined", or an empty string to the user.

---

## Numbers

**Numerals, not words.** Always use digits: "3 cards", not "three cards". Even for one: "1 card", not "one card". Exception: "once", "twice" in natural phrasing ("try once more").

**Thousands separator:** Use a thin space ( ), not a comma. The user base is international and EU-leaning — commas as thousands separators conflict with decimal commas. Examples: "1 200 cards", "12 450". Under 10 000, no separator needed: "9999".

**File sizes:** 1024-based math, consumer labels: KB, MB, GB (not the IEC KiB/MiB/GiB — those look wrong to non-technical users). Examples: "4.2 MB", "850 KB", "1.1 GB". One decimal place for MB and above. No decimals for KB.

**Durations and times:**
- Relative when recent: "2 minutes ago", "about an hour ago", "3 days ago".
- Absolute when old: "12 May 2026".
- Never "just now" — use "a moment ago" or show the actual time.

**Tabular numerals:** Use `font-variant-numeric: tabular-nums` (via CSS token `--tabular-nums`) on any column of numbers, prices, counts, or timestamps. This keeps digits aligned in tables and lists.

**Counts next to labels:** The number is the hero — render it one size up and in medium or semibold weight. The label stays in the base size. Example: **87** cards, not "87 cards" in uniform weight.

---

## Banned words and phrases

These words are banned from product UI copy. Marketing pages get slightly more latitude, but should still avoid them.

| Banned | Why | Use instead |
|--------|-----|-------------|
| Awesome, amazing, great | Fake enthusiasm | (drop the reaction entirely) |
| Oops, uh oh, whoops | Infantilizing | State the problem directly |
| Please feel free to | Hedging | (just say the thing) |
| We hope, we'd love to | Passive | (just say the thing) |
| Leverage, seamless, robust | Marketing filler | (be specific about what it does) |
| Powerful, cutting-edge | Unearned superlatives | (describe the capability) |
| Let's, now let's, don't forget to | Tutorial voice | Use imperative: "Export your page" |
| Exclamation marks | Overenthusiasm | Period. Reserve for genuine celebration (rare) |
| Emoji in product UI | Noise | Marketing pages can use one, rarely |
| Add-on, add on (for a 2anki plan or feature) | Means an installable Anki extension | "its own plan", "sold separately", or the plan's name |

---

## Capitalization

- **Sentence case** for buttons, headings, menu items, tab labels, and toast messages.
- **Proper nouns** stay capitalized: Notion, Anki, AnkiWeb, Quizlet, Markdown, PDF, CSV, HTML.
- **Product name** is "2anki" (lowercase a) in running text, "2anki.net" when referring to the site.

---

## Punctuation

- **Periods** on full sentences in helper text, descriptions, error messages, and empty states.
- **No periods** on button labels, menu items, headings, or short labels.
- **Em dashes** for asides — like this — not parentheticals where a dash flows better.
- **No ellipsis** for loading states. Write a real sentence: "Reading your export" not "Loading..."
- **Oxford comma** in lists: ".zip, .html, .md, and .csv".
