import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { vi } from 'vitest';

import { buildMcpServer, type McpRequestContext } from '../McpServerFactory';
import type { McpToolsService } from '../McpToolsService';
import {
  DECK_VIEWER_TOOLS,
  DECK_VIEWER_URI,
  MCP_APP_MIME_TYPE,
  claudeUiDomain,
} from './deckViewerApp';

const CLAUDE_DOMAIN = 'f08a0679de488798a821ac5e35133759.claudemcpcontent.com';

async function connect(toolsService: Partial<McpToolsService> = {}) {
  const context: McpRequestContext = {
    owner: 'user-1',
    locals: {},
    toolsService: toolsService as McpToolsService,
    recordToolCall: () => {},
    recordToolResult: () => {},
  };
  const server = buildMcpServer(context);
  const client = new Client({ name: 'test-host', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

describe('claudeUiDomain', () => {
  it('hashes the production connector URL to the domain Claude expects', () => {
    expect(claudeUiDomain('https://2anki.net/mcp')).toBe(CLAUDE_DOMAIN);
  });
});

describe('deck viewer MCP App', () => {
  it('lists the ui:// resource with the MCP App mime type and Claude domain', async () => {
    const client = await connect();
    const { resources } = await client.listResources();
    const viewer = resources.find((entry) => entry.uri === DECK_VIEWER_URI);
    expect(viewer?.mimeType).toBe(MCP_APP_MIME_TYPE);
    expect(viewer?._meta).toMatchObject({
      ui: { domain: CLAUDE_DOMAIN, prefersBorder: false },
    });
  });

  it('serves self-contained HTML with the ui meta on the content', async () => {
    const client = await connect();
    const { contents } = await client.readResource({ uri: DECK_VIEWER_URI });
    expect(contents).toHaveLength(1);
    const [content] = contents;
    expect(content.mimeType).toBe(MCP_APP_MIME_TYPE);
    expect(content._meta).toEqual({
      ui: {
        domain: CLAUDE_DOMAIN,
        prefersBorder: false,
        csp: { connectDomains: [], resourceDomains: [] },
      },
    });
    const html = (content as { text: string }).text;
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('ui/initialize');
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(Buffer.byteLength(html)).toBeLessThan(40 * 1024);
  });

  it('points the three deck tools at the viewer, in both meta formats', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of DECK_VIEWER_TOOLS) {
      const tool = byName.get(name);
      expect(tool?._meta).toEqual({
        ui: { resourceUri: DECK_VIEWER_URI },
        'ui/resourceUri': DECK_VIEWER_URI,
      });
      expect(tool?.annotations?.title).toBe(tool?.title);
    }
    for (const name of [
      'list_my_decks',
      'photo_to_deck',
      'deck_capabilities',
    ]) {
      expect(byName.get(name)?._meta).toBeUndefined();
    }
  });

  it('keeps the text content of a preview unchanged when viewer fields are present', async () => {
    const preview = {
      cardCount: 2,
      deckCount: 1,
      decks: [{ name: 'Bio', cardCount: 2 }],
      sampleCards: [{ front: 'Q', back: 'A' }],
    };
    const plain = await connect({
      getDeckPreview: vi.fn(async () => preview),
    });
    const rich = await connect({
      getDeckPreview: vi.fn(async () => ({
        ...preview,
        sampleCards: [{ front: 'Q', back: 'A', tags: ['bio'] }],
        noteCount: 2,
        noteTypes: ['n2a-basic'],
        title: 'Bio',
        downloadUrl: 'https://2anki.net/api/upload/jobs/job-1/download',
      })),
    });
    const textOf = (result: Record<string, unknown>) =>
      (result.content as { type: string; text: string }[])[0].text.replace(
        /untrusted-data-[0-9a-f-]+/g,
        'untrusted-data'
      );
    const plainResult = await plain.callTool({
      name: 'get_deck_preview',
      arguments: { jobId: 'job-1' },
    });
    const richResult = await rich.callTool({
      name: 'get_deck_preview',
      arguments: { jobId: 'job-1' },
    });
    expect(textOf(richResult)).toBe(textOf(plainResult));
    expect(richResult.structuredContent).toMatchObject({
      noteCount: 2,
      noteTypes: ['n2a-basic'],
    });
  });
});
