# Project Bootstrap For AI Agents

Copy this file into the root of any project. Give it to Codex or any AI coding agent before asking for work.

## Goal

Quickly understand this project, then work in small, safe steps.

The agent should:

- learn the project shape before editing
- explain findings in plain language
- ask before large or risky changes
- keep edits focused
- run useful checks
- tell the human what changed and what to test

## Human And Agent Roles

Human owns:

- product decisions
- visual approval
- manual testing
- credentials and deployments
- final merge decisions

Agent owns:

- codebase discovery
- small implementation tasks
- debugging
- tests and local verification
- explaining risks, assumptions, and next steps

If both human and agent are editing, say which files each person owns before starting.

## First 10 Minutes

The agent should start with read-only discovery.

Run:

```bash
pwd
git status --short
rg --files -g '!*node_modules*' -g '!*.git*' | head -120
```

Then inspect the most important project files, if they exist:

```bash
README.md
AGENTS.md
package.json
Cargo.toml
pyproject.toml
requirements.txt
go.mod
Makefile
docker-compose.yml
.env.example
```

Do not edit files yet unless the human already asked for a direct change.

## Project Map

After discovery, produce a short map:

- what the project does
- main languages and frameworks
- key directories
- how to run it
- how to test it
- risky areas
- unknowns

Keep this short. Use plain language.

## Optional Cumulus Knowledge Setup

If the `cumulus` CLI is available, use it to build a local knowledge index.

```bash
cumulus knowledge index . --profile all
cumulus knowledge doctor --path .
cumulus knowledge query "architecture" --path . --format json
cumulus knowledge graph view --path . --preset full --format json
```

This creates:

```txt
.cumulus/
```

Usually add this to `.gitignore`:

```gitignore
.cumulus/
```

Use Cumulus for:

- finding code paths
- tracing decisions
- getting cited source evidence
- understanding relationships between files
- reviewing larger or unfamiliar projects

## Codex MCP Setup For Cumulus

To let Codex use Cumulus as a tool, add a project-specific MCP server to `~/.codex/config.toml`.

Replace `/path/to/project` with this project root:

```toml
[mcp_servers.cumulus-this-project]
command = "/Users/miguel/.cargo/bin/cumulus"
args = ["knowledge", "serve", "mcp", "--path", "/path/to/project", "--transport", "stdio"]
```

Restart Codex after changing the config.

Useful Cumulus MCP tools:

- `ingest`
- `index_status`
- `search`
- `fetch`
- `graph_view`
- `source_trace`
- `expand_neighbors`
- `find_paths`

## Working Loop

Use this loop for most tasks:

1. Understand the task.
2. Inspect the relevant code.
3. Explain the plan.
4. Make the smallest useful change.
5. Run checks.
6. Explain what changed.
7. Tell the human what to test manually.

Good prompt:

```text
Work interactively.
First inspect the project and explain the relevant files.
Do not edit until you give me a short plan.
After edits, run the best available checks and tell me what I should test manually.
```

## Before Editing

Check:

```bash
git status --short
```

If the worktree is dirty:

- do not revert unrelated changes
- avoid touching files already being edited by the human
- mention any file conflicts before editing

For larger work, create a branch:

```bash
git checkout -b request/short-task-name
```

## Test And Run Commands

Prefer existing project commands.

Common examples:

```bash
npm test
npm run lint
npm run build
pytest
cargo test
go test ./...
make test
```

If a command fails, explain:

- command run
- failure cause if clear
- whether it is caused by the change
- next fix

## Safety Rules

Do not:

- delete files unless asked
- run destructive git commands unless asked
- overwrite human changes
- commit secrets
- invent missing facts
- make large refactors without approval
- change deployment, billing, or production config without approval

Be careful with:

- auth
- payments
- data deletion
- migrations
- external APIs
- generated code
- legal, financial, or medical claims

## Final Response Format

When done, answer with:

```text
Changed:
- ...

Checked:
- ...

Manual test:
- ...

Risks or follow-up:
- ...
```

Keep it short. Include file paths when useful.

