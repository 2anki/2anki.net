import crypto from 'node:crypto';
import type { IEmailService } from '../../services/EmailService/EmailService';
import type { IPassClaimTokensRepository } from '../../data_layer/PassClaimTokensRepository';
import type { AnonymousPassesId } from '../../data_layer/public/AnonymousPasses';
import type { EventsSink } from '../../services/events/EventsSink';
import type { PassKind } from '../../data_layer/UserPassRepository';
import hmacToken from '../../lib/misc/hmacToken';
import { passKindLabel } from './passKindLabel';

const CLAIM_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SendAnonymousPassClaimEmailInput {
  anonymousPassId: number;
  kind: PassKind;
  buyerEmail: string;
}

export class SendAnonymousPassClaimEmailUseCase {
  constructor(
    private readonly tokensRepo: IPassClaimTokensRepository,
    private readonly emailService: IEmailService,
    private readonly eventsSink?: Pick<EventsSink, 'record'>,
    private readonly domain: string = process.env.DOMAIN ?? 'https://2anki.net'
  ) {}

  async execute(input: SendAnonymousPassClaimEmailInput): Promise<void> {
    const trimmedEmail = input.buyerEmail.trim();
    if (!trimmedEmail.includes('@')) {
      return;
    }

    const now = new Date();
    const rawToken = crypto.randomUUID();
    await this.tokensRepo.insert({
      user_id: null,
      anonymous_pass_id: input.anonymousPassId as AnonymousPassesId,
      token_hash: hmacToken(rawToken),
      expires_at: new Date(now.getTime() + CLAIM_TOKEN_TTL_MS),
    });

    const claimUrl = `${this.domain}/account/claim?token=${encodeURIComponent(rawToken)}&kind=pass`;
    await this.emailService.sendAnonymousPassClaimEmail(
      trimmedEmail,
      claimUrl,
      passKindLabel(input.kind)
    );

    this.eventsSink?.record({
      name: 'pass_claim_email_sent',
      props: { kind: input.kind },
      created_at: now,
    });
  }
}
