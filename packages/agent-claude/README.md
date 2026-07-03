# @simsa/agent-claude

Claude agent for Conclave AI council review. Implements the `Agent`
interface from `@simsa/core`.

Skeleton status: interface correct, review stub returns `approve`. Real
tool-use loop (via `@anthropic-ai/claude-agent-sdk`) with RAG over
answer-keys + failure-catalog and efficiency-gate cost metering lands in
a later PR.

## Install

```bash
pnpm add @simsa/agent-claude @simsa/core
```

## Usage

```ts
import { ClaudeAgent } from "@simsa/agent-claude";
import { Council } from "@simsa/core";

const agent = new ClaudeAgent({ apiKey: process.env.ANTHROPIC_API_KEY });
const council = new Council({ agents: [agent] });
```
