// Jest stub for metascraper-* plugin packages. The real packages export a
// rule FACTORY that useMetadata must call (#4205) — the stub keeps that
// shape so a composition that forgets the call fails in jest the same way
// it fails in production. See metascraper.ts for why the real packages are
// kept out of the jest module graph.
const pluginFactory = (): Record<string, unknown> => ({});

export = pluginFactory;
