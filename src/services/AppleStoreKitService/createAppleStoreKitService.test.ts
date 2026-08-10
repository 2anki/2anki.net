import fs from 'fs';

import {
  Environment,
  SignedDataVerifier,
} from '@apple/app-store-server-library';

import {
  createAppleStoreKitService,
  VERIFIED_ENVIRONMENTS,
} from './createAppleStoreKitService';
import { DEFAULT_APP_STORE_APPLE_ID } from '../AppStoreLinksService/AppStoreLinksService';

jest.mock('@apple/app-store-server-library', () => {
  const actual = jest.requireActual('@apple/app-store-server-library');
  return { ...actual, SignedDataVerifier: jest.fn() };
});

const MockedVerifier = SignedDataVerifier as unknown as jest.Mock;

function environmentsPassedToVerifiers(): Environment[] {
  return MockedVerifier.mock.calls.map((call) => call[2] as Environment);
}

describe('createAppleStoreKitService', () => {
  const original = { ...process.env };

  beforeEach(() => {
    MockedVerifier.mockClear();
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest
      .spyOn(fs, 'readdirSync')
      .mockReturnValue(['AppleRootCA-G3.cer'] as never);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('cert'));
    process.env.APPLE_IAP_BUNDLE_ID = 'net.2anki.app';
    process.env.APPLE_IAP_ROOT_CERTS_DIR = '/certs';
    process.env.APPLE_IAP_APP_APPLE_ID = '1234567890';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...original };
  });

  it('verifies against both Production and Sandbox when the env var is unset', () => {
    delete process.env.APPLE_IAP_ENVIRONMENT;

    createAppleStoreKitService();

    expect(environmentsPassedToVerifiers()).toEqual([
      Environment.PRODUCTION,
      Environment.SANDBOX,
    ]);
  });

  it('still builds a Production verifier when prod is misconfigured to Sandbox only', () => {
    process.env.APPLE_IAP_ENVIRONMENT = 'Sandbox';

    createAppleStoreKitService();

    expect(environmentsPassedToVerifiers()).toContain(Environment.PRODUCTION);
  });

  it('exposes both environments as the verified set', () => {
    expect(VERIFIED_ENVIRONMENTS).toEqual([
      Environment.PRODUCTION,
      Environment.SANDBOX,
    ]);
  });

  it('passes the env app Apple ID to every verifier when set', () => {
    createAppleStoreKitService();

    const appIds = MockedVerifier.mock.calls.map((call) => call[4]);
    expect(appIds).toEqual([1234567890, 1234567890]);
  });

  it('falls back to the App Store default id when the env var is unset', () => {
    delete process.env.APPLE_IAP_APP_APPLE_ID;

    createAppleStoreKitService();

    const appIds = MockedVerifier.mock.calls.map((call) => call[4]);
    expect(appIds).toEqual([
      Number(DEFAULT_APP_STORE_APPLE_ID),
      Number(DEFAULT_APP_STORE_APPLE_ID),
    ]);
  });

  it('falls back to the App Store default id when the env var is empty', () => {
    process.env.APPLE_IAP_APP_APPLE_ID = '';

    createAppleStoreKitService();

    const appIds = MockedVerifier.mock.calls.map((call) => call[4]);
    expect(appIds).toEqual([
      Number(DEFAULT_APP_STORE_APPLE_ID),
      Number(DEFAULT_APP_STORE_APPLE_ID),
    ]);
  });
});
