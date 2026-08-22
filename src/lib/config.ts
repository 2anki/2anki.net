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

export const CONFIG_VARS: readonly ConfigVarSpec[] = [
  { name: 'SECRET', level: 'fatal', purpose: 'signs and verifies JWTs' },
  {
    name: 'WORKSPACE_BASE',
    level: 'fatal',
    purpose: 'root directory for uploads and conversion workspaces',
  },
  {
    name: 'DATABASE_URL',
    level: 'warn',
    purpose: 'Postgres connection; without it every query fails',
  },
  {
    name: 'STRIPE_KEY',
    level: 'warn',
    purpose: 'checkout, subscriptions, and Stripe sync',
  },
  {
    name: 'STRIPE_ENDPOINT_SECRET',
    level: 'warn',
    purpose: 'verifies Stripe webhook signatures',
  },
  {
    name: 'PASS_24H_PRICE_ID',
    level: 'warn',
    purpose: 'day-pass checkout price',
  },
  {
    name: 'PASS_7D_PRICE_ID',
    level: 'warn',
    purpose: 'week-pass checkout price',
  },
  {
    name: 'UNLIMITED_MONTHLY_PRICE_ID',
    level: 'warn',
    purpose: 'legacy monthly subscription price and v2 fallback',
  },
  {
    name: 'UNLIMITED_YEARLY_PRICE_ID',
    level: 'warn',
    purpose: 'legacy annual subscription price and v2 fallback',
  },
  {
    name: 'ANTHROPIC_API_KEY',
    level: 'warn',
    purpose: 'AI card generation, chat assistant, file conversion',
  },
  {
    name: 'SENDGRID_API_KEY',
    level: 'warn',
    purpose: 'transactional and batch email',
  },
  {
    name: 'DOMAIN',
    level: 'warn',
    purpose: 'absolute links in emails and OAuth redirects',
  },
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
