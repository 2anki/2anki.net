import type express from 'express';

import { isBotUserAgent } from '../lib/http/isBotUserAgent';
import { analyticsAnonId } from '../lib/http/consentRegion';
import { getMintedAnonId } from '../lib/User/getOwner';
import type {
  ConnectorArrival,
  RecordConnectorArrivalUseCase,
} from '../usecases/mcp/RecordConnectorArrivalUseCase';

const CONNECTOR_REF = 'mcp';

function queryOf(originalUrl: string): URLSearchParams {
  const start = originalUrl.indexOf('?');
  return new URLSearchParams(start === -1 ? '' : originalUrl.slice(start + 1));
}

function cookie(req: express.Request, name: string): string | null {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function warnNotRecorded(error: unknown): void {
  console.warn('[connector-arrival] not recorded', {
    errorClass: error instanceof Error ? error.constructor.name : typeof error,
  });
}

export class ConnectorArrivalController {
  constructor(private readonly useCase: () => RecordConnectorArrivalUseCase) {}

  recordAfterResponse(req: express.Request, res: express.Response): void {
    try {
      const arrival = this.arrivalFrom(req, res);
      if (arrival == null) {
        return;
      }
      res.once('finish', () => {
        Promise.resolve()
          .then(() => this.useCase().execute(arrival))
          .catch(warnNotRecorded);
      });
    } catch (error) {
      warnNotRecorded(error);
    }
  }

  private arrivalFrom(
    req: express.Request,
    res: express.Response
  ): ConnectorArrival | null {
    if (req.method !== 'GET' || isBotUserAgent(req.get('user-agent'))) {
      return null;
    }
    const query = queryOf(req.originalUrl);
    if (query.get('ref')?.toLowerCase() !== CONNECTOR_REF) {
      return null;
    }
    return {
      query,
      sessionToken: cookie(req, 'token'),
      anonymousId: analyticsAnonId(
        req,
        cookie(req, 'anon_id') ?? getMintedAnonId(res)
      ),
    };
  }
}
