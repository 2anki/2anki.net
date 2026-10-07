import { vi } from 'vitest';
type MigrationsConfig = { disableMigrationsListValidation?: boolean };

async function loadWholeConfigWithoutDatabaseUrl() {
  vi.resetModules();
  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const config = (await import('./KnexConfig')).default;
  if (original === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = original;
  }
  return config as { connection: string };
}

async function loadConfigWith(localDev: string | undefined) {
  vi.resetModules();
  const original = process.env.LOCAL_DEV;
  if (localDev === undefined) {
    delete process.env.LOCAL_DEV;
  } else {
    process.env.LOCAL_DEV = localDev;
  }
  const config = (await import('./KnexConfig')).default;
  if (original === undefined) {
    delete process.env.LOCAL_DEV;
  } else {
    process.env.LOCAL_DEV = original;
  }
  return config.migrations as MigrationsConfig;
}

describe('KnexConfig migrations validation', () => {
  it('disables migration-list validation in local dev', async () => {
    expect((await loadConfigWith('true')).disableMigrationsListValidation).toBe(
      true
    );
  });

  it('keeps strict validation when LOCAL_DEV is unset (prod/CI)', async () => {
    expect(
      (await loadConfigWith(undefined)).disableMigrationsListValidation
    ).toBe(false);
  });

  it('keeps strict validation when LOCAL_DEV is not exactly "true"', async () => {
    expect(
      (await loadConfigWith('false')).disableMigrationsListValidation
    ).toBe(false);
  });
});

describe('KnexConfig local fallback connection', () => {
  // The fallback DSN once embedded a real username and password in a public
  // repo (CWE-798, secrets:S6698). It must stay credential-free.
  it('falls back to a localhost DSN carrying no credentials', async () => {
    const connection = (await loadWholeConfigWithoutDatabaseUrl()).connection;

    expect(connection).toBe('postgresql://localhost:5432/n');
    expect(connection).not.toContain('@');
    expect(connection).not.toMatch(/:\/\/[^/]*:[^/]*@/);
  });

  it('prefers DATABASE_URL when it is set', async () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://example-host:5432/example';
    vi.resetModules();
    const config = (await import('./KnexConfig')).default as {
      connection: string;
    };

    expect(config.connection).toBe('postgresql://example-host:5432/example');

    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  });
});
