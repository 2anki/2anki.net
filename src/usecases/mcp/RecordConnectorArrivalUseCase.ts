import type AuthenticationService from '../../services/AuthenticationService';
import { track } from '../../services/events/track';
import { readConnectorLinkParams } from '../../lib/mcp/connectorLink';
import type { FetchSite } from '../../lib/http/fetchSite';
import type { UserAgentClass } from '../../lib/http/userAgentClass';

export interface ArrivalRequest {
  fetchSite: FetchSite;
  prefetch: boolean;
  uaClass: UserAgentClass;
}

export interface ConnectorArrival {
  query: URLSearchParams;
  sessionToken: string | null;
  anonymousId: string | null;
  request: ArrivalRequest;
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
        fetch_site: arrival.request.fetchSite,
        prefetch: arrival.request.prefetch,
        ua_class: arrival.request.uaClass,
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
