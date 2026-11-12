import { z } from 'zod';

const McpServerSchema = z.strictObject({
  name: z.string().min(1),
  enable_tools: z.array(z.string()).optional(),
  disable_tools: z.array(z.string()).optional(),
  preload: z.boolean().optional(),
  preload_tools: z.array(z.string()).optional(),
  require_approval_for_tools: z.array(z.string()).optional(),
});

const EnabledSchema = z.strictObject({ enabled: z.boolean() });

/**
 * The agent definitions in `agent/definitions` use TrueForge's wire format, so they can be read
 * alongside its docs. They carry no model: choosing one is the user's configuration, and hard-coding
 * a provider is disallowed by the competition rules.
 */
export const AgentDefinitionSchema = z.strictObject({
  description: z.string().min(1),
  instructions: z.string().min(1),
  mcp_servers: z.array(McpServerSchema).min(1),
  config: z.strictObject({
    sandbox: EnabledSchema,
    web_search: EnabledSchema,
    generative_ui: EnabledSchema,
    ask_user_questions: EnabledSchema,
    dynamic_sub_agents: EnabledSchema,
    context_management: z.strictObject({
      compaction: EnabledSchema,
      large_tool_response: EnabledSchema,
    }),
    iteration_limit: z.number().int().min(1).max(1024),
  }),
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

/** The definition in the SDK's camelCase form, with the model filled in. */
export function toSdkSpec(definition: AgentDefinition, model: string) {
  const { config } = definition;
  return {
    model: { name: model },
    instructions: definition.instructions,
    mcpServers: definition.mcp_servers.map(server => ({
      name: server.name,
      ...(server.enable_tools ? { enableTools: server.enable_tools } : {}),
      ...(server.disable_tools ? { disableTools: server.disable_tools } : {}),
      ...(server.preload === undefined ? {} : { preload: server.preload }),
      ...(server.preload_tools ? { preloadTools: server.preload_tools } : {}),
      ...(server.require_approval_for_tools ? { requireApprovalForTools: server.require_approval_for_tools } : {}),
    })),
    config: {
      sandbox: config.sandbox,
      webSearch: config.web_search,
      generativeUi: config.generative_ui,
      askUserQuestions: config.ask_user_questions,
      dynamicSubAgents: config.dynamic_sub_agents,
      contextManagement: {
        compaction: config.context_management.compaction,
        largeToolResponse: config.context_management.large_tool_response,
      },
      iterationLimit: config.iteration_limit,
    },
  };
}
