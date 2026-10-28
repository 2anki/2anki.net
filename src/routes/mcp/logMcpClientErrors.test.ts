import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { logMcpClientErrors } from './logMcpClientErrors';

async function withApp(
  handler: express.RequestHandler,
  run: (baseUrl: string, lines: string[]) => Promise<void>
): Promise<void> {
  const lines: string[] = [];
  const app = express();
  app.use(express.json());
  app.all(
    '/mcp',
    logMcpClientErrors((line) => lines.push(line))
  );
  app.post('/mcp', handler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`, lines);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const statelessTransport: express.RequestHandler = async (req, res) => {
  const server = new McpServer({ name: 'test', version: '1.0.0' });
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

async function waitForLine(lines: string[]): Promise<string> {
  for (let attempt = 0; attempt < 50 && lines.length === 0; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return lines[0];
}

describe('logMcpClientErrors', () => {
  it('logs the JSON-RPC reason, method and headers when the transport answers 400', async () => {
    await withApp(statelessTransport, async (baseUrl, lines) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '1999-01-01',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });

      expect(response.status).toBe(400);
      const line = await waitForLine(lines);
      expect(line).toContain('[mcp] POST /mcp 400');
      expect(line).toContain('code=-32000');
      expect(line).toContain('Unsupported protocol version: 1999-01-01');
      expect(line).toContain('method=tools/list');
      expect(line).toContain('protocol=1999-01-01');
      expect(line).toContain('accept="application/json, text/event-stream"');
      expect(line).toContain('content_type="application/json"');
    });
  });

  it('logs the 406 the transport sends a client that does not accept event streams', async () => {
    await withApp(statelessTransport, async (baseUrl, lines) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });

      expect(response.status).toBe(406);
      const line = await waitForLine(lines);
      expect(line).toContain('[mcp] POST /mcp 406');
      expect(line).toContain('code=-32000');
      expect(line).toContain('protocol=-');
      expect(line).toContain('accept="application/json"');
    });
  });

  it('logs the OAuth error code a bearer rejection carries', async () => {
    await withApp(
      (_req, res) => {
        res.status(401).json({
          error: 'invalid_token',
          error_description: 'Token has expired',
        });
      },
      async (baseUrl, lines) => {
        await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call' }),
        });

        const line = await waitForLine(lines);
        expect(line).toContain('[mcp] POST /mcp 401');
        expect(line).toContain('code=invalid_token');
        expect(line).toContain('message="Token has expired"');
        expect(line).toContain('method=tools/call');
      }
    );
  });

  it('never logs request arguments or the error data the transport attaches', async () => {
    await withApp(
      (_req, res) => {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: 'Parse error',
            data: 'ZodError: private study notes',
          },
          id: null,
        });
      },
      async (baseUrl, lines) => {
        await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'create_deck',
              arguments: { title: 'private study notes' },
            },
          }),
        });

        const line = await waitForLine(lines);
        expect(line).toContain('code=-32700');
        expect(line).not.toContain('private study notes');
        expect(line).not.toContain('create_deck');
      }
    );
  });

  it('names each method of a batch and replaces a method that is not a plain name', async () => {
    await withApp(
      (_req, res) => {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Invalid Request' },
          id: null,
        });
      },
      async (baseUrl, lines) => {
        await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify([
            { jsonrpc: '2.0', id: 1, method: 'initialize' },
            { jsonrpc: '2.0', id: 2, method: 'my notes\nforged line' },
          ]),
        });

        const line = await waitForLine(lines);
        expect(line).toContain('method=initialize,?');
        expect(line).not.toContain('\n');
      }
    );
  });

  it('logs nothing when the request succeeds', async () => {
    await withApp(
      (_req, res) => {
        res.status(200).json({ jsonrpc: '2.0', id: 1, result: {} });
      },
      async (baseUrl, lines) => {
        const response = await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });
        await response.text();
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(lines).toEqual([]);
      }
    );
  });
});
