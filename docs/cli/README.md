# Cumulus CLI

The canonical command is `cumulus` from `packages/cli`.

```bash
cumulus intent register "I want to build X" --project my-project
cumulus bootstrap my-project --with auth,db,knowledge --install-runtimes
cumulus knowledge index . --profile all
cumulus db progress "Bootstrap finished" --status done
cumulus mcp
cumulus status
```

Legacy Relay/Auth commands still work through:

```bash
cumulus auth login
relay login
```

Knowledge commands delegate to the Rust binary `cumulus-knowledge`.
