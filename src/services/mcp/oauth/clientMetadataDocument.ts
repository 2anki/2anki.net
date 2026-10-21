import crypto from 'crypto';
import type { AxiosResponse } from 'axios';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

import instrumentedAxios, {
  InstrumentedAxios,
} from '../../observability/instrumentedAxios';
import { assertValidRedirectUris } from './redirectUris';

// Client ID Metadata Documents (CIMD): the client_id is an https URL that
// serves the client's metadata, so the client never calls /mcp/register.
// https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-id-metadata-documents

export const CIMD_FETCH_TIMEOUT_MS = 5_000;
export const CIMD_MAX_DOCUMENT_BYTES = 64 * 1024;
export const CIMD_DEFAULT_TTL_MS = 5 * 60 * 1000;
export const CIMD_MAX_TTL_MS = 24 * 60 * 60 * 1000;
export const CIMD_MAX_CACHE_ENTRIES = 500;

const MAX_CLIENT_ID_URL_LENGTH = 2048;
const MAX_CLIENT_NAME_LENGTH = 255;
const STORAGE_ID_PREFIX = 'cimd_';

export type ClientMetadataDocumentFailure =
  | 'invalid_url'
  | 'fetch_failed'
  | 'timeout'
  | 'bad_status'
  | 'not_json'
  | 'too_large'
  | 'invalid_document'
  | 'client_id_mismatch'
  | 'invalid_redirect_uris'
  | 'unsupported_auth_method';

export class ClientMetadataDocumentError extends Error {
  constructor(
    readonly reason: ClientMetadataDocumentFailure,
    message: string
  ) {
    super(message);
    this.name = 'ClientMetadataDocumentError';
  }
}

/** True when the client_id should be resolved as a metadata document URL. */
export function isClientMetadataDocumentId(clientId: string): boolean {
  return clientId.startsWith('https://');
}

/**
 * True for the surrogate ids CIMD clients are stored under. They are never
 * accepted as a client_id on the wire: the URL is the only identity.
 */
export function isCimdStorageId(clientId: string): boolean {
  return clientId.startsWith(STORAGE_ID_PREFIX);
}

/**
 * The client_id written to the code and token tables. Those columns are
 * varchar(64) with a foreign key to mcp_oauth_clients, so a CIMD URL is
 * stored as a fixed-length hash of itself. DCR ids pass through unchanged.
 */
export function storageClientIdFor(clientId: string): string {
  if (!isClientMetadataDocumentId(clientId)) {
    return clientId;
  }
  const digest = crypto.createHash('sha256').update(clientId).digest('hex');
  return `${STORAGE_ID_PREFIX}${digest.slice(0, 56)}`;
}

export function assertValidClientIdUrl(clientId: string): URL {
  if (clientId.length > MAX_CLIENT_ID_URL_LENGTH) {
    throw new ClientMetadataDocumentError('invalid_url', 'client_id too long');
  }
  let parsed: URL;
  try {
    parsed = new URL(clientId);
  } catch {
    throw new ClientMetadataDocumentError('invalid_url', 'client_id not a URL');
  }
  // href equality rejects dot segments, default ports, upper-case hosts and
  // anything else the URL parser would rewrite: the id must be canonical.
  if (
    parsed.protocol !== 'https:' ||
    parsed.href !== clientId ||
    parsed.pathname === '/' ||
    parsed.hash !== '' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    throw new ClientMetadataDocumentError(
      'invalid_url',
      'client_id must be a canonical https URL with a path'
    );
  }
  return parsed;
}

export function cacheTtlFromHeader(header: unknown): number {
  if (typeof header !== 'string' || header.trim() === '') {
    return CIMD_DEFAULT_TTL_MS;
  }
  const directives = header
    .toLowerCase()
    .split(',')
    .map((part) => part.trim());
  if (directives.includes('no-store') || directives.includes('no-cache')) {
    return 0;
  }
  const maxAge = directives
    .map((directive) => /^max-age=(\d+)$/.exec(directive))
    .find((match) => match != null);
  if (maxAge == null) {
    return CIMD_DEFAULT_TTL_MS;
  }
  return Math.min(Number(maxAge[1]) * 1000, CIMD_MAX_TTL_MS);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function optionalStringArray(
  doc: Record<string, unknown>,
  key: string,
  fallback: string[]
): string[] {
  const value = doc[key];
  if (value == null) {
    return fallback;
  }
  if (!isStringArray(value)) {
    throw new ClientMetadataDocumentError(
      'invalid_document',
      `${key} must be an array of strings`
    );
  }
  return value;
}

export function parseClientMetadataDocument(
  clientId: string,
  body: string
): OAuthClientInformationFull {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    throw new ClientMetadataDocumentError('not_json', 'Document is not JSON');
  }
  if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new ClientMetadataDocumentError(
      'invalid_document',
      'Document must be a JSON object'
    );
  }
  const record = doc as Record<string, unknown>;
  if (record.client_id !== clientId) {
    throw new ClientMetadataDocumentError(
      'client_id_mismatch',
      'Document client_id does not match the URL it was fetched from'
    );
  }
  const authMethod = record.token_endpoint_auth_method;
  if (
    (authMethod != null && authMethod !== 'none') ||
    record.client_secret != null
  ) {
    throw new ClientMetadataDocumentError(
      'unsupported_auth_method',
      'Only public clients (token_endpoint_auth_method "none") are supported'
    );
  }
  const redirectUris = record.redirect_uris;
  if (!isStringArray(redirectUris)) {
    throw new ClientMetadataDocumentError(
      'invalid_redirect_uris',
      'redirect_uris must be an array of strings'
    );
  }
  try {
    assertValidRedirectUris(redirectUris);
  } catch (error) {
    throw new ClientMetadataDocumentError(
      'invalid_redirect_uris',
      (error as Error).message
    );
  }
  const clientName =
    typeof record.client_name === 'string' && record.client_name.trim() !== ''
      ? record.client_name.slice(0, MAX_CLIENT_NAME_LENGTH)
      : undefined;
  return {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: optionalStringArray(record, 'grant_types', [
      'authorization_code',
      'refresh_token',
    ]),
    response_types: optionalStringArray(record, 'response_types', ['code']),
    scope: typeof record.scope === 'string' ? record.scope : undefined,
    token_endpoint_auth_method: 'none',
  };
}

