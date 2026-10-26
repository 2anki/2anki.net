import crypto from 'crypto';

const CONSENT_TOKEN_CONTEXT = 'mcp-consent:v1:';

export function computeConsentToken(
  sessionToken: string,
  secret: string
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(CONSENT_TOKEN_CONTEXT + sessionToken)
    .digest('hex');
}

export function consentTokenMatches(
  expected: string,
  submitted: unknown
): boolean {
  if (typeof submitted !== 'string' || submitted.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf-8'),
    Buffer.from(submitted, 'utf-8')
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface ConsentPageInput {
  actionPath: string;
  clientName: string;
  redirectUri: string;
  clientHost?: string;
  scopes: string[];
  csrf: string;
  fields: Record<string, string | undefined>;
}

const KNOWN_WEB_HOSTS = new Set([
  'claude.ai',
  'chatgpt.com',
  'chat.openai.com',
]);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const BRAND_NAME_PATTERN = /claude|chatgpt|openai|anthropic|2anki/i;

export interface ClientIdentity {
  label: string;
  host: string;
  verified: boolean;
}

export function describeClient(
  clientName: string,
  redirectUri: string
): ClientIdentity {
  let host = '';
  let protocol = '';
  try {
    const parsed = new URL(redirectUri);
    host = parsed.hostname.toLowerCase();
    protocol = parsed.protocol;
  } catch {
    host = '';
  }
  const verified =
    LOOPBACK_HOSTS.has(host) ||
    (protocol === 'https:' && KNOWN_WEB_HOSTS.has(host));
  const claimsBrand = BRAND_NAME_PATTERN.test(clientName);
  const label = claimsBrand && !verified && host !== '' ? host : clientName;
  return { label, host, verified };
}

const SCOPE_LINES: Record<string, string[]> = {
  mcp: [
    'List your decks',
    "Preview a deck's cards",
    'Create decks from your content',
  ],
};

const FALLBACK_SCOPE_LINE = 'Access your 2anki decks and conversions';

function scopeLinesFor(scopes: string[]): string[] {
  const lines = scopes.flatMap(
    (scope) => SCOPE_LINES[scope] ?? [FALLBACK_SCOPE_LINE]
  );
  return lines.length > 0 ? lines : [FALLBACK_SCOPE_LINE];
}

function hiddenInput(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(
    value
  )}" />`;
}

const CONSENT_STYLES = `
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      background-color: #f5f5f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #374151;
      -webkit-font-smoothing: antialiased;
    }
    .consent-card {
      width: 100%;
      max-width: 420px;
      background-color: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 32px 28px;
    }
    .consent-logo {
      display: block;
      margin: 0 auto 20px;
      height: auto;
    }
    .consent-title {
      margin: 0 0 12px;
      font-size: 20px;
      font-weight: 600;
      text-align: center;
      color: #374151;
    }
    .consent-ask {
      margin: 0 0 20px;
      font-size: 15px;
      line-height: 1.5;
      text-align: center;
      color: #374151;
    }
    .consent-scopes {
      list-style: none;
      margin: 0 0 28px;
      padding: 0;
    }
    .consent-scopes li {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin: 0 0 12px;
      font-size: 15px;
      line-height: 1.45;
      color: #374151;
    }
    .consent-scopes li:last-child { margin-bottom: 0; }
    .consent-check {
      flex: 0 0 auto;
      color: #3b82f6;
      font-weight: 700;
    }
    .consent-actions {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .consent-btn {
      width: 100%;
      padding: 12px 16px;
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
      border-radius: 8px;
      cursor: pointer;
    }
    .consent-btn-primary {
      background-color: #2563eb;
      color: #ffffff;
      border: 1px solid #2563eb;
    }
    .consent-btn-secondary {
      background-color: transparent;
      color: #374151;
      border: 1px solid #e5e7eb;
    }
    .consent-btn:focus-visible {
      outline: 2px solid #3b82f6;
      outline-offset: 2px;
    }
    .consent-redirect {
      margin: 0 0 12px;
      font-size: 14px;
      color: #6b7280;
      overflow-wrap: anywhere;
    }
    .consent-warning {
      margin: 0 0 16px;
      padding: 10px 12px;
      font-size: 14px;
      line-height: 1.5;
      color: #92400e;
      background-color: #fef3c7;
      border: 1px solid #fcd34d;
      border-radius: 8px;
    }
    .consent-reassure {
      margin: 20px 0 0;
      font-size: 13px;
      line-height: 1.5;
      text-align: center;
      color: #6b7280;
    }
    .consent-footer {
      margin: 24px 0 0;
      font-size: 12px;
      text-align: center;
      color: #6b7280;
    }
    @media (prefers-color-scheme: dark) {
      body { background-color: #1a1a1a; color: #e5e7eb; }
      .consent-card { background-color: #111827; border-color: #374151; }
      .consent-title, .consent-ask, .consent-scopes li { color: #e5e7eb; }
      .consent-check { color: #60a5fa; }
      .consent-btn-secondary { color: #e5e7eb; border-color: #374151; }
      .consent-reassure, .consent-footer, .consent-redirect { color: #9ca3af; }
      .consent-warning { color: #fde68a; background-color: #422006; border-color: #92400e; }
    }`;

export function renderConsentPage(input: ConsentPageInput): string {
  const hidden = Object.entries(input.fields)
    .filter(([, value]) => value != null && value !== '')
    .map(([name, value]) => hiddenInput(name, value as string))
    .join('\n      ');
  const scopeList = scopeLinesFor(input.scopes)
    .map(
      (line) =>
        `<li><span class="consent-check" aria-hidden="true">✓</span><span>${escapeHtml(
          line
        )}</span></li>`
    )
    .join('\n        ');
  const identity = describeClient(input.clientName, input.redirectUri);
  const clientName = escapeHtml(identity.label);
  const redirectHost = escapeHtml(identity.host);
  const redirectLine =
    redirectHost === ''
      ? ''
      : `<p class="consent-redirect">After you approve, you'll go back to <strong>${redirectHost}</strong>.</p>`;
  const unverifiedNotice = identity.verified
    ? ''
    : `<p class="consent-warning" role="note">2anki hasn't verified this app. Only approve if you started this connection yourself.</p>`;
  const clientIdentity =
    input.clientHost == null
      ? ''
      : `<p class="consent-reassure">${clientName} is identified by <strong>${escapeHtml(
          input.clientHost
        )}</strong>.</p>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>Connect to 2anki</title>
    <style>${CONSENT_STYLES}
    </style>
  </head>
  <body>
    <main class="consent-card">
      <img class="consent-logo" src="https://2anki.net/mascot/navbar-logo.png" alt="2anki" width="96" />
      <h1 class="consent-title">Connect ${clientName} to 2anki</h1>
      ${redirectLine}
      ${unverifiedNotice}
      <p class="consent-ask">${clientName} wants access to your 2anki account. It will be able to:</p>
      <ul class="consent-scopes">
        ${scopeList}
      </ul>
      ${clientIdentity}
      <p class="consent-reassure">New decks count toward your monthly card limit, the same as on the web.</p>
      <form method="post" action="${escapeHtml(input.actionPath)}">
        ${hidden}
        ${hiddenInput('csrf', input.csrf)}
        <div class="consent-actions">
          <button type="submit" name="consent" value="approve" class="consent-btn consent-btn-primary">Allow access</button>
          <button type="submit" name="consent" value="deny" class="consent-btn consent-btn-secondary">Cancel</button>
        </div>
      </form>
      <p class="consent-reassure">You can disconnect ${clientName} anytime in your account settings.</p>
      <p class="consent-footer">2anki.net — Turn what you study into Anki flashcards</p>
    </main>
  </body>
</html>`;
}
