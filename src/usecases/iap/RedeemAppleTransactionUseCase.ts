import type {
  PassKind,
  IUserPassRepository,
} from '../../data_layer/UserPassRepository';
import {
  DuplicateAppleTransactionError,
  type IAppleTransactionsRepository,
} from '../../data_layer/AppleTransactionsRepository';
import type { IAiCreditGrantsWriter } from '../../data_layer/AiCreditGrantsRepository';
import {
  AppleUnavailableError,
  AppleVerificationError,
  type DecodedAppleTransaction,
  type IAppleStoreKitService,
} from '../../services/AppleStoreKitService';
import hashToken from '../../lib/misc/hashToken';
import { track } from '../../services/events/track';
import { IapRedeemError } from './IapRedeemError';
import {
  findAppleProduct,
  type AppleProduct,
  type CreditsProduct,
  type SubscriptionProduct,
} from './products';

export interface RedeemAppleTransactionInput {
  userId: number;
  jws: string;
  productId: string;
}

export interface RedeemedPass {
  kind: PassKind;
  expiresAt: Date;
}

export interface RedeemedCredits {
  amount: number;
  expiresAt: Date;
}

export interface RedeemAppleTransactionResult {
  message: string;
  pass?: RedeemedPass;
  credits?: RedeemedCredits;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class RedeemAppleTransactionUseCase {
  constructor(
    private readonly appleService: IAppleStoreKitService,
    private readonly userPassRepository: IUserPassRepository,
    private readonly appleTransactions: IAppleTransactionsRepository,
    private readonly creditGrants: IAiCreditGrantsWriter,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    input: RedeemAppleTransactionInput
  ): Promise<RedeemAppleTransactionResult> {
    const decoded = await this.verify(input.jws);

    if (decoded.productId !== input.productId) {
      throw IapRedeemError.malformed();
    }

    const product = findAppleProduct(decoded.productId);
    if (product == null) {
      throw IapRedeemError.malformed();
    }

    const now = this.now();
    const granted =
      product.kind === 'credits'
        ? await this.grantCredits(input.userId, product, decoded, now)
        : await this.grantPass(input.userId, product, decoded, now);

    const ledgerExpiresAt =
      decoded.expiresDateMs != null ? new Date(decoded.expiresDateMs) : null;

    try {
      await this.appleTransactions.record(
        {
          userId: input.userId,
          transactionId: decoded.transactionId,
          productId: decoded.productId,
          environment: decoded.environment,
          expiresAt: ledgerExpiresAt,
        },
        now
      );
    } catch (err) {
      if (err instanceof DuplicateAppleTransactionError) {
        throw IapRedeemError.duplicate();
      }
      throw err;
    }

    const passKind = product.kind === 'credits' ? null : product.passKind;
    const grantedExpiresAt =
      'pass' in granted ? granted.pass.expiresAt : granted.credits.expiresAt;

    console.info('iap.redeem.granted', {
      user_id: input.userId,
      product_id: decoded.productId,
      kind: passKind ?? product.kind,
      environment: decoded.environment,
      expires_at: grantedExpiresAt.toISOString(),
      transaction_id_hash: hashToken(decoded.transactionId),
    });

    track('native_app_activated', {
      userId: input.userId,
      props: {
        platform: 'apple',
        product_kind: product.kind,
        pass_kind: passKind,
        environment: decoded.environment,
      },
    });

    return { message: product.successMessage, ...granted };
  }

  private async grantPass(
    userId: number,
    product: Exclude<AppleProduct, CreditsProduct>,
    decoded: DecodedAppleTransaction,
    now: Date
  ): Promise<{ pass: RedeemedPass }> {
    const idempotencyKey = `apple:${decoded.transactionId}`;
    const pass =
      product.kind === 'subscription'
        ? await this.grantSubscription(userId, product, decoded, idempotencyKey)
        : await this.userPassRepository.upsertWithExtension(
            userId,
            product.passKind,
            product.durationMs,
            idempotencyKey,
            now
          );
    return { pass: { kind: pass.kind, expiresAt: pass.expires_at } };
  }

  // A consumable credit pack is granted exactly once per Apple transaction:
  // the grant row dedupes on the transaction id, so a replayed JWS inserts
  // nothing and is reported as the duplicate the ledger would also catch.
  private async grantCredits(
    userId: number,
    product: CreditsProduct,
    decoded: DecodedAppleTransaction,
    now: Date
  ): Promise<{ credits: RedeemedCredits }> {
    const expiresAt = new Date(now.getTime() + product.expiryDays * DAY_MS);
    const inserted = await this.creditGrants.insertAppleGrant({
      userId,
      amountCredits: product.credits,
      expiresAt,
      appleTransactionId: decoded.transactionId,
    });
    if (inserted) {
      return { credits: { amount: product.credits, expiresAt } };
    }
    throw IapRedeemError.duplicate();
  }

  private grantSubscription(
    userId: number,
    product: SubscriptionProduct,
    decoded: DecodedAppleTransaction,
    idempotencyKey: string
  ) {
    if (decoded.expiresDateMs == null) {
      throw IapRedeemError.malformed();
    }
    return this.userPassRepository.upsertWithAbsoluteExpiry(
      userId,
      product.passKind,
      new Date(decoded.expiresDateMs),
      idempotencyKey
    );
  }

  private async verify(jws: string) {
    try {
      return await this.appleService.verifyTransaction(jws);
    } catch (err) {
      if (err instanceof AppleVerificationError) {
        throw IapRedeemError.malformed();
      }
      if (err instanceof AppleUnavailableError) {
        throw IapRedeemError.unavailable();
      }
      throw err;
    }
  }
}

export default RedeemAppleTransactionUseCase;
