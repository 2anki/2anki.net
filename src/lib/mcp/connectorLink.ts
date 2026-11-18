export type ConnectorLimitKind = 'partial' | 'held' | 'limit' | 'photo';

export type ConnectorArm = 'a' | 'b';

export const CONNECTOR_REF = 'mcp';
export const CONNECTOR_RETURN_MARKER = 'r';
export const CONNECTOR_RETURN_VALUE = '1';

const LIMIT_KINDS: ReadonlySet<string> = new Set<ConnectorLimitKind>([
  'partial',
  'held',
  'limit',
  'photo',
]);

const ARMS: ReadonlySet<string> = new Set<ConnectorArm>(['a', 'b']);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function connectorArmFor(userId: number | null): ConnectorArm {
  return userId != null && userId % 2 === 0 ? 'b' : 'a';
}

export function parseConnectorLimitKind(
  value: string | null
): ConnectorLimitKind | null {
  return value != null && LIMIT_KINDS.has(value)
    ? (value as ConnectorLimitKind)
    : null;
}

export function parseConnectorArm(value: string | null): ConnectorArm | null {
  return value != null && ARMS.has(value) ? (value as ConnectorArm) : null;
}

export function parseIsoDate(value: string | null): string | null {
  const match = value == null ? null : ISO_DATE.exec(value);
  if (match == null) {
    return null;
  }
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return isRealDate ? match[0] : null;
}

export interface ConnectorLinkParams {
  kind: ConnectorLimitKind | null;
  arm: ConnectorArm | null;
  heldUntil: string | null;
  returned: boolean;
}

export function readConnectorLinkParams(
  params: URLSearchParams
): ConnectorLinkParams {
  return {
    kind: parseConnectorLimitKind(params.get('k')),
    arm: parseConnectorArm(params.get('a')),
    heldUntil: parseIsoDate(params.get('held_until')),
    returned: isConnectorReturn(params),
  };
}

function isConnectorReturn(params: URLSearchParams): boolean {
  const markers = params.getAll(CONNECTOR_RETURN_MARKER);
  return markers.length === 1 && markers[0] === CONNECTOR_RETURN_VALUE;
}
