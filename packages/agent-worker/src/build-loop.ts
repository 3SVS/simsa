/**
 * SI 티어 Train B — B4: 빌드 에이전트 루프 (D-4 · D-14 권고 "자체 agent-worker 루프").
 *
 * 한 WBS 항목을 받아 모델과 다중 턴 tool_use를 돈다: read/list/create/run_command → 결과 회신 → … → finish.
 * 모든 도구 호출은 **정책(build-policy)이 먼저 판정**하고, 통과한 것만 주입된 executor가 실행한다.
 * 거부된 호출은 실행되지 않고 오류가 모델에 돌아간다(카운트 → maxDenied에서 정직 실패).
 *
 * 순수성: 이 모듈은 파일시스템·프로세스·네트워크에 직접 손대지 않는다(executor·client 주입).
 * LLM 호출은 EfficiencyGate.run 경유(CLAUDE.md "direct SDK calls are forbidden").
 * 클라이언트는 AnthropicLike 어떤 것이든(withOpenAiFallback 포함 — B5에서 블록 변환을 붙여 OpenAI만으로도 돈다).
 */
import { EfficiencyGate, estimateTokens } from "@simsa/core";
import type { AnthropicLike, AnthropicCreateParams, AnthropicMessage, AnthropicResponse } from "./anthropic-types.js";
import { BUILD_LIMITS, decideCommand, decidePath, filterEnv, findSecretLike } from "./build-policy.js";
import { BUILD_SYSTEM_PROMPT, BUILD_TOOLS } from "./build-tools.js";
import { estimateCallCost, usageRecordFromResponse, type LlmUsageRecord } from "./pricing.js";

// L-1/L-2 (Train L): 종전의 safeEstimate/safeActual은 가격표에 없는 모델을 **$0으로 삼켰고**(예산 게이트 우회),
// 비용을 **요청 모델**로 계산했다(프로덕션은 ANTHROPIC_ENABLED=off라 실제 응답은 gpt-5.4). 이제
// estimateCallCost/priceUsage는 던지지 않고 미지 모델을 보수 단가로 계산하며, 실제 비용은
// usageRecordFromResponse가 **응답의 model**로 매긴다(없으면 요청 모델). 비용을 모르는 것은 여전히
// 빌드 실패 사유가 아니다 — 대신 unpriced로 드러난다.

export type CommandResult = { ok: boolean; code: number; stdout: string; stderr: string; timedOut?: boolean };

/** 호출자(빌더 컨테이너)가 구현하는 실행기. 경로는 정책이 정규화한 저장소 상대 경로. */
export interface BuildToolExecutor {
  readFile(path: string): Promise<string | null>;
  listFiles(dir: string): Promise<string[]>;
  createFile(path: string, content: string): Promise<void>;
  runCommand(cmd: string, args: readonly string[], opts: { timeoutMs: number; env: Record<string, string> }): Promise<CommandResult>;
}

export interface BuildTask {
  /** 사람이 읽는 지시서 발췌(요구사항·AC·화면·데이터·이 WBS 항목). 마크다운. */
  specMarkdown: string;
  /** 이번 항목. */
  wbsId: string;
  wbsTitle: string;
  acceptanceIds: readonly string[];
  locale: "ko" | "en";
  /** 저장소 파일 목록(초기 컨텍스트). */
  fileList: readonly string[];
}

export type DeniedCall = { tool: string; reason: string; detail?: string };

export type BuildLoopOutcome = {
  status: "done" | "gave_up" | "limit_turns" | "limit_tool_calls" | "limit_denied" | "llm_error";
  summary: string;
  commitMessage: string | null;
  filesWritten: string[];
  commandsRun: Array<{ cmd: string; args: string[]; code: number; ms: number }>;
  denied: DeniedCall[];
  turns: number;
  toolCalls: number;
  tokensUsed: number;
  costUsd: number;
  /** 마지막 빌드 명령의 종료 코드(있으면). done인데 0이 아니면 호출자가 신뢰하지 않는다(D-4 게이트). */
  lastBuildExitCode: number | null;
  /** L-2/L-3: 턴별 LLM 사용량(요청·실제 모델·벤더·토큰·비용). 컨테이너 콜백 `usage[]`의 원천. */
  usage: LlmUsageRecord[];
  /** L-1: 공식 단가를 몰라 보수 단가로 계산한 호출 수. 0이 아니면 costUsd는 상한 추정이다. */
  unpricedCalls: number;
};

