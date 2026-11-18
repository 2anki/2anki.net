import type AuthenticationService from '../../services/AuthenticationService';
import { track } from '../../services/events/track';
import { readConnectorLinkParams } from '../../lib/mcp/connectorLink';

export interface ConnectorArrival {
  query: URLSearchParams;
  sessionToken: string | null;
  anonymousId: string | null;
}

export type SessionResolver = Pick<AuthenticationService, 'getUserFrom'>;

export class RecordConnectorArrivalUseCase {
  constructor(private readonly sessions: SessionResolver) {}

  async execute(arrival: ConnectorArrival): Promise<void> {
    let userId: number | null;
    try {
      userId = await this.signedInUserId(arrival.sessionToken);
    } catch (error) {
      console.warn('[connector-arrival] session lookup failed', {
        errorClass:
          error instanceof Error ? error.constructor.name : typeof error,
      });
      return;
    }
    const link = readConnectorLinkParams(arrival.query);
    track('connector_link_arrived', {
      userId,
      anonymousId: arrival.anonymousId,
      props: {
        limit_kind: link.kind ?? 'unknown',
        arm: link.arm ?? 'unknown',
        signed_in: userId != null,
        held: link.heldUntil != null,
      },
    });
  }

  private async signedInUserId(token: string | null): Promise<number | null> {
    if (token == null || token.length === 0) {
      return null;
    }
    const user = await this.sessions.getUserFrom(token);
    return user?.owner ?? null;
  }
}
