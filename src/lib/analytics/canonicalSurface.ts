export interface SurfaceProps {
  surface?: unknown;
  kind?: unknown;
  source?: unknown;
}

// A paywall that reports no surface still says what stopped the person and
// where. `anonymous` is the no-account conversion cap, `card_count` the monthly
// one; the source is the path they came in through. Naming them keeps the
// largest bucket in the funnel from reading as unattributed.
const KIND_PREFIX: Readonly<Record<string, string>> = {
  anonymous: 'anonymous_cap',
  card_count: 'card_limit',
};

const underscore = (value: string): string => value.replace(/-/g, '_');

const asText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * One spelling per surface, for reading ninety days of history that used
 * several. Hyphen and underscore forms of the same name were written by
 * different call sites — `upload-limit-wall` from checkout metadata against
 * `upload_limit_wall` from the paywall event — which split one surface into a
 * wall that converts nothing and a checkout that comes from nowhere.
 */
export const canonicalizeSurface = (
  props: SurfaceProps | null | undefined
): string | null => {
  const surface = asText(props?.surface);
  if (surface !== '') {
    return underscore(surface);
  }

  const prefix = KIND_PREFIX[asText(props?.kind)];
  const source = asText(props?.source);
  if (prefix == null || source === '') {
    return null;
  }
  return `${prefix}_${underscore(source)}`;
};

const surfaceText = "nullif(btrim(props->>'surface'), '')";
const sourceText = "nullif(btrim(props->>'source'), '')";

// Built from the same map the TypeScript path uses so the two cannot drift.
// Grouping happens on this expression rather than on the raw value, because
// folding the rows afterwards would sum distinct-person counts and count
// anyone who met two spellings of one surface twice.
export const canonicalSurfaceSql = (): string => {
  const kindArms = Object.entries(KIND_PREFIX)
    .map(
      ([kind, prefix]) =>
        `WHEN props->>'kind' = '${kind}' AND ${sourceText} IS NOT NULL ` +
        `THEN '${prefix}_' || replace(btrim(props->>'source'), '-', '_')`
    )
    .join(' ');

  return (
    `CASE WHEN ${surfaceText} IS NOT NULL ` +
    `THEN replace(btrim(props->>'surface'), '-', '_') ` +
    `${kindArms} ELSE NULL END`
  );
};
