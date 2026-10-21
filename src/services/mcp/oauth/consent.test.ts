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
      redirectHost: 'claude.ai',
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
      redirectHost: 'claude.ai',
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
      redirectHost: 'claude.ai',
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
      redirectHost: 'claude.ai',
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
      redirectHost: 'claude.ai',
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
      redirectHost: 'claude.ai',
      scopes: ['mcp'],
      csrf: 'x',
      fields: {},
    });
    expect(html).toContain('name="consent" value="approve"');
    expect(html).toContain('name="consent" value="deny"');
    expect(html).toContain('>Allow access</button>');
    expect(html).toContain('>Cancel</button>');
  });

  it('shows the redirect host and, for metadata-document clients, the client host', () => {
    const html = renderConsentPage({
      actionPath: '/authorize',
      clientName: 'Claude',
      redirectHost: 'localhost:5000',
      clientHost: '<b>claude.ai</b>',
      scopes: ['mcp'],
      csrf: 'x',
      fields: {},
    });
    expect(html).toContain('you return to <strong>localhost:5000</strong>');
    expect(html).toContain(
      'Claude is identified by <strong>&lt;b&gt;claude.ai&lt;/b&gt;</strong>'
    );
  });

  it('omits the client host line for registered clients', () => {
    const html = renderConsentPage({
      actionPath: '/authorize',
      clientName: 'Claude',
      redirectHost: 'claude.ai',
      scopes: ['mcp'],
      csrf: 'x',
      fields: {},
    });
    expect(html).not.toContain('is identified by');
  });
});
