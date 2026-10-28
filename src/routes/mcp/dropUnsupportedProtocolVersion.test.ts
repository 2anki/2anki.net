import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { makeDropUnsupportedProtocolVersion } from './dropUnsupportedProtocolVersion';

const statelessTransport: express.RequestHandler = async (req, res) => {
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  server.registerTool('ping_tool', { description: 'ping' }, async () => ({
    content: [{ type: 'text', text: 'pong' }],
  }));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
};

async function listTools(
  protocolVersion: string,
  log: (line: string) => void = () => {}
): Promise<{ status: number; body: string }> {
  const app = express();
  app.use(express.json());
  app.post('/mcp', makeDropUnsupportedProtocolVersion(log), statelessTransport);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': protocolVersion,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    return { status: response.status, body: await response.text() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('dropUnsupportedProtocolVersion', () => {
  it('answers a call that names a protocol version the SDK does not list', async () => {
    const response = await listTools('2099-01-01');

    expect(response.status).toBe(200);
    expect(response.body).toContain('ping_tool');
  });

  it('keeps a supported protocol version as the client sent it', async () => {
    const response = await listTools('2025-06-18');

    expect(response.status).toBe(200);
    expect(response.body).toContain('ping_tool');
  });

  it('names an unsupported version once per process, not once per call', async () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const drop = makeDropUnsupportedProtocolVersion(log);
    const request = (version: string) =>
      ({
        headers: { 'mcp-protocol-version': version },
        rawHeaders: ['MCP-Protocol-Version', version],
      }) as unknown as express.Request;

    for (const version of ['2099-01-01', '2099-01-01', '2099-02-02']) {
      const req = request(version);
      drop(req, {} as express.Response, () => {});
      expect(req.headers['mcp-protocol-version']).toBeUndefined();
      expect(req.rawHeaders).toEqual([]);
    }

    expect(lines).toEqual([
      '[mcp] accepting unsupported protocol version "2099-01-01"',
      '[mcp] accepting unsupported protocol version "2099-02-02"',
    ]);
  });
});
