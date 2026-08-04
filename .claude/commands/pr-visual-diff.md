# pr-visual-diff

Post **before/after visual evidence** (stills + GIFs) as a comment on a PR that changes CSS, design tokens, motion, or layout — captured headlessly with Playwright + ffmpeg, so a reviewer sees the change instead of reading a description of it.

First proven on PR #3372 (`/upload` theme-break + motion polish). Use it whenever a diff is visual and the win is hard to convey in words — especially **theme-dependent** color changes and **motion** changes, which a static description can't carry.

## When to use

- The PR changes rendered color/contrast (esp. per-theme tokens), spacing, shadows, or animation.
- A reviewer would benefit from seeing it, but the affected state is buried (a specific component state, a non-default theme, a transient animation).
- Skip for pure logic/refactor PRs with no rendered change.

## The method

### 1. Build an isolated harness — use the REAL tokens

For each change, write a standalone `harness.html` that `<link>`s the actual token stylesheet and sets the affected theme, so before/after render with **true per-theme values**, not guesses:

```html
<html data-theme="dark">   <!-- the theme where the bug shows; light/gold/purple/hotpink also valid -->
<link rel="stylesheet" href="file:///ABS/PATH/web/src/styles/base.css">
```

Render the changed rule twice, side by side: `.before` with the **old** declarations (copy them verbatim from the diff's `-` lines) and `.after` with the **new** tokens (the `+` lines). Faithfulness is the whole point — if the harness CSS drifts from the real diff, the evidence lies.

### 2. Capture with Playwright

Node script; `require` Playwright from the repo-root `node_modules` (pnpm hoists it there, not `web/`):

```js
const { chromium } = require('/ABS/PATH/node_modules/playwright');
// stills:  await page.locator('body').screenshot({ path })   (deviceScaleFactor: 2)
// motion:  newContext({ recordVideo: { dir, size } }) -> goto -> waitForTimeout(loops) -> page.video().path()
```

Run it with the repo-root resolution, e.g. `node /tmp/shots/capture.cjs`.

### 3. Motion → GIF (a still can't show easing or perpetual motion)

```bash
ffmpeg -y -i in.webm -vf "fps=20,scale=560:-1:flags=lanczos,palettegen=stats_mode=diff" pal.png -loglevel error
ffmpeg -y -i in.webm -i pal.png -lavfi "fps=20,scale=560:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer" out.gif -loglevel error
```

For a one-shot animation, re-trigger it on a `setInterval` in the harness so the GIF loops the effect. For an infinite animation, any one-period window captures it.

### 4. Host so the images INLINE in the comment

GitHub `gh` can't upload an image to a comment, and **gist raw URLs serve `text/plain` — they will NOT render**. The reliable path is a throwaway branch:

```bash
mkdir /tmp/shots-repo && cd /tmp/shots-repo && git init -q
git checkout -b assets/pr-<n>-shots
cp /tmp/shots/*.png /tmp/shots/*.gif .
git add -A && git commit -q -m "assets: before/after shots for PR #<n>"
git remote add origin <repo-https-url>
git push -u origin assets/pr-<n>-shots
```

Reference each as `https://raw.githubusercontent.com/<owner>/<repo>/assets/pr-<n>-shots/<file>` — `raw.githubusercontent.com` serves the correct `image/*` content-type, so the image inlines. Verify before commenting:

```bash
curl -sI <raw-url> | grep -iE "^HTTP|content-type"   # expect: 200 + content-type: image/png|gif
```

### 5. Comment

```bash
gh pr comment <n> --repo <owner>/<repo> --body "$(cat <<'EOF'
## Before / after — captured with Playwright
... ![before vs after](<raw-url>) ...
EOF
)"
```

State honestly that it's an **isolated harness using the app's real tokens** (not a full-page shot), and that motion fixes are shown as GIFs because a still can't convey easing or perpetual motion. Never imply a UI state you didn't actually render.

## Hard rules

- **NEVER delete the `assets/pr-<n>-shots` branch.** A merged PR's comment renders its images from that branch forever — deleting it 404s the evidence permanently. The branch never merges to `main` and costs nothing; leave it. (Learned the hard way on #3372: a post-merge cleanup deleted it and broke the comment; it had to be re-pushed.)
- Harness CSS must match the diff's real `-`/`+` declarations verbatim. Drift = false evidence.
- Render theme bugs on the affected theme(s); `base.css` defines `[data-theme='dark'|'gold'|'purple'|'hotpink']`.
- This produces *evidence*, not the browser-attestation. The merge gate still needs a real golden-path check (or its out-clause) — see `.claude/docs/browser-attestation.md`.

## Tooling note

The Playwright MCP launches Chromium with `--no-sandbox` (a benign Chromium banner — the sandbox needs OS perms it skips). It does not affect screenshot or console fidelity. It is the plugin's default launch arg, not project config.
