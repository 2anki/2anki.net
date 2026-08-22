import { assertBootConfig, inspectConfig, CONFIG_VARS } from './config';

const fullEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(CONFIG_VARS.map((v) => [v.name, 'set']));

describe('inspectConfig', () => {
  it('reports nothing missing when every variable is set', () => {
    expect(inspectConfig(fullEnv())).toEqual({
      missingFatal: [],
      missingWarn: [],
    });
  });

  it('reports unset and empty-string variables as missing', () => {
    const env = fullEnv();
    delete env.SECRET;
    env.STRIPE_KEY = '';

    const report = inspectConfig(env);

    expect(report.missingFatal).toEqual(['SECRET']);
    expect(report.missingWarn).toEqual(['STRIPE_KEY']);
  });
});

describe('assertBootConfig', () => {
  it('throws naming every missing fatal variable at once', () => {
    const env = fullEnv();
    delete env.SECRET;
    delete env.WORKSPACE_BASE;

    expect(() => assertBootConfig(env)).toThrow(
      /SECRET.*WORKSPACE_BASE|WORKSPACE_BASE.*SECRET/
    );
  });

  it('boots quietly outside production when warn variables are unset', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const env = fullEnv();
    delete env.STRIPE_KEY;
    env.NODE_ENV = 'test';

    expect(() => assertBootConfig(env)).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('prints one block naming unset warn variables in production', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const env = fullEnv();
    delete env.STRIPE_KEY;
    delete env.ANTHROPIC_API_KEY;
    env.NODE_ENV = 'production';

    expect(() => assertBootConfig(env)).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = errorSpy.mock.calls[0][0] as string;
    expect(message).toContain('STRIPE_KEY');
    expect(message).toContain('ANTHROPIC_API_KEY');
    errorSpy.mockRestore();
  });

  it('keeps every inventoried variable documented in env.example', () => {
    const fs = jest.requireActual<typeof import('fs')>('fs');
    const example = fs.readFileSync('src/env.example', 'utf8');
    for (const spec of CONFIG_VARS) {
      expect(example).toContain(`${spec.name}=`);
    }
  });
});
