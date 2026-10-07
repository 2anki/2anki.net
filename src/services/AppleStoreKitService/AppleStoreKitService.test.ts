import { vi } from 'vitest';
import {
  VerificationException,
  VerificationStatus,
} from '@apple/app-store-server-library';

import {
  AppleStoreKitService,
  AppleUnavailableError,
  AppleVerificationError,
  type JWSTransactionDecodedPayloadLike,
  type TransactionVerifier,
} from './AppleStoreKitService';

const VALID: JWSTransactionDecodedPayloadLike = {
  transactionId: 'txn-1',
  productId: 'daypass.24h',
  bundleId: 'net.2anki.app',
  environment: 'Sandbox',
  purchaseDate: 1000,
};

function verifierReturning(
  payload: JWSTransactionDecodedPayloadLike
): TransactionVerifier {
  return { verifyAndDecodeTransaction: vi.fn().mockResolvedValue(payload) };
}

function verifierThrowing(error: unknown): TransactionVerifier {
  return { verifyAndDecodeTransaction: vi.fn().mockRejectedValue(error) };
}

describe('AppleStoreKitService', () => {
  it('returns the decoded transaction from the first verifier that accepts it', async () => {
    const service = new AppleStoreKitService([verifierReturning(VALID)]);

    const result = await service.verifyTransaction('jws');

    expect(result).toMatchObject({
      transactionId: 'txn-1',
      productId: 'daypass.24h',
      environment: 'Sandbox',
    });
  });

  it('falls back to the next environment on INVALID_ENVIRONMENT', async () => {
    const wrongEnv = verifierThrowing(
      new VerificationException(VerificationStatus.INVALID_ENVIRONMENT)
    );
    const sandbox = verifierReturning(VALID);
    const service = new AppleStoreKitService([wrongEnv, sandbox]);

    const result = await service.verifyTransaction('jws');

    expect(result.transactionId).toBe('txn-1');
    expect(sandbox.verifyAndDecodeTransaction).toHaveBeenCalledWith('jws');
  });

  it('maps a signature failure to AppleVerificationError', async () => {
    const service = new AppleStoreKitService([
      verifierThrowing(
        new VerificationException(VerificationStatus.VERIFICATION_FAILURE)
      ),
    ]);

    await expect(service.verifyTransaction('jws')).rejects.toBeInstanceOf(
      AppleVerificationError
    );
  });

  it('maps a retryable failure to AppleUnavailableError', async () => {
    const service = new AppleStoreKitService([
      verifierThrowing(
        new VerificationException(
          VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
        )
      ),
    ]);

    await expect(service.verifyTransaction('jws')).rejects.toBeInstanceOf(
      AppleUnavailableError
    );
  });

  it('maps a non-verification error (network) to AppleUnavailableError', async () => {
    const service = new AppleStoreKitService([
      verifierThrowing(new Error('socket hang up')),
    ]);

    await expect(service.verifyTransaction('jws')).rejects.toBeInstanceOf(
      AppleUnavailableError
    );
  });

  it('rejects a decoded payload missing required fields', async () => {
    const service = new AppleStoreKitService([
      verifierReturning({ transactionId: 'txn-1' }),
    ]);

    await expect(service.verifyTransaction('jws')).rejects.toBeInstanceOf(
      AppleVerificationError
    );
  });
});
