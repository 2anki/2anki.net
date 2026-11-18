const LIMIT_KINDS: ReadonlySet<string> = new Set(['partial', 'held', 'limit']);
const ARMS: ReadonlySet<string> = new Set(['a', 'b']);

export interface ConnectorLinkLabels {
  kind: string | null;
  arm: string | null;
}

export function connectorLinkLabels(
  params: URLSearchParams
): ConnectorLinkLabels {
  const kind = params.get('k');
  const arm = params.get('a');
  return {
    kind: kind != null && LIMIT_KINDS.has(kind) ? kind : null,
    arm: arm != null && ARMS.has(arm) ? arm : null,
  };
}
