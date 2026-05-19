# Cumulus TUIs

Cumulus has two local terminal surfaces today.

## `altocumulus`

`altocumulus` is the local Cumulus control TUI. It lives in `packages/altocumulus` and is
published as `@cls/altocumulus`.

V3 opens fast from cached local state and does not scan the current directory on
startup. It scans projects only when the user runs a scan action, records local
history and usage events, and shows Cumulus packages, imports, environment
variable names, API path references, and SDK/MCP activity metadata.

```bash
altocumulus
altocumulus scan . --json
altocumulus config . --json
```

See [altocumulus.md](./altocumulus.md).

## Knowledge TUI

The Knowledge TUI lives in the Rust runtime under `crates/cls-knowledge-cli`
and is reached through the unified CLI:

```bash
cumulus knowledge .
```

Python also has an operations review TUI:

```bash
python3 -m cumulus_knowledge.tui --ops-review .
```
