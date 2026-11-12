import { TrueForge } from '@truefoundry/trueforge-sdk';

export const MCP_SERVER_NAME = 'synapse-editor';

export function createClient(baseUrl: string): TrueForge {
  return new TrueForge({ baseUrl });
}

/** Upserted on activation because the MCP port and token change every time the editor starts. */
export async function registerMcpServer(client: TrueForge, url: string, token: string): Promise<void> {
  await client.settings.mcpServers.createOrUpdate({
    manifest: {
      type: 'remote',
      name: MCP_SERVER_NAME,
      url,
      description: 'The VS Code workspace: read and search code, propose reviewed edits, run approved commands.',
      auth: { type: 'header', headers: { Authorization: `Bearer ${token}` } },
    },
  });
}

export interface SetupReport {
  ok: boolean;
  lines: string[];
}

function explain(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Answers "why is it not working?" for the mistakes a fresh clone can actually make. */
export async function checkSetup(client: TrueForge, baseUrl: string, models: readonly string[]): Promise<SetupReport> {
  const lines: string[] = [];
  let ok = true;
  const fail = (line: string): void => {
    ok = false;
    lines.push(`✗ ${line}`);
  };
  try {
    const health = await fetch(new URL('/healthz', baseUrl));
    if (!health.ok) {
      throw new Error(`HTTP ${String(health.status)}`);
    }
    lines.push(`✓ TrueForge is running at ${baseUrl}`);
  } catch (error) {
    fail(`Cannot reach TrueForge at ${baseUrl} (${explain(error)}). Start it with: npm run trueforge`);
    return { ok, lines };
  }
  try {
    const { data } = await client.mcpServers.listTools(MCP_SERVER_NAME);
    lines.push(`✓ TrueForge can reach the editor's MCP server (${String(data.length)} tools)`);
  } catch (error) {
    const text = explain(error);
    fail(
      /blocked/i.test(text)
        ? `TrueForge blocked the loopback MCP server. Start it with OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]', which npm run trueforge does for you. (${text})`
        : `TrueForge cannot reach the editor's MCP server: ${text}`,
    );
  }
  if (models.length === 0) {
    fail('No models chosen. Set "synapse.models" to an ordered list of provider/model names.');
  } else {
    try {
      const { data } = await client.models.list();
      const available = new Set(data.map(model => model.name));
      for (const model of models) {
        if (available.has(model)) {
          lines.push(`✓ Model ${model} is configured in TrueForge`);
        } else {
          fail(`Model ${model} is not configured in TrueForge. Run npm run setup:models, or fix "synapse.models".`);
        }
      }
    } catch (error) {
      fail(`Could not list models: ${explain(error)}`);
    }
  }
  return { ok, lines };
}
