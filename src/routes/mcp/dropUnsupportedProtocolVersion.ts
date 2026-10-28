import type { RequestHandler } from 'express';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';

const PROTOCOL_VERSION_HEADER = 'mcp-protocol-version';
const MAX_NAMED_VERSIONS = 20;
const DATED_VERSION = /^\d{4}-\d{2}-\d{2}$/;

// Claude sends some calls an MCP-Protocol-Version this SDK does not list, and
// the SDK refuses them with a 400 (#5073: about 6% of POST /mcp). The transport
// is stateless, so the header only gates the call: without it the SDK reads
// the call under its default version instead of refusing it. This knowingly
// departs from the spec's 400 for an unsupported version; once an SDK release
// lists the version these logs name, upgrade and remove this. Each unknown
// dated version is named once per process so the logs show what clients send.
export function makeDropUnsupportedProtocolVersion(
  log: (line: string) => void = console.warn
): RequestHandler {
  const named = new Set<string>();
  return (req, _res, next) => {
    const version = req.headers[PROTOCOL_VERSION_HEADER];
    if (
      version == null ||
      (typeof version === 'string' &&
        SUPPORTED_PROTOCOL_VERSIONS.includes(version))
    ) {
      next();
      return;
    }
    const label = String(version);
    if (
      DATED_VERSION.test(label) &&
      !named.has(label) &&
      named.size < MAX_NAMED_VERSIONS
    ) {
      named.add(label);
      log(
        `[mcp] accepting unsupported protocol version ${JSON.stringify(label)}`
      );
    }
    delete req.headers[PROTOCOL_VERSION_HEADER];
    const rawHeaders: string[] = [];
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      if (req.rawHeaders[index].toLowerCase() !== PROTOCOL_VERSION_HEADER) {
        rawHeaders.push(req.rawHeaders[index], req.rawHeaders[index + 1]);
      }
    }
    req.rawHeaders = rawHeaders;
    next();
  };
}
