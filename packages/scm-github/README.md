# @simsa/scm-github

GitHub SCM adapter for Conclave AI. Resolves PR state for automatic
outcome capture — closes the gap where users previously had to run
`conclave record-outcome` manually after every PR landed.

## Install

```bash
pnpm add @simsa/scm-github @simsa/core
```

## Usage

```ts
import { FileSystemMemoryStore, OutcomeWriter } from "@simsa/core";
import { pollOutcomes } from "@simsa/scm-github";

const store = new FileSystemMemoryStore({ root: ".conclave" });
const writer = new OutcomeWriter({ store });

const summary = await pollOutcomes({ store, writer });
console.log(`merged=${summary.merged} rejected=${summary.rejected} reworked=${summary.reworked}`);
```

## Dependency

Uses the `gh` CLI for auth + network. Same dependency as
`@simsa/cli` already requires for `conclave review --pr N`, so
there is no new auth setup — `gh auth login` once is enough.

## Transition rules

| Past observation | Current state | Classified outcome |
|---|---|---|
| any | merged | `merged` |
| any | closed without merge | `rejected` |
| any | open, head moved since review | `reworked` |
| any | open, head unchanged | `pending` (no-op) |
