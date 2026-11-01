import { AxiosError, AxiosHeaders } from 'axios';
import { inspect } from 'node:util';

import { summarizeOutboundError } from './summarizeOutboundError';

const CLIENT_SECRET = ['fixture', 'client', 'secret'].join('-');

const makeTokenExchangeError = (status: number, data: unknown): AxiosError => {
  const config = {
    url: 'https://api.notion.com/v1/oauth/token',
    auth: { username: 'fixture-client-id', password: CLIENT_SECRET },
    headers: new AxiosHeaders({ 'Content-Type': 'application/json' }),
  };
  const request = { _header: `Authorization: Basic ${CLIENT_SECRET}` };
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    config,
    request,
    { status, statusText: '', headers: {}, config, request, data }
  );
};

describe('summarizeOutboundError', () => {
  it('keeps the message, status and codes of a failed provider call', () => {
    const summary = summarizeOutboundError(
      makeTokenExchangeError(400, { error: 'invalid_grant' })
    );

    expect(summary).toEqual({
      message: 'Request failed with status code 400',
      status: 400,
      code: 'ERR_BAD_REQUEST',
      providerCode: 'invalid_grant',
    });
  });

  it('reads the Notion API error code from the response body', () => {
    const summary = summarizeOutboundError(
      makeTokenExchangeError(401, { object: 'error', code: 'unauthorized' })
    );

    expect(summary.providerCode).toBe('unauthorized');
  });

  it('never carries the request credentials', () => {
    const summary = summarizeOutboundError(
      makeTokenExchangeError(400, { error: 'invalid_client' })
    );

    expect(inspect(summary, { depth: null })).not.toContain(CLIENT_SECRET);
  });

  it('summarizes a network error with no response', () => {
    const error = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
    });

    expect(summarizeOutboundError(error)).toEqual({
      message: 'socket hang up',
      status: null,
      code: 'ECONNRESET',
      providerCode: null,
    });
  });

  it('summarizes a thrown non-error value', () => {
    expect(summarizeOutboundError('boom')).toEqual({
      message: 'boom',
      status: null,
      code: null,
      providerCode: null,
    });
  });
});
