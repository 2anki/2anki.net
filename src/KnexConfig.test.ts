type MigrationsConfig = { disableMigrationsListValidation?: boolean };

function loadWholeConfigWithoutDatabaseUrl() {
  jest.resetModules();
  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const config = require('./KnexConfig').default;
  if (original === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = original;
  }
  return config as { connection: string };
}

function loadConfigWith(localDev: string | undefined) {
  jest.resetModules();
  const original = process.env.LOCAL_DEV;
  if (localDev === undefined) {
    delete process.env.LOCAL_DEV;
  } else {
    process.env.LOCAL_DEV = localDev;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const config = require('./KnexConfig').default;
  if (original === undefined) {
    delete process.env.LOCAL_DEV;
  } else {
    process.env.LOCAL_DEV = original;
  }
  return config.migrations as MigrationsConfig;
}

describe('KnexConfig migrations validation', () => {
  it('disables migration-list validation in local dev', () => {
    expect(loadConfigWith('true').disableMigrationsListValidation).toBe(true);
  });

  it('keeps strict validation when LOCAL_DEV is unset (prod/CI)', () => {
    expect(loadConfigWith(undefined).disableMigrationsListValidation).toBe(
      false
    );
  });

  it('keeps strict validation when LOCAL_DEV is not exactly "true"', () => {
    expect(loadConfigWith('false').disableMigrationsListValidation).toBe(false);
  });
});

describe('KnexConfig local fallback connection', () => {
  // The fallback DSN once embedded a real username and password in a public
  // repo (CWE-798, secrets:S6698). It must stay credential-free.
  it('falls back to a localhost DSN carrying no credentials', () => {
    const connection = loadWholeConfigWithoutDatabaseUrl().connection;

    expect(connection).toBe('postgresql://localhost:5432/n');
    expect(connection).not.toContain('@');
    expect(connection).not.toMatch(/:\/\/[^/]*:[^/]*@/);
  });

  it('prefers DATABASE_URL when it is set', () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://example-host:5432/example';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require('./KnexConfig').default as { connection: string };

    expect(config.connection).toBe('postgresql://example-host:5432/example');

    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  });
});
