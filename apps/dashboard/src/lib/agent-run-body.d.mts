// Type declarations for agent-run-body.mjs (agent 엔진 검수 요청 본문).

export type AgentRunOptionsInput = {
  loginMode: "none" | "credentials" | "handover";
  username: string;
  password: string;
  loginUrl: string;
  consent: boolean;
};

export function agentRunBody(v: AgentRunOptionsInput): {
  engine: "agent";
  loginMode?: "credentials" | "handover";
  testCredentials?: { username: string; password: string; loginUrl?: string; consent: true };
  handoverConsent?: true;
};

export function agentOptionsReady(v: AgentRunOptionsInput): boolean;
