import { createHash } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { mcpBaseUrl } from '../mcpBaseUrl';
import { buildDeckViewerHtml } from './deckViewerHtml';

// MCP Apps (io.modelcontextprotocol/ui): a ui:// HTML resource the host renders
// in a sandboxed frame next to the tool result. These mirror what
// @modelcontextprotocol/ext-apps' registerAppTool/registerAppResource write;
// that package's 1.x helpers are three lines over the SDK and its 2.x line
// targets the v2 SDK, so the metadata is written here directly.
export const DECK_VIEWER_URI = 'ui://2anki/deck-viewer.html';
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';
const LEGACY_RESOURCE_URI_KEY = 'ui/resourceUri';

export const DECK_VIEWER_TOOLS = [
  'get_deck_preview',
  'create_deck',
  'convert_to_deck',
] as const;

// Claude serves each app from its own sandbox origin: the first 32 hex
// characters of the SHA-256 of the connector URL, under claudemcpcontent.com.
// It changes if the server URL changes, so derive it rather than hardcode it.
export function claudeUiDomain(serverUrl: string): string {
  const hash = createHash('sha256').update(serverUrl).digest('hex');
  return `${hash.slice(0, 32)}.claudemcpcontent.com`;
}

export function mcpServerUrl(): string {
  return `${mcpBaseUrl()}/mcp`;
}

export function deckViewerToolMeta(): Record<string, unknown> {
  return {
    ui: { resourceUri: DECK_VIEWER_URI },
    [LEGACY_RESOURCE_URI_KEY]: DECK_VIEWER_URI,
  };
}

export function deckViewerResourceMeta(
  serverUrl: string = mcpServerUrl()
): Record<string, unknown> {
  return {
    ui: {
      domain: claudeUiDomain(serverUrl),
      prefersBorder: false,
      // Everything is inline and data arrives over postMessage, so the frame
      // needs no network origins at all.
      csp: { connectDomains: [], resourceDomains: [] },
    },
  };
}

let cachedHtml: string | null = null;

function deckViewerHtml(): string {
  cachedHtml ??= buildDeckViewerHtml();
  return cachedHtml;
}

export function registerDeckViewerResource(
  server: McpServer,
  serverUrl: string = mcpServerUrl()
): void {
  const meta = deckViewerResourceMeta(serverUrl);
  server.registerResource(
    'Deck viewer',
    DECK_VIEWER_URI,
    {
      title: 'Deck viewer',
      description:
        'Card viewer for 2anki deck results: front and back, subdecks, tags and the .apkg download.',
      mimeType: MCP_APP_MIME_TYPE,
      _meta: meta,
    },
    async () => ({
      contents: [
        {
          uri: DECK_VIEWER_URI,
          mimeType: MCP_APP_MIME_TYPE,
          text: deckViewerHtml(),
          _meta: meta,
        },
      ],
    })
  );
}