export interface BuildLoopOptions {
  client: AnthropicLike;
  executor: BuildToolExecutor;
  model: string;
  gate?: EfficiencyGate;
  maxTokens?: number;
  limits?: Partial<typeof BUILD_LIMITS>;
  /** 자식 프로세스 env의 원천(보통 process.env). filterEnv로 걸러진다. */
  baseEnv?: Readonly<Record<string, string | undefined>>;
  onEvent?: (line: string) => void;
  /**
   * L-3: 턴마다 사용량 레코드를 흘려보낸다(로그·로컬 계측용). 던져도 루프는 계속.
   * 콜백 usage[]로 원장에 싣는 경로는 **수리 컨테이너(repair-done) 전용**이다 — 빌더 컨테이너는 이것을 콜백에 싣지 않는다:
   * 빌드 원가는 Worker의 /internal/build-llm 프록시가 호출마다 계량하고 build-progress·build-done은 usage[]를 무시한다
   * (B-5b S1 — 이중 계상 금지).
   */
  onUsage?: (u: LlmUsageRecord) => void;
}

type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `\n…[truncated ${s.length - max} chars]` : s;
}

function taskPrompt(task: BuildTask): string {
  const lang = task.locale === "ko" ? "Korean" : "English";
  return [
    `# Work item ${task.wbsId}: ${task.wbsTitle}`,
    `Acceptance criteria to satisfy: ${task.acceptanceIds.join(", ") || "(none listed)"}`,
    `UI language: ${lang}`,
    "",
    "## Spec (excerpt)",
    task.specMarkdown,
    "",
    "## Repository files",
    task.fileList.slice(0, 400).join("\n"),
    "",
    "Start by reading the files you will change. Finish with build green.",
  ].join("\n");
}

