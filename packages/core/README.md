# @simsa/core

Agent interface, council orchestration, self-evolve substrate, and
efficiency gate for Conclave AI.

Skeleton status: `Agent` / `Council` interfaces + Zod schemas only. Mastra
graph, memory substrate, and efficiency gate land in subsequent PRs.

## Install

```bash
pnpm add @simsa/core
```

## Usage

```ts
import { Council, type Agent, type ReviewContext } from "@simsa/core";

const council = new Council({ agents: [claudeAgent, openaiAgent] });
const ctx: ReviewContext = {
  diff: "...",
  repo: "acme/my-app",
  pullNumber: 42,
  newSha: "abc123",
};
const outcome = await council.deliberate(ctx);
```
