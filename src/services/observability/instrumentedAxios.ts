import axios, {
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import dns from 'node:dns';
import net from 'node:net';

import { ObservabilitySink } from './ObservabilitySink';
import { getObservabilitySink } from './observabilitySinkInstance';

export const OBSERVABILITY_SERVICES = [
  'notion',
  'claude',
  'dropbox',
  'google_drive',
  'patreon',
  'microsoft_login',
  'apple_login',
  'pexels',
  'wikimedia',
  'mcp',
] as const;

export type ObservabilityService = (typeof OBSERVABILITY_SERVICES)[number];

const isAllowedService = (service: string): service is ObservabilityService =>
  (OBSERVABILITY_SERVICES as readonly string[]).includes(service);

const FIXED_HOST_ALLOWLIST: Record<
  ObservabilityService,
  readonly string[] | null
> = {
  notion: null,
  claude: ['api.anthropic.com'],
  dropbox: null,
  google_drive: ['www.googleapis.com', 'oauth2.googleapis.com'],
  patreon: ['www.patreon.com', 'api.patreon.com'],
  microsoft_login: ['login.microsoftonline.com'],
  apple_login: ['appleid.apple.com'],
  pexels: ['api.pexels.com', 'images.pexels.com'],
  wikimedia: [
    'commons.wikimedia.org',
    'en.wikipedia.org',
    'upload.wikimedia.org',
  ],
  mcp: null,
};

const DOMAIN_SUFFIX_ALLOWLIST: Partial<
  Record<ObservabilityService, readonly string[]>
> = {
  dropbox: ['dropboxusercontent.com'],
};

const matchesDomainSuffix = (lowered: string, suffix: string): boolean =>
  lowered === suffix || lowered.endsWith(`.${suffix}`);

const isHostOnFixedAllowlist = (
  host: string,
  service: ObservabilityService
): boolean => {
  const lowered = host.toLowerCase();
  const suffixes = DOMAIN_SUFFIX_ALLOWLIST[service];
  if (suffixes != null) {
    return suffixes.some((suffix) => matchesDomainSuffix(lowered, suffix));
  }
  const allowlist = FIXED_HOST_ALLOWLIST[service];
  if (allowlist == null) return true;
  return allowlist.includes(lowered);
};

const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^(22[4-9]|23\d)\./,
  /^(24\d|25[0-5])\./,
];

const stripIpv6Brackets = (value: string): string => {
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1);
  }
  return value;
};

const stripTrailingDot = (value: string): string =>
  value.endsWith('.') ? value.slice(0, -1) : value;

const isPrivateIpv4 = (address: string): boolean =>
  PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(address));

type Subnet = readonly [network: string, prefixLength: number];

