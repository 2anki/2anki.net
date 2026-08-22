/**
 * Boot-time inventory of the environment variables the server depends on.
 * New code adds its variable here (and to src/env.example) instead of
 * scattering bare process.env reads: `fatal` vars refuse to boot when unset,
 * `warn` vars print one loud block at production boot so a half-configured
 * box is visible immediately instead of failing at first use, days later.
 */
interface ConfigVarSpec {
  name: string;
  level: 'fatal' | 'warn';
  purpose: string;
}

const FATAL_VARS: ReadonlyArray<[string, string]> = [
  ['SECRET', 'signs and verifies JWTs'],
  ['WORKSPACE_BASE', 'root directory for uploads and conversion workspaces'],
];

const WARN_VARS: ReadonlyArray<[string, string]> = [
  ['DATABASE_URL', 'Postgres connection; without it every query fails'],
  ['STRIPE_KEY', 'checkout, subscriptions, and Stripe sync'],
  ['STRIPE_ENDPOINT_SECRET', 'verifies Stripe webhook signatures'],
  ['PASS_24H_PRICE_ID', 'day-pass checkout price'],
  ['PASS_7D_PRICE_ID', 'week-pass checkout price'],
  ['UNLIMITED_MONTHLY_PRICE_ID', 'legacy monthly price and v2 fallback'],
  ['UNLIMITED_YEARLY_PRICE_ID', 'legacy annual price and v2 fallback'],
  ['ANTHROPIC_API_KEY', 'AI card generation, chat assistant, file conversion'],
  ['SENDGRID_API_KEY', 'transactional and batch email'],
  ['DOMAIN', 'absolute links in emails and OAuth redirects'],
];

const toSpec =
  (level: ConfigVarSpec['level']) =>
  ([name, purpose]: [string, string]): ConfigVarSpec => ({
    name,
    level,
    purpose,
  });

export const CONFIG_VARS: readonly ConfigVarSpec[] = [
  ...FATAL_VARS.map(toSpec('fatal')),
  ...WARN_VARS.map(toSpec('warn')),
];

export interface ConfigReport {
  missingFatal: string[];
  missingWarn: string[];
}

export function inspectConfig(
  env: NodeJS.ProcessEnv = process.env
): ConfigReport {
  const missing = (level: 'fatal' | 'warn') =>
    CONFIG_VARS.filter(
      (spec) => spec.level === level && (env[spec.name] ?? '') === ''
    ).map((spec) => spec.name);
  return { missingFatal: missing('fatal'), missingWarn: missing('warn') };
}

/**
 * Refuses to boot when any fatal variable is unset — all of them listed in
 * one error, not one crash per variable. In production, additionally prints
 * a single block naming every unset `warn` variable and what stops working.
 */
export function assertBootConfig(env: NodeJS.ProcessEnv = process.env): void {
  const { missingFatal, missingWarn } = inspectConfig(env);

  if (missingFatal.length > 0) {
    throw new Error(
      `Refusing to boot — required environment variable(s) unset: ${missingFatal.join(', ')}`
    );
  }

  if (env.NODE_ENV === 'production' && missingWarn.length > 0) {
    const lines = missingWarn.map((name) => {
      const spec = CONFIG_VARS.find((v) => v.name === name);
      return `  ${name} — ${spec?.purpose ?? ''}`;
    });
    console.error(
      `[config] ${missingWarn.length} environment variable(s) unset in production:\n${lines.join('\n')}`
    );
  }
}
