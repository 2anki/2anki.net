import { vi } from 'vitest';

import { googleSignInUrl, microsoftSignInUrl } from './providerSignInUrl';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('googleSignInUrl', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client');
    vi.stubEnv(
      'GOOGLE_REDIRECT_URI',
      'https://2anki.net/api/users/auth/google'
    );
  });

  it('builds the Google authorize URL with the state and the redirect the token exchange uses', () => {
    const url = new URL(googleSignInUrl('state-1') ?? '');

    expect(`${url.origin}${url.pathname}`).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth'
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      redirect_uri: 'https://2anki.net/api/users/auth/google',
      client_id: 'google-client',
      access_type: 'offline',
      response_type: 'code',
      prompt: 'consent',
      scope:
        'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
      state: 'state-1',
    });
  });

  it('never asks Google for a form_post response, so the Lax state cookie rides the callback GET', () => {
    const url = new URL(googleSignInUrl('state-1') ?? '');

    expect(url.searchParams.get('response_mode')).toBeNull();
  });

  it.each(['GOOGLE_CLIENT_ID', 'GOOGLE_REDIRECT_URI'])(
    'returns null when %s is unset',
    (name) => {
      vi.stubEnv(name, '');

      expect(googleSignInUrl('state-1')).toBeNull();
    }
  );
});

describe('microsoftSignInUrl', () => {
  beforeEach(() => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'microsoft-client');
    vi.stubEnv(
      'MICROSOFT_REDIRECT_URI',
      'https://2anki.net/api/users/auth/microsoft'
    );
  });

  it('builds the Microsoft authorize URL with the state and the redirect the token exchange uses', () => {
    const url = new URL(microsoftSignInUrl('state-2') ?? '');

    expect(`${url.origin}${url.pathname}`).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'microsoft-client',
      response_type: 'code',
      redirect_uri: 'https://2anki.net/api/users/auth/microsoft',
      response_mode: 'query',
      scope: 'openid profile email offline_access',
      prompt: 'select_account',
      state: 'state-2',
    });
  });

  it('asks Microsoft for a query response, so the Lax state cookie rides the callback GET', () => {
    const url = new URL(microsoftSignInUrl('state-2') ?? '');

    expect(url.searchParams.get('response_mode')).toBe('query');
  });

  it.each(['MICROSOFT_CLIENT_ID', 'MICROSOFT_REDIRECT_URI'])(
    'returns null when %s is unset',
    (name) => {
      vi.stubEnv(name, '');

      expect(microsoftSignInUrl('state-2')).toBeNull();
    }
  );
});
