import fs from 'fs';
import path from 'path';

import {
  Environment,
  SignedDataVerifier,
} from '@apple/app-store-server-library';

import {
  AppleIapNotConfiguredError,
  AppleStoreKitService,
  type IAppleStoreKitService,
} from './AppleStoreKitService';
import { DEFAULT_APP_STORE_APPLE_ID } from '../AppStoreLinksService/AppStoreLinksService';

function loadRootCertificates(dir: string): Buffer[] {
  return fs
    .readdirSync(dir)
    .filter((file) => /\.(cer|der|pem|crt)$/i.test(file))
    .map((file) => fs.readFileSync(path.join(dir, file)));
}

// Always verify against both environments. Production credits real App Store
// buyers; Sandbox credits App Review and TestFlight testers, who exercise IAP
// with Sandbox transactions even against the live app. verifyTransaction
// iterates verifiers and skips the non-matching one on INVALID_ENVIRONMENT, so
// each JWS only validates against its own environment. Gating this on an env
// var let production reject every real purchase when it was set to Sandbox only.
export const VERIFIED_ENVIRONMENTS: Environment[] = [
  Environment.PRODUCTION,
  Environment.SANDBOX,
];

export function createAppleStoreKitService(): IAppleStoreKitService {
  const bundleId = process.env.APPLE_IAP_BUNDLE_ID;
  const rootCertsDir = process.env.APPLE_IAP_ROOT_CERTS_DIR;

  if (
    bundleId == null ||
    bundleId === '' ||
    rootCertsDir == null ||
    rootCertsDir === ''
  ) {
    throw new AppleIapNotConfiguredError(
      'Set APPLE_IAP_BUNDLE_ID and APPLE_IAP_ROOT_CERTS_DIR to enable IAP redemption'
    );
  }

  if (!fs.existsSync(rootCertsDir)) {
    throw new AppleIapNotConfiguredError(
      `Apple root certificate directory not found: ${rootCertsDir}`
    );
  }

  const rootCertificates = loadRootCertificates(rootCertsDir);
  if (rootCertificates.length === 0) {
    throw new AppleIapNotConfiguredError(
      `No Apple root certificates (.cer/.der/.pem) found in ${rootCertsDir}`
    );
  }

  // Apple's Production verifier hard-requires the numeric app Apple ID; an
  // unset env var made every real-money redeem throw at construction while
  // Sandbox (TestFlight, App Review) kept passing (#4040). The ID is public —
  // it appears in every apps.apple.com URL — so the checked-in default is the
  // source of truth and the env var is an override, matching
  // AppStoreLinksService.
  const appAppleIdRaw =
    process.env.APPLE_IAP_APP_APPLE_ID || DEFAULT_APP_STORE_APPLE_ID;
  const appAppleId = Number.parseInt(appAppleIdRaw, 10);

  const enableOnlineChecks = true;
  const verifiers = VERIFIED_ENVIRONMENTS.map(
    (environment) =>
      new SignedDataVerifier(
        rootCertificates,
        enableOnlineChecks,
        environment,
        bundleId,
        appAppleId
      )
  );

  return new AppleStoreKitService(verifiers);
}
