import { VIEWER_APP_JS, VIEWER_HELPERS_JS } from './deckViewerScript';

// Host style variables first (Claude passes them in hostContext), with local
// fallbacks for hosts that send none. Fallbacks follow the host theme when it
// is known and the OS scheme otherwise.
const VIEWER_CSS = `
:root {
  color-scheme: light dark;
  --fb-text: #141413;
  --fb-text-2: #3d3d3a;
  --fb-text-3: #73726c;
  --fb-bg: #ffffff;
  --fb-bg-2: #f5f4ed;
  --fb-border: rgba(31, 30, 29, 0.15);
  --fb-border-strong: rgba(31, 30, 29, 0.3);
  --fb-inverse-bg: #141413;
  --fb-inverse-text: #ffffff;
  --fb-info-bg: #d6e4f6;
  --fb-info-text: #3266ad;
  --fb-danger: #7f2c28;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --fb-text: #faf9f5;
    --fb-text-2: #c2c0b6;
    --fb-text-3: #9c9a92;
    --fb-bg: #30302e;
    --fb-bg-2: #262624;
    --fb-border: rgba(222, 220, 209, 0.15);
    --fb-border-strong: rgba(222, 220, 209, 0.3);
    --fb-inverse-bg: #faf9f5;
    --fb-inverse-text: #141413;
    --fb-info-bg: #253e5f;
    --fb-info-text: #80aadd;
    --fb-danger: #ee8884;
  }
}
:root[data-theme='dark'] {
  --fb-text: #faf9f5;
  --fb-text-2: #c2c0b6;
  --fb-text-3: #9c9a92;
  --fb-bg: #30302e;
  --fb-bg-2: #262624;
  --fb-border: rgba(222, 220, 209, 0.15);
  --fb-border-strong: rgba(222, 220, 209, 0.3);
  --fb-inverse-bg: #faf9f5;
  --fb-inverse-text: #141413;
  --fb-info-bg: #253e5f;
  --fb-info-text: #80aadd;
  --fb-danger: #ee8884;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: transparent; }
body {
  font-family: var(--font-sans, system-ui, -apple-system, 'Segoe UI', sans-serif);
  font-size: var(--font-text-md-size, 16px);
  line-height: var(--font-text-md-line-height, 1.4);
  color: var(--color-text-primary, var(--fb-text));
  -webkit-text-size-adjust: 100%;
}
#app {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 720px;
  padding: calc(4px + var(--safe-top, 0px)) calc(4px + var(--safe-right, 0px))
    calc(8px + var(--safe-bottom, 0px)) calc(4px + var(--safe-left, 0px));
}
.head { display: flex; flex-direction: column; gap: 2px; }
.path {
  font-size: var(--font-text-sm-size, 14px);
  color: var(--color-text-secondary, var(--fb-text-2));
  overflow-wrap: anywhere;
}
.path .sep { color: var(--color-text-tertiary, var(--fb-text-3)); padding: 0 4px; }
.path .leaf { color: var(--color-text-primary, var(--fb-text)); font-weight: var(--font-weight-medium, 500); }
.hero { display: flex; align-items: baseline; gap: 6px; }
.hero-num {
  font-size: var(--font-heading-2xl-size, 28px);
  line-height: var(--font-heading-2xl-line-height, 1.1);
  font-weight: var(--font-weight-semibold, 600);
  font-variant-numeric: tabular-nums;
}
.hero-unit { font-size: var(--font-text-md-size, 16px); color: var(--color-text-secondary, var(--fb-text-2)); }
.meta, .position, .label {
  font-size: var(--font-text-sm-size, 14px);
  color: var(--color-text-tertiary, var(--fb-text-3));
}
.label { margin: 0 0 4px; font-weight: var(--font-weight-medium, 500); }
.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 160px;
  padding: 14px 16px;
  background: var(--color-background-primary, var(--fb-bg));
  border: var(--border-width-regular, 0.5px) solid var(--color-border-primary, var(--fb-border-strong));
  border-radius: var(--border-radius-lg, 10px);
  cursor: pointer;
  outline: none;
}
.card.is-back { background: var(--color-background-secondary, var(--fb-bg-2)); }
.card:focus-visible, button:focus-visible {
  box-shadow: 0 0 0 2px var(--color-ring-primary, var(--fb-border-strong));
}
.card-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.side {
  font-size: var(--font-text-xs-size, 12px);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary, var(--fb-text-3));
}
.card-deck {
  margin-left: auto;
  font-size: var(--font-text-xs-size, 12px);
  color: var(--color-text-secondary, var(--fb-text-2));
}
.card-body { flex: 1; overflow-wrap: anywhere; font-size: var(--font-text-lg-size, 18px); line-height: 1.4; }
.card-body p { margin: 0 0 8px; }
.card-body ul, .card-body ol { margin: 4px 0; padding-left: 22px; }
.card-body table { border-collapse: collapse; max-width: 100%; display: block; overflow-x: auto; }
.card-body td, .card-body th { border: 1px solid var(--color-border-tertiary, var(--fb-border)); padding: 4px 6px; }
.card-body pre { white-space: pre-wrap; font-family: var(--font-mono, ui-monospace, monospace); font-size: 14px; }
.card-body code { font-family: var(--font-mono, ui-monospace, monospace); }
.card-body hr { border: 0; border-top: 1px solid var(--color-border-tertiary, var(--fb-border)); margin: 10px 0; }
.card-body .heading { font-weight: var(--font-weight-semibold, 600); margin: 4px 0; }
.card-body rt { font-size: 0.55em; color: var(--color-text-secondary, var(--fb-text-2)); }
.cloze {
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-info, var(--fb-info-text));
  background: var(--color-background-info, var(--fb-info-bg));
  border-radius: var(--border-radius-xs, 4px);
  padding: 0 4px;
}
.media-chip, .chip {
  display: inline-block;
  font-size: var(--font-text-xs-size, 12px);
  line-height: 1.4;
  padding: 2px 8px;
  border-radius: var(--border-radius-full, 9999px);
  border: var(--border-width-regular, 0.5px) solid var(--color-border-secondary, var(--fb-border-strong));
  color: var(--color-text-secondary, var(--fb-text-2));
  vertical-align: middle;
}
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.controls { display: grid; grid-template-columns: 1fr 1.4fr 1fr; gap: 8px; }
button {
  min-height: 44px;
  padding: 0 14px;
  font: inherit;
  font-size: var(--font-text-sm-size, 14px);
  font-weight: var(--font-weight-medium, 500);
  color: var(--color-text-primary, var(--fb-text));
  background: transparent;
  border: var(--border-width-regular, 0.5px) solid var(--color-border-primary, var(--fb-border-strong));
  border-radius: var(--border-radius-md, 8px);
  cursor: pointer;
}
button:disabled { color: var(--color-text-disabled, var(--fb-text-3)); cursor: default; opacity: 0.6; }
button.flip { background: var(--color-background-secondary, var(--fb-bg-2)); }
button.primary {
  width: 100%;
  background: var(--color-background-inverse, var(--fb-inverse-bg));
  color: var(--color-text-inverse, var(--fb-inverse-text));
  border-color: transparent;
  font-weight: var(--font-weight-semibold, 600);
}
.position { text-align: center; font-variant-numeric: tabular-nums; }
.subdecks { border-top: var(--border-width-regular, 0.5px) solid var(--color-border-tertiary, var(--fb-border)); padding-top: 10px; }
.tree, .batch { list-style: none; margin: 0; padding: 0; }
.tree-row, .batch-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 4px 0 4px calc(var(--depth, 0) * 16px);
  font-size: var(--font-text-sm-size, 14px);
}
.batch-row { padding: 6px 0; border-bottom: var(--border-width-regular, 0.5px) solid var(--color-border-tertiary, var(--fb-border)); }
.tree-name { overflow-wrap: anywhere; }
.tree-count {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary, var(--fb-text-2));
}
.notice, .empty { margin: 0; color: var(--color-text-secondary, var(--fb-text-2)); }
.error-line { margin: 0; font-size: var(--font-text-sm-size, 14px); color: var(--color-text-danger, var(--fb-danger)); }
.skeleton { border-radius: var(--border-radius-md, 8px); background: var(--color-background-secondary, var(--fb-bg-2)); }
.skeleton.line { height: 14px; width: 40%; }
.skeleton.hero { height: 30px; width: 30%; }
.skeleton.card { height: 160px; width: 100%; cursor: default; border: 0; }
@media (max-width: 420px) {
  .controls { grid-template-columns: 1fr 1fr; }
  .controls .flip { grid-column: 1 / -1; grid-row: 1; }
  .card-body { font-size: var(--font-text-md-size, 16px); }
}
`;

const SKELETON = `<div class="skeleton line"></div><div class="skeleton hero"></div><div class="skeleton card"></div>`;

export function buildDeckViewerHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>2anki deck</title>
<style>${VIEWER_CSS}</style>
</head>
<body>
<main id="app" aria-busy="true">${SKELETON}</main>
<script>${VIEWER_HELPERS_JS}
${VIEWER_APP_JS}</script>
</body>
</html>`;
}
