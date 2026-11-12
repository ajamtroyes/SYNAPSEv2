import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ToolInputError } from '../core/paths';
import type { ToolDefinition } from './tools';

export interface RunningMcpServer {
  url: string;
  token: string;
  close(): Promise<void>;
}

function buildServer(tools: readonly ToolDefinition[]): Server {
  const server = new Server({ name: 'synapse-editor', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(tool => {
      // These schemas reach whichever provider is configured, and not all accept a "$schema" key.
      const { $schema: _unused, ...inputSchema } = z.toJSONSchema(tool.schema);
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: inputSchema as { type: 'object' },
        annotations: tool.annotations,
      };
    }),
  }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const tool = tools.find(candidate => candidate.name === request.params.name);
    const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });
    if (!tool) {
      return fail(`Unknown tool ${request.params.name}.`);
    }
    const rawArgs = request.params.arguments ?? {};
    const parsed = tool.schema.safeParse(rawArgs);
    if (!parsed.success) {
      return fail(`Invalid arguments for ${tool.name}: ${z.prettifyError(parsed.error)}`);
    }
    try {
      const result = await tool.run(parsed.data as never, rawArgs);
      return { content: [{ type: 'text' as const, text: result.text }], isError: result.isError ?? false };
    } catch (error) {
      if (error instanceof ToolInputError) {
        return fail(error.message);
      }
      return fail(`${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return server;
}

function tokensMatch(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const received = Buffer.from(header ?? '');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function reject(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: message }));
}

async function handle(req: IncomingMessage, res: ServerResponse, tools: readonly ToolDefinition[], token: string, port: () => number): Promise<void> {
  // A web page can reach loopback from the browser. These two checks stop it driving the tools.
  const allowedHosts = new Set([`127.0.0.1:${String(port())}`, `localhost:${String(port())}`]);
  if (!allowedHosts.has(req.headers.host ?? '')) {
    reject(res, 403, 'Host not allowed');
    return;
  }
  if (!tokensMatch(req.headers.authorization, token)) {
    reject(res, 401, 'Missing or invalid bearer token');
    return;
  }
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/mcp') {
    reject(res, 404, 'Not found');
    return;
  }
  if (req.method !== 'POST') {
    // Stateless server: there is no session to stream to or to delete.
    res.writeHead(405, { allow: 'POST', 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  const server = buildServer(tools);
  // No session id generator means stateless: each request gets its own short-lived server.
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

/**
 * Exposes the editor to the agent. TrueForge only connects to remote MCP servers over HTTP, so the
 * extension host runs one on loopback, on a random port, protected by a per-activation token.
 */
export async function startMcpServer(tools: readonly ToolDefinition[]): Promise<RunningMcpServer> {
  const token = randomBytes(32).toString('hex');
  const http: HttpServer = createServer((req, res) => {
    handle(req, res, tools, token, () => (http.address() as AddressInfo).port).catch((error: unknown) => {
      if (!res.headersSent) {
        reject(res, 500, error instanceof Error ? error.message : 'Internal error');
      }
    });
  });
  await new Promise<void>((resolve, rejectListen) => {
    http.once('error', rejectListen);
    http.listen(0, '127.0.0.1', resolve);
  });
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/mcp`,
    token,
    close: () =>
      new Promise(resolve => {
        http.close(() => {
          resolve();
        });
        http.closeAllConnections();
      }),
  };
}
