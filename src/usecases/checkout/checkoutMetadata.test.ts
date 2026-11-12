import {
  anonIdConsentMetadata,
  consentedSessionAnonId,
  optionalMetadata,
} from './checkoutMetadata';

describe('anonIdConsentMetadata', () => {
  it('stamps the consent marker when the visitor allows tracking', () => {
    expect(anonIdConsentMetadata(true)).toEqual({
      anon_id_consent: 'granted',
    });
  });

  it('stamps nothing when the visitor does not allow tracking', () => {
    expect(anonIdConsentMetadata(false)).toEqual({});
  });
});

describe('consentedSessionAnonId', () => {
  it('returns the anon id of a session stamped with consent', () => {
    expect(
      consentedSessionAnonId({ anon_id: 'anon-1', anon_id_consent: 'granted' })
    ).toBe('anon-1');
  });

  it.each([
    ['no consent marker', { anon_id: 'anon-1' }],
    ['an unexpected marker value', { anon_id: 'anon-1', anon_id_consent: '1' }],
    ['no anon id', { anon_id_consent: 'granted' }],
    ['an empty anon id', { anon_id: '', anon_id_consent: 'granted' }],
  ])('returns null for a session with %s', (_label, metadata) => {
    expect(consentedSessionAnonId(metadata)).toBe(null);
  });
});

describe('optionalMetadata', () => {
  it('keeps present string values', () => {
    expect(
      optionalMetadata({
        pricing_variant: 'b',
        anon_id: 'anon-1',
        surface: 'pricing_page',
        ga_client_id: '123.456',
      })
    ).toEqual({
      pricing_variant: 'b',
      anon_id: 'anon-1',
      surface: 'pricing_page',
      ga_client_id: '123.456',
    });
  });

  it('drops undefined and empty-string values', () => {
    expect(
      optionalMetadata({
        pricing_variant: undefined,
        anon_id: '',
        surface: 'pricing_page',
      })
    ).toEqual({ surface: 'pricing_page' });
  });

  it('returns an empty object when nothing is present', () => {
    expect(optionalMetadata({ a: undefined, b: '' })).toEqual({});
  });
});
