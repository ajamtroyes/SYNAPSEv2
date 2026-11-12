export interface RawToolCall {
  id: string;
  functionName: string;
  /** JSON text, exactly as the model produced it. */
  argumentsJson: string;
  /** The harness resolves this to the underlying MCP tool, including for deferred calls. */
  toolInfoName?: string;
}

export interface NormalizedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Set when the JSON could not be parsed. Such a call is denied, never guessed at. */
  parseError?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A tool that is not preloaded reaches the model through TrueForge's `call_tool` meta tool, whose
 * arguments are `{ mcp_server, tool_name, input }`. Review needs the real tool and its own
 * arguments in both cases, and they must hash the same as what the MCP server receives.
 */
export function normalizeToolCall(raw: RawToolCall): NormalizedToolCall {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.argumentsJson === '' ? '{}' : raw.argumentsJson);
  } catch (error) {
    return {
      id: raw.id,
      name: raw.toolInfoName ?? raw.functionName,
      args: {},
      parseError: error instanceof Error ? error.message : 'invalid JSON',
    };
  }
  if (!isRecord(parsed)) {
    return { id: raw.id, name: raw.toolInfoName ?? raw.functionName, args: {}, parseError: 'arguments are not an object' };
  }
  if (typeof parsed['tool_name'] === 'string' && typeof parsed['mcp_server'] === 'string') {
    const input = parsed['input'];
    return { id: raw.id, name: parsed['tool_name'], args: isRecord(input) ? input : {} };
  }
  return { id: raw.id, name: raw.toolInfoName ?? raw.functionName, args: parsed };
}