export async function runBuildLoop(task: BuildTask, opts: BuildLoopOptions): Promise<BuildLoopOutcome> {
  const limits = { ...BUILD_LIMITS, ...(opts.limits ?? {}) };
  const gate = opts.gate ?? new EfficiencyGate();
  const maxTokens = opts.maxTokens ?? 8_192;
  const env = filterEnv(opts.baseEnv ?? {});
  const log = opts.onEvent ?? (() => {});

  const messages: AnthropicMessage[] = [{ role: "user", content: taskPrompt(task) }];
  const out: BuildLoopOutcome = {
    status: "limit_turns", summary: "", commitMessage: null, filesWritten: [], commandsRun: [], denied: [],
    turns: 0, toolCalls: 0, tokensUsed: 0, costUsd: 0, lastBuildExitCode: null, usage: [], unpricedCalls: 0,
  };

  for (let turn = 0; turn < limits.maxTurnsPerTask; turn++) {
    out.turns = turn + 1;
    let response: AnthropicResponse;
    try {
      const serialized = JSON.stringify(messages);
      const est = estimateCallCost(opts.model, estimateTokens(BUILD_SYSTEM_PROMPT) + estimateTokens(serialized), maxTokens);
      // 콜백 안에서 채워진다 — 지역 let은 TS 흐름 분석이 null로 좁히므로 상자에 담는다.
      const turnUsage: { record: LlmUsageRecord | null } = { record: null };
      const r = await gate.run<AnthropicResponse>(
        { agent: "build-worker", cacheablePrefix: BUILD_SYSTEM_PROMPT, prompt: BUILD_SYSTEM_PROMPT + "\n" + serialized, estimatedCostUsd: est, forceModel: opts.model },
        async ({ model }) => {
          const started = Date.now();
          const params: AnthropicCreateParams = {
            model,
            max_tokens: maxTokens,
            system: [{ type: "text", text: BUILD_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
            messages,
            tools: BUILD_TOOLS,
            tool_choice: { type: "any" },
          };
          const res = await opts.client.messages.create(params);
          const latencyMs = Date.now() - started;
          const record = usageRecordFromResponse(model, res, latencyMs);
          turnUsage.record = record;
          return {
            result: res,
            inputTokens: res.usage.input_tokens,
            outputTokens: res.usage.output_tokens,
            costUsd: record.costUsd,
            latencyMs,
          };
        },
      );
      response = r.result;
      out.tokensUsed += r.metric.inputTokens + r.metric.outputTokens;
      out.costUsd += r.metric.costUsd;
      const rec = turnUsage.record;
      if (rec) {
        out.usage.push(rec);
        if (rec.unpriced) out.unpricedCalls += 1;
        try { opts.onUsage?.(rec); } catch { /* 계측 싱크가 빌드를 깨면 안 된다 */ }
      }
    } catch (err) {
      out.status = "llm_error";
      out.summary = `llm_error: ${String((err as Error)?.message ?? err).slice(0, 200)}`;
      return out;
    }

    const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      // 도구 없이 말만 한 턴 — 한 번 더 도구를 요구한다(무한 반복은 turn 상한이 막는다).
      messages.push({ role: "assistant", content: response.content.map((b) => (b.type === "text" ? { type: "text" as const, text: b.text } : b)) });
      messages.push({ role: "user", content: "Use a tool (read_file / create_file / run_command / finish). Do not answer in prose." });
      continue;
    }

    messages.push({ role: "assistant", content: response.content.map((b) => (b.type === "text" ? { type: "text" as const, text: b.text } : b)) });
    const results: Array<{ type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }> = [];
    let finished: { status: "done" | "gave_up"; summary: string; commitMessage: string | null } | null = null;

    for (const call of toolUses) {
      // 거부 상한은 `continue`로 건너뛴 호출 뒤에도 잡혀야 한다 — 루프 머리와 꼬리에서 함께 본다.
      if (out.denied.length >= limits.maxDenied) break;
      out.toolCalls += 1;
      if (out.toolCalls > limits.maxToolCalls) {
        out.status = "limit_tool_calls";
        out.summary = "tool call limit reached";
        return out;
      }
      const input = (typeof call.input === "object" && call.input !== null ? call.input : {}) as Record<string, unknown>;
      const reply = (content: string, isError = false) => results.push({ type: "tool_result", tool_use_id: call.id, content: clip(content, limits.maxOutputChars), ...(isError ? { is_error: true } : {}) });
      const deny = (reason: string, detail?: string) => {
        out.denied.push({ tool: call.name, reason, ...(detail ? { detail } : {}) });
        log(`deny ${call.name} ${reason}${detail ? " " + detail : ""}`);
        reply(`REFUSED (${reason})${detail ? ": " + detail : ""}. This will not be executed. Choose another approach.`, true);
      };

      try {
        if (call.name === "finish") {
          const status = input["status"] === "gave_up" ? "gave_up" : "done";
          finished = { status, summary: String(input["summary"] ?? "").slice(0, 2000), commitMessage: typeof input["commitMessage"] === "string" ? input["commitMessage"].slice(0, 72) : null };
          reply("ok");
        } else if (call.name === "read_file") {
          const d = decidePath(String(input["path"] ?? ""));
          if (!d.allowed) { deny(d.reason, String(input["path"] ?? "")); continue; }
          const text = await opts.executor.readFile(d.path);
          reply(text === null ? `NOT FOUND: ${d.path}` : text, text === null);
        } else if (call.name === "list_files") {
          const raw = String(input["dir"] ?? "");
          const d = raw === "" || raw === "." ? { allowed: true as const, path: "" } : decidePath(raw);
          if (!d.allowed) { deny(d.reason, raw); continue; }
          const files = await opts.executor.listFiles(d.path);
          reply(files.slice(0, 500).join("\n") || "(empty)");
        } else if (call.name === "create_file") {
          const d = decidePath(String(input["path"] ?? ""));
          if (!d.allowed) { deny(d.reason, String(input["path"] ?? "")); continue; }
          const content = String(input["content"] ?? "");
          if (content.length > limits.maxFileBytes) { deny("file_too_large", `${content.length} > ${limits.maxFileBytes}`); continue; }
          const secret = findSecretLike(content);
          if (secret) { deny("introduces_secret", secret); continue; }
          await opts.executor.createFile(d.path, content);
          if (!out.filesWritten.includes(d.path)) out.filesWritten.push(d.path);
          log(`write ${d.path} ${content.length}b`);
          reply(`wrote ${d.path} (${content.length} chars)`);
        } else if (call.name === "run_command") {
          const cmd = String(input["cmd"] ?? "");
          const args = Array.isArray(input["args"]) ? input["args"].map((a) => String(a)) : [];
          const d = decideCommand(cmd, args);
          if (!d.allowed) { deny(d.reason, [cmd, ...args].join(" ").slice(0, 120)); continue; }
          const timeoutMs = Math.min(Number(input["timeoutMs"]) || limits.commandTimeoutMs, limits.commandTimeoutMs);
          const started = Date.now();
          const r = await opts.executor.runCommand(cmd, args, { timeoutMs, env });
          const ms = Date.now() - started;
          out.commandsRun.push({ cmd, args, code: r.code, ms });
          if (cmd === "pnpm" && (args[0] === "build" || (args[0] === "run" && args[1] === "build"))) out.lastBuildExitCode = r.code;
          log(`run ${cmd} ${args.join(" ")} → ${r.code} ${ms}ms`);
          reply(`exit ${r.code}${r.timedOut ? " (timed out)" : ""}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`, !r.ok);
        } else {
          deny("unknown_tool");
        }
      } catch (err) {
        reply(`tool error: ${String((err as Error)?.message ?? err).slice(0, 300)}`, true);
      }

    }

    if (out.denied.length >= limits.maxDenied) {
      out.status = "limit_denied";
      out.summary = `refused ${out.denied.length} tool calls (${out.denied.map((d) => d.reason).join(", ")})`;
      return out;
    }

    messages.push({ role: "user", content: results });

    if (finished) {
      out.status = finished.status;
      out.summary = finished.summary;
      out.commitMessage = finished.commitMessage;
      return out;
    }
  }

  out.status = "limit_turns";
  out.summary = `turn limit ${limits.maxTurnsPerTask} reached`;
  return out;
}
