import {
  computeConsentToken,
  consentTokenMatches,
  renderConsentPage,
} from './consent';

const SECRET = 'unit-test-secret';

describe('consent CSRF token', () => {
  it('is deterministic for a session but differs across sessions', () => {
    const a = computeConsentToken('session-a', SECRET);
    expect(computeConsentToken('session-a', SECRET)).toBe(a);
    expect(computeConsentToken('session-b', SECRET)).not.toBe(a);
  });

  it('changes when the signing secret changes', () => {
    expect(computeConsentToken('s', SECRET)).not.toBe(
      computeConsentToken('s', 'other-secret')
    );
  });

  it('matches only the exact token and rejects forgeries and bad shapes', () => {
    const token = computeConsentToken('session', SECRET);
    expect(consentTokenMatches(token, token)).toBe(true);
    expect(consentTokenMatches(token, 'forged')).toBe(false);
    expect(consentTokenMatches(token, token + 'x')).toBe(false);
    expect(consentTokenMatches(token, undefined)).toBe(false);
    expect(consentTokenMatches(token, 42)).toBe(false);
  });
});

describe('renderConsentPage', () => {
  it('embeds the OAuth params as hidden fields plus a CSRF field', () => {
    const html = renderConsentPage({
      actionPath: '/authorize',
      clientName: 'Claude',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      scopes: ['mcp'],
      csrf: 'csrf-token-123',
      fields: {
        client_id: 'abc',
        redirect_uri: 'https://claude.ai/callback',
        code_challenge: 'chal',
        state: 'xyz',
        empty: '',
      },
    });
    expect(html).toContain('name="csrf" value="csrf-token-123"');
    expect(html).toContain('name="client_id" value="abc"');
    expect(html).toContain('name="consent" value="approve"');
    expect(html).toContain('name="consent" value="deny"');
    expect(html).toContain('action="/authorize"');
    expect(html).not.toContain('name="empty"');
  });

  it('escapes a malicious client name to prevent HTML injection', () => {
    const html = renderConsentPage({
      actionPath: '/authorize',
      clientName: '<script>alert(1)</script>',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      scopes: [],
      csrf: 'x',
      fields: {},
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders human-readable scope lines instead of the raw scope token', () => {
    const html = renderConsentPage({
      actionPath: '/authorize',
      clientName: 'Claude',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      scopes: ['mcp'],
      csrf: 'x',
      fields: {},
    });
    expect(html).toContain('List your decks');
    expect(html).toContain('Preview a deck&#39;s cards');
    expect(html).toContain('Create decks from your content');
    expect(html).not.toContain(
      '<li><span class="consent-check" aria-hidden="true">✓</span><span>mcp</span></li>'
    );
  });

  it('falls back to a generic scope line for an unknown scope', () => {
    const html = renderConsentPage({
      actionPath: '/authorize',
      clientName: 'Claude',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      scopes: ['unknown-scope'],
      csrf: 'x',
      fields: {},
    });
    expect(html).toContain('Access your 2anki decks and conversions');
  });

  it('includes the mascot image and an inline style block', () => {
    const html = renderConsentPage({
      actionPath: '/authorize',
      clientName: 'Claude',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      scopes: ['mcp'],
      csrf: 'x',
      fields: {},
    });
    expect(html).toContain('src="https://2anki.net/mascot/navbar-logo.png"');
    expect(html).toContain('<style>');
  });

  it('renders both buttons with the new labels while keeping approve/deny values', () => {
    const html = renderConsentPage({
      actionPath: '/authorize',
      clientName: 'Claude',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      scopes: ['mcp'],
      csrf: 'x',
      fields: {},
    });
    expect(html).toContain('name="consent" value="approve"');
    expect(html).toContain('name="consent" value="deny"');
    expect(html).toContain('>Allow access</button>');
    expect(html).toContain('>Cancel</button>');
  });

  describe('redirect host', () => {
    const render = (clientName: string, redirectUri: string) =>
      renderConsentPage({
        actionPath: '/authorize',
        clientName,
        redirectUri,
        scopes: ['mcp'],
        csrf: 'x',
        fields: {},
      });

    it('shows the redirect host and no warning for a known host', () => {
      const html = render('Claude', 'https://claude.ai/api/mcp/auth_callback');
      expect(html).toContain('<strong>claude.ai</strong>');
      expect(html).not.toContain("hasn't verified this app");
      expect(html).toContain('Connect Claude to 2anki');
    });

    it('treats a loopback client as known, including a brand name', () => {
      const html = render('Claude Code', 'http://localhost:54321/callback');
      expect(html).toContain('<strong>localhost</strong>');
      expect(html).not.toContain("hasn't verified this app");
      expect(html).toContain('Connect Claude Code to 2anki');
    });

    it('warns about an unknown host and keeps a neutral client name', () => {
      const html = render('Notes Helper', 'https://app.example.org/cb');
      expect(html).toContain('<strong>app.example.org</strong>');
      expect(html).toContain("hasn't verified this app");
      expect(html).toContain('Connect Notes Helper to 2anki');
    });

    it('shows the host instead of a brand name the host does not own', () => {
      const html = render('ChatGPT', 'https://evil.example.com/cb');
      expect(html).toContain('Connect evil.example.com to 2anki');
      expect(html).not.toContain('Connect ChatGPT to 2anki');
      expect(html).toContain("hasn't verified this app");
    });

    it('does not accept a lookalike host that only contains a known one', () => {
      const html = render('Claude', 'https://claude.ai.evil.example/cb');
      expect(html).toContain('Connect claude.ai.evil.example to 2anki');
      expect(html).toContain("hasn't verified this app");
    });
  });
});
