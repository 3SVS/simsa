/**
 * Minimal shape of the Anthropic SDK client that ClaudeWorker needs.
 * Structurally identical to the one in agent-claude — duplicated here
 * rather than imported so each agent package can evolve independently
 * and so tests can inject mocks without pulling the agent-claude build.
 */
export interface AnthropicLike {
  messages: {
    create(params: AnthropicCreateParams): Promise<AnthropicResponse>;
  };
}

/** B4 빌드 루프의 다중 턴 tool_use를 위해 content가 블록 배열일 수 있다. 단일 턴 워커는 문자열 그대로. */
export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ReadonlyArray<AnthropicContentBlock>;
}

export interface AnthropicCreateParams {
  model: string;
  max_tokens: number;
  system?: string | ReadonlyArray<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  messages: ReadonlyArray<AnthropicMessage>;
  tools?: ReadonlyArray<{
    name: string;
    description: string;
    input_schema: unknown;
  }>;
  tool_choice?: { type: "tool"; name: string } | { type: "auto" } | { type: "any" };
}

export interface AnthropicResponse {
  id: string;
  model: string;
  content: ReadonlyArray<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  stop_reason?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}
