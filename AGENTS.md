# Agent Instructions

This file is the repository-local agent guide. Use the uppercase filename `AGENTS.md` so coding agents can find it by convention.

`MEMORY.md` is the durable context store for this repository. Chat context may be compressed or lost, so anything that future agents need to retain must be written there.

## Startup Checklist

- Read this `AGENTS.md` file at the start of work in this repository.
- Read `MEMORY.md` before planning or making changes.
- Start with these `MEMORY.md` sections: `Active Handoff`, `Current State`, `Open Follow-ups`, and `Do Not Forget`.
- If context was compressed, the session was resumed, or prior work is unclear, follow the `Compression Recovery` workflow below.
- When in doubt, check `MEMORY.md` before assuming project history, user preferences, architecture, setup steps, or unresolved work.

## Authoritative Execution Environment

- The project VM `robyn` at `192.168.50.250` is the only development, test, build, database, service, deployment, and Git execution environment.
- The authoritative checkout is `/home/hendo420/Robyn` on that VM.
- The Windows workstation checkout is a convenience mirror and SSH/control surface only. Do not run project builds, tests, package installs, databases, application processes, migrations, keepers, indexers, RPC nodes, or deployments on the workstation.
- Start project work by connecting to the VM and changing to `/home/hendo420/Robyn`. Verify the VM worktree before editing or running commands.
- Commit and push from the VM. If a workstation mirror is retained, update it only after the VM branch is pushed.

## VM Runtime Rules

- Do not use Docker, Docker Compose, Kubernetes, containers, or a container registry for this project.
- Install PostgreSQL, Redis, MinIO, reverse proxy, monitoring, and any other required stateful service directly on the VM and manage native services with `systemd`.
- Run Node.js application processes under PM2. Commit an ecosystem file, configure PM2 startup through `systemd`, and run `pm2 save` so the declared process set survives reboot.
- Run any supported self-hosted Robinhood Chain RPC/node software on this VM. If the VM lacks capacity, expand this VM before introducing another runtime host; never move the node to the workstation.
- Use a self-hosted GitHub Actions runner on this VM if GitHub Actions is enabled. Do not use a GitHub-hosted runner for project builds or tests.
- Keep service data under documented VM paths, use least-privilege Unix service accounts, and keep credentials out of Git. Backup jobs run from the VM and must copy recoverable data outside the VM's failure domain.
- Docker happens to be installed on the VM from initial provisioning, but it is not part of the project architecture and must not be used unless the user explicitly reverses this decision.

## Memory-First Rule

Use `MEMORY.md` as the source of retained project context. If chat history conflicts with `MEMORY.md`, verify the current repo state before acting and update `MEMORY.md` with any correction.

## Controlled Devnet And Release Workflow

- Use native Anvil on the VM as the controlled development network (chain ID 31337). Do not add Hardhat Network unless an approved architecture decision replaces Foundry/Anvil.
- All user-facing acceptance testing must run through the Codex in-app browser against the VM-served application. VM-native unit, integration, fuzz, invariant, fork, accessibility, security and service tests remain required.
- After every major validated change, commit and push from the authoritative VM checkout. Keep incomplete or risky work on feature branches and keep main deployable.

## Source Of Truth

When sources conflict, prefer them in this order:

1. Current files in the workspace.
2. Latest command output or freshly verified tool output.
3. `MEMORY.md`.
4. Chat history.

Treat browser state, email state, authentication state, and external service results as stale unless verified in the current session. Treat documented repo structure, user preferences, and decisions as durable unless current files or fresh verification contradict them.

## When To Update `MEMORY.md`

Update `MEMORY.md` consistently throughout the work, not only at the end. Add or revise entries whenever information should survive context loss, including:

- User preferences or instructions that affect future work.
- Project setup, commands, environment details, credentials-handling notes, or workflow requirements.
- Architecture decisions, implementation plans, and important tradeoffs.
- Bugs found, fixes applied, test results, and known regressions.
- Unresolved questions, blocked tasks, follow-ups, and assumptions.
- File paths, modules, APIs, or integration details that future agents should not have to rediscover.

## Checkpoint Rules

Update `MEMORY.md` after any meaningful checkpoint:

- A durable decision is made.
- A non-obvious setup or command is discovered.
- A bug is diagnosed or fixed.
- Tests or verification produce important results.
- Work is paused, blocked, or handed off.
- A previous memory is found to be stale or wrong.

## Entry Quality

- Keep entries concise, factual, and easy to scan.
- Prefer dated entries with short headings.
- Include file paths, commands, and test names when they matter.
- Use `Last verified YYYY-MM-DD` for facts that can drift.
- Do not store secrets, tokens, passwords, private keys, or sensitive personal data.
- For email-related work, do not store full email bodies, private addresses, case details, or sensitive agency data. Store only brief summaries, message IDs, dates, and action state when needed.
- Do not turn `MEMORY.md` into a transcript. Store conclusions, decisions, setup details, blockers, and verified results.
- If an old memory becomes inaccurate, correct it in place or add a clearly dated correction.
- Keep `Active Handoff` and `Current State` short. Move old completed details into `Completed Work` or `Archive`.

## Memory Entry Template

Use this format when adding a meaningful dated entry:

```md
### YYYY-MM-DD - Short Title

- Context:
- Decision:
- Files:
- Commands/tests:
- Result:
- Follow-up:
```

## Compression Recovery

When context is missing, stale, compressed, or ambiguous:

1. Read this `AGENTS.md`.
2. Read `MEMORY.md`, especially `Active Handoff`, `Current State`, `Open Follow-ups`, and `Do Not Forget`.
3. Inspect the files related to the current task.
4. Re-run or inspect relevant verification only when needed.
5. Update `MEMORY.md` with the recovered state before making broad changes.

## Before Final Response

Before finishing substantial work:

- Review whether `MEMORY.md` needs a final update.
- Record important files changed, decisions made, test results, and follow-ups.
- Make sure `Active Handoff`, `Current State`, `Verification Ledger`, and `Open Follow-ups` reflect the actual handoff state.

## Default Operating Rule

If there is any uncertainty about retained context, read `MEMORY.md` first.