function headerString(
  headers: AxiosResponse['headers'],
  name: string
): string | undefined {
  const raw = (headers as Record<string, unknown> | undefined)?.[name];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return undefined;
}

function isJsonContentType(value: string | undefined): boolean {
  if (value == null) return false;
  const mediaType = value.split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

interface CacheEntry {
  client: OAuthClientInformationFull;
  expiresAt: number;
}

export interface ClientMetadataDocumentResolverOptions {
  http?: InstrumentedAxios;
  now?: () => number;
  timeoutMs?: number;
  maxBytes?: number;
  maxEntries?: number;
}

export class ClientMetadataDocumentResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<
    string,
    Promise<OAuthClientInformationFull>
  >();
  private readonly http: InstrumentedAxios;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxEntries: number;

  constructor(options: ClientMetadataDocumentResolverOptions = {}) {
    this.http = options.http ?? instrumentedAxios;
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? CIMD_FETCH_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? CIMD_MAX_DOCUMENT_BYTES;
    this.maxEntries = options.maxEntries ?? CIMD_MAX_CACHE_ENTRIES;
  }

  async resolve(clientId: string): Promise<OAuthClientInformationFull> {
    assertValidClientIdUrl(clientId);
    const cached = this.cache.get(clientId);
    if (cached != null) {
      if (cached.expiresAt > this.now()) {
        return cached.client;
      }
      this.cache.delete(clientId);
    }
    const pending = this.inflight.get(clientId);
    if (pending != null) {
      return pending;
    }
    const request = this.fetchAndCache(clientId).finally(() => {
      this.inflight.delete(clientId);
    });
    this.inflight.set(clientId, request);
    return request;
  }

  private async fetchAndCache(
    clientId: string
  ): Promise<OAuthClientInformationFull> {
    const response = await this.fetchDocument(clientId);
    const contentType = headerString(response.headers, 'content-type');
    if (!isJsonContentType(contentType)) {
      throw new ClientMetadataDocumentError(
        'not_json',
        'Document must be served as application/json'
      );
    }
    const body = typeof response.data === 'string' ? response.data : '';
    if (Buffer.byteLength(body, 'utf-8') > this.maxBytes) {
      throw new ClientMetadataDocumentError(
        'too_large',
        'Document is too large'
      );
    }
    const client = parseClientMetadataDocument(clientId, body);
    const ttl = cacheTtlFromHeader(
      headerString(response.headers, 'cache-control')
    );
    if (ttl > 0) {
      this.store(clientId, { client, expiresAt: this.now() + ttl });
    }
    return client;
  }

  private store(clientId: string, entry: CacheEntry): void {
    this.cache.delete(clientId);
    while (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest == null) break;
      this.cache.delete(oldest);
    }
    this.cache.set(clientId, entry);
  }

  private async fetchDocument(
    clientId: string
  ): Promise<AxiosResponse<string>> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new ClientMetadataDocumentError(
            'timeout',
            'Timed out fetching the client metadata document'
          )
        );
      }, this.timeoutMs);
    });
    // instrumentedAxios enforces https, rejects private, loopback and
    // link-local hosts and resolved IPs, and pins the vetted address for the
    // connection, re-checking every redirect hop.
    const request = this.http.get<string>('mcp', clientId, {
      timeout: this.timeoutMs,
      signal: controller.signal,
      responseType: 'text',
      transformResponse: [(data: unknown) => data],
      maxContentLength: this.maxBytes,
      maxBodyLength: this.maxBytes,
      headers: { Accept: 'application/json' },
      validateStatus: (status) => status === 200,
    });
    try {
      return await Promise.race([request, timeout]);
    } catch (error) {
      if (error instanceof ClientMetadataDocumentError) {
        throw error;
      }
      const status = (error as { response?: { status?: unknown } }).response
        ?.status;
      if (typeof status === 'number') {
        throw new ClientMetadataDocumentError(
          'bad_status',
          `Document fetch returned HTTP ${status}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/maxContentLength/i.test(message)) {
        throw new ClientMetadataDocumentError(
          'too_large',
          'Document is too large'
        );
      }
      throw new ClientMetadataDocumentError('fetch_failed', message);
    } finally {
      clearTimeout(timer);
      request.catch(() => undefined);
    }
  }
}