const NON_PUBLIC_IPV4_SUBNETS: readonly Subnet[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const IPV6_OUTSIDE_GLOBAL_UNICAST: readonly Subnet[] = [
  ['::', 3],
  ['4000::', 2],
  ['8000::', 1],
];

const IPV6_SPECIAL_PURPOSE_INSIDE_GLOBAL_UNICAST: readonly Subnet[] = [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
];

const buildBlockList = (
  subnets: readonly Subnet[],
  family: 'ipv4' | 'ipv6'
): net.BlockList => {
  const list = new net.BlockList();
  for (const [network, prefixLength] of subnets) {
    list.addSubnet(network, prefixLength, family);
  }
  return list;
};

const NON_PUBLIC_IPV4 = buildBlockList(NON_PUBLIC_IPV4_SUBNETS, 'ipv4');
const NON_PUBLIC_IPV6 = buildBlockList(
  [
    ...IPV6_OUTSIDE_GLOBAL_UNICAST,
    ...IPV6_SPECIAL_PURPOSE_INSIDE_GLOBAL_UNICAST,
  ],
  'ipv6'
);

const withoutZoneIdentifier = (address: string): string =>
  address.split('%', 1)[0];

const isIpLiteral = (value: string): boolean =>
  net.isIP(withoutZoneIdentifier(value)) !== 0;

const isNonPublicAddress = (address: string): boolean => {
  const bare = withoutZoneIdentifier(address);
  switch (net.isIP(bare)) {
    case 4:
      return NON_PUBLIC_IPV4.check(bare, 'ipv4');
    case 6:
      return NON_PUBLIC_IPV6.check(bare, 'ipv6');
    default:
      return true;
  }
};

const PRIVATE_IPV6_PREFIXES: string[] = [
  'fc',
  'fd',
  'fe8',
  'fe9',
  'fea',
  'feb',
  'fec',
  'fed',
  'fee',
  'fef',
  '2001:db8',
  '2002:',
  'ff',
];

const isPrivateOrLoopbackHost = (host: string): boolean => {
  const lowered = stripTrailingDot(stripIpv6Brackets(host.toLowerCase()));
  if (lowered === 'localhost' || lowered.endsWith('.localhost')) return true;
  if (isIpLiteral(lowered)) return isNonPublicAddress(lowered);
  if (PRIVATE_IPV6_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
    return true;
  }
  return isPrivateIpv4(lowered);
};

interface ParsedRequestUrl {
  endpoint: string;
  hostname: string;
  protocol: string;
  hostWithPort: string;
}

const parseRequestUrl = (url: string): ParsedRequestUrl => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[observability] invalid URL: ${url}`);
  }
  return {
    endpoint: `${parsed.host}${parsed.pathname}`,
    hostname: parsed.hostname,
    hostWithPort: parsed.host,
    protocol: parsed.protocol,
  };
};

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

const resolveHostnameSafely = async (
  hostname: string
): Promise<ResolvedAddress> => {
  const cleaned = stripIpv6Brackets(hostname);
  let entries: ResolvedAddress[];
  try {
    const lookup = await dns.promises.lookup(cleaned, {
      all: true,
      verbatim: true,
    });
    entries = lookup.map((entry) => ({
      address: entry.address,
      family: entry.family as 4 | 6,
    }));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'EUNKNOWN';
    throw new Error(
      `[observability] dns lookup failed for "${hostname}" (${code})`
    );
  }
  if (entries.length === 0) {
    throw new Error(
      `[observability] dns lookup returned no addresses for "${hostname}"`
    );
  }
  for (const entry of entries) {
    if (isNonPublicAddress(entry.address)) {
      throw new Error(
        `[observability] resolved IP ${entry.address} for "${hostname}" is private/loopback/link-local`
      );
    }
  }
  return entries[0];
};

type AxiosLookup = NonNullable<AxiosRequestConfig['lookup']>;

const buildPinnedLookup = (resolved: ResolvedAddress): AxiosLookup =>
  ((_hostname, _options, callback) => {
    (
      callback as (
        err: NodeJS.ErrnoException | null,
        address: string,
        family: number
      ) => void
    )(null, resolved.address, resolved.family);
  }) as AxiosLookup;

const validateAndResolveUrl = async (
  parsed: ParsedRequestUrl,
  service: ObservabilityService
): Promise<{ endpoint: string; lookup: AxiosLookup }> => {
  if (parsed.protocol !== 'https:') {
    throw new Error(
      `[observability] only https URLs are allowed for ${service} (got ${parsed.protocol})`
    );
  }
  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    throw new Error(
      `[observability] host "${parsed.hostname}" is not allowed for service "${service}" (private/loopback address)`
    );
  }
  if (!isHostOnFixedAllowlist(parsed.hostname, service)) {
    throw new Error(
      `[observability] host "${parsed.hostname}" is not allowed for service "${service}"`
    );
  }
  const resolved = await resolveHostnameSafely(parsed.hostname);
  return {
    endpoint: parsed.endpoint,
    lookup: buildPinnedLookup(resolved),
  };
};

const recordSafely = (
  sink: ObservabilitySink,
  service: ObservabilityService,
  endpoint: string,
  statusCode: number | null,
  durationMs: number
) => {
  try {
    sink.recordOutboundCall({
      service,
      endpoint,
      status_code: statusCode,
      duration_ms: durationMs,
      created_at: new Date(),
    });
  } catch (error) {
    console.error('[observability] failed to record outbound call', error);
  }
};

const extractStatusFromError = (error: unknown): number | null => {
  if (axios.isAxiosError(error) && error.response != null) {
    return error.response.status;
  }
  return null;
};

const MAX_REDIRECTS = 5;

const mergeRequestOptions = (
  config: AxiosRequestConfig | undefined,
  lookup: AxiosLookup
): AxiosRequestConfig => ({
  ...config,
  lookup,
  maxRedirects: 0,
});

const isRedirectStatus = (status: number): boolean =>
  status >= 300 && status < 400;

const headerValue = (
  headers: AxiosResponse['headers'] | undefined,
  name: string
): string | null => {
  if (headers == null) return null;
  const raw = (headers as Record<string, unknown>)[name];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return null;
};

const redirectLocationFromResponse = (
  response: AxiosResponse | undefined,
  baseUrl: string
): string | null => {
  if (response == null) return null;
  if (!isRedirectStatus(response.status)) return null;
  const location = headerValue(response.headers, 'location');
  if (location == null) return null;
  try {
    return new URL(location, baseUrl).toString();
  } catch {
    throw new Error(`[observability] invalid redirect location: ${location}`);
  }
};

const redirectLocationFromError = (
  error: unknown,
  baseUrl: string
): string | null => {
  if (!axios.isAxiosError(error)) return null;
  return redirectLocationFromResponse(error.response, baseUrl);
};

export interface InstrumentedAxios {
  get<T = unknown>(
    service: ObservabilityService,
    url: string,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>>;
  post<T = unknown>(
    service: ObservabilityService,
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>>;
  put<T = unknown>(
    service: ObservabilityService,
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>>;
  delete<T = unknown>(
    service: ObservabilityService,
    url: string,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>>;
}

const resolveNextHop = async (
  nextUrl: string,
  service: ObservabilityService
): Promise<{ currentUrl: string; endpoint: string; lookup: AxiosLookup }> => {
  const parsed = parseRequestUrl(nextUrl);
  const { endpoint, lookup } = await validateAndResolveUrl(parsed, service);
  return { currentUrl: nextUrl, endpoint, lookup };
};

// Credentials are bound to the host the caller addressed. A redirect that
// leaves that host must not carry them along — otherwise any service without
// a fixed host allowlist (notion, dropbox, mcp) would forward Basic auth or a
// bearer token to whatever host the origin redirects to. Same behavior as
// follow-redirects' cross-host credential drop.
export const stripAuthForCrossHostHop = (
  config: AxiosRequestConfig | undefined
): AxiosRequestConfig | undefined => {
  if (config == null) return config;
  const { auth: _auth, headers, ...rest } = config;
  if (headers == null) return rest;
  const cleaned = { ...headers };
  for (const key of Object.keys(cleaned)) {
    if (key.toLowerCase() === 'authorization') {
      delete cleaned[key];
    }
  }
  return { ...rest, headers: cleaned };
};

const CREDENTIAL_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
]);

const withoutCredentialHeaders = (
  headers: unknown
): Record<string, unknown> => {
  const kept: Record<string, unknown> = {};
  if (headers == null || typeof headers !== 'object') return kept;
  for (const [name, value] of Object.entries(headers)) {
    if (!CREDENTIAL_HEADER_NAMES.has(name.toLowerCase())) {
      kept[name] = value;
    }
  }
  return kept;
};

const withoutCredentials = (
  config: InternalAxiosRequestConfig
): InternalAxiosRequestConfig => {
  const { auth: _auth, data: _data, headers, ...rest } = config;
  return {
    ...rest,
    headers: withoutCredentialHeaders(headers),
  } as InternalAxiosRequestConfig;
};

const MAX_REDACTED_CAUSE_DEPTH = 3;

const redactCredentials = (error: unknown, depth = 0): unknown => {
  if (!axios.isAxiosError(error)) return error;
  if (error.config != null) {
    error.config = withoutCredentials(error.config);
  }
  delete error.request;
  const { response } = error;
  if (response != null) {
    if (response.config != null) {
      response.config = withoutCredentials(response.config);
    }
    delete response.request;
  }
  if (depth < MAX_REDACTED_CAUSE_DEPTH) {
    redactCredentials(error.cause, depth + 1);
  }
  return error;
};

const measure = async <T>(
  sink: ObservabilitySink,
  service: string,
  url: string,
  exec: (
    hopUrl: string,
    lookup: AxiosLookup,
    sameHost: boolean
  ) => Promise<AxiosResponse<T>>,
  followRedirects = true
): Promise<AxiosResponse<T>> => {
  if (!isAllowedService(service)) {
    throw new Error(
      `[observability] unknown service "${service}". Allowed: ${OBSERVABILITY_SERVICES.join(', ')}`
    );
  }
  const firstParsed = parseRequestUrl(url);
  const { endpoint: firstEndpoint, lookup: firstLookup } =
    await validateAndResolveUrl(firstParsed, service);
  const originalHost = firstParsed.hostname.toLowerCase();

  let currentUrl = url;
  let endpoint = firstEndpoint;
  let lookup = firstLookup;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const start = Date.now();
    const sameHost =
      parseRequestUrl(currentUrl).hostname.toLowerCase() === originalHost;
    let response: AxiosResponse<T>;
    try {
      response = await exec(currentUrl, lookup, sameHost);
    } catch (error) {
      const redirectTarget = redirectLocationFromError(error, currentUrl);
      recordSafely(
        sink,
        service,
        endpoint,
        extractStatusFromError(error),
        Date.now() - start
      );
      if (redirectTarget == null || !followRedirects) {
        throw redactCredentials(error);
      }
      ({ currentUrl, endpoint, lookup } = await resolveNextHop(
        redirectTarget,
        service
      ));
      continue;
    }

    const redirectTarget = redirectLocationFromResponse(response, currentUrl);
    if (redirectTarget == null) {
      recordSafely(
        sink,
        service,
        endpoint,
        response.status,
        Date.now() - start
      );
      return response;
    }
    recordSafely(sink, service, endpoint, response.status, Date.now() - start);
    if (!followRedirects) {
      throw new Error(
        `[observability] redirect not followed for service "${service}" (HTTP ${response.status})`
      );
    }
    ({ currentUrl, endpoint, lookup } = await resolveNextHop(
      redirectTarget,
      service
    ));
  }

  throw new Error(
    `[observability] too many redirects for service "${service}" (max ${MAX_REDIRECTS})`
  );
};

// Redirects are followed (and re-validated) by default. A caller that passes
// maxRedirects: 0 gets the 3xx back as a failure instead, for fetches where
// the response must come from the exact URL requested.
const followsRedirects = (config: AxiosRequestConfig | undefined): boolean =>
  config?.maxRedirects !== 0;

const configForHop = (
  config: AxiosRequestConfig | undefined,
  sameHost: boolean
): AxiosRequestConfig | undefined =>
  sameHost ? config : stripAuthForCrossHostHop(config);

export const makeInstrumentedAxios = (
  sink: ObservabilitySink
): InstrumentedAxios => ({
  get: (service, url, config) =>
    measure(
      sink,
      service,
      url,
      (hopUrl, lookup, sameHost) =>
        axios.get(
          hopUrl,
          mergeRequestOptions(configForHop(config, sameHost), lookup)
        ),
      followsRedirects(config)
    ),
  post: (service, url, data, config) =>
    measure(sink, service, url, (hopUrl, lookup, sameHost) =>
      axios.post(
        hopUrl,
        data,
        mergeRequestOptions(configForHop(config, sameHost), lookup)
      )
    ),
  put: (service, url, data, config) =>
    measure(sink, service, url, (hopUrl, lookup, sameHost) =>
      axios.put(
        hopUrl,
        data,
        mergeRequestOptions(configForHop(config, sameHost), lookup)
      )
    ),
  delete: (service, url, config) =>
    measure(sink, service, url, (hopUrl, lookup, sameHost) =>
      axios.delete(
        hopUrl,
        mergeRequestOptions(configForHop(config, sameHost), lookup)
      )
    ),
});

let cached: InstrumentedAxios | null = null;
const getInstrumentedAxios = (): InstrumentedAxios => {
  if (cached == null) {
    cached = makeInstrumentedAxios(getObservabilitySink());
  }
  return cached;
};

const proxy: InstrumentedAxios = {
  get: (service, url, config) =>
    getInstrumentedAxios().get(service, url, config),
  post: (service, url, data, config) =>
    getInstrumentedAxios().post(service, url, data, config),
  put: (service, url, data, config) =>
    getInstrumentedAxios().put(service, url, data, config),
  delete: (service, url, config) =>
    getInstrumentedAxios().delete(service, url, config),
};

export default proxy;
