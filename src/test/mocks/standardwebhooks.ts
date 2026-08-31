// Jest stub for standardwebhooks. @anthropic-ai/sdk 0.122 imports it eagerly
// (resources/beta/webhooks.ts), and its @stablelib/base64 dependency ships
// ESM-only modules the CommonJS jest transform can't parse. The server has no
// Anthropic webhook endpoint and no test exercises webhook verification, so
// this stub keeps the ESM chain out of the jest module graph. Plain Node 22
// loads the real chain fine (require(esm)), so runtime is unaffected.
class Webhook {
  verify(_payload: unknown, _headers: unknown): never {
    throw new Error('standardwebhooks is stubbed in jest');
  }
}

export = { Webhook };
