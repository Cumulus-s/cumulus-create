# Terminal Site

The terminal site is a small public npm package in `packages/terminal-site`.
It gives Cumulus a website people can open from a terminal.
The interactive frame uses ASCII Cumulus branding, a horizontal page link row,
and a Tado mark on the `/tado` page.

The TUI also advertises `@cmls/create`, the public package for creating a new
Relay/Cumulus app. The Documents page is the terminal version of the package
guide.

## @cmls/create From The TUI

The TUI home page shows the fastest project-start commands:

```bash
npm create @cmls@latest my-acme
npm create @cmls@latest my-acme
npm create @cmls@latest my-acme -- --template full --agent-auth hosted
```

The Documents page covers:

- templates: `full`, `outer`, `inner`, and `agent-auth`,
- agent auth modes: `hosted` and `self-hosted`,
- Cumulus DB modes: `cloud`, `local`, and `both`,
- non-interactive flags,
- local Cumulus DB scripts,
- license boundaries for generated projects.

## User Command

From npm, users can run:

```bash
npx cumulush
```

They can open a specific page:

```bash
npx cumulush /documents
npx cumulush /relay
npx cumulush /tado
npx cumulush /rune
npx cumulush /cumulus/rune
npx cumulush /contact
```

## Pages

- `/` is the detailed Cumulus home page.
- `/documents` explains how to install and use `@cmls/create`.
- `/relay` explains agent-safe SaaS onboarding.
- `/tado` explains the AI agent terminal canvas.
- `/rune` explains the automation engine story.
- `/contact` accepts a message and opens a local email draft to
  `hi@cumulush.com`.

## Contact Behavior

The package does not send mail through a hosted API. That would require a
secret token in a public npm package, which is not safe.

Instead, the contact page builds a `mailto:` draft. The user still presses
Enter in the TUI, and their local email client handles the final send.

For CI or automated tests, set:

```bash
CUMULUS_TUI_DRY_RUN=1
```

## Development

Run the TUI locally:

```bash
npm --workspace @cmls/altocumulus run build
node packages/altocumulus/dist/index.js
```

Run a plain non-interactive render:

```bash
node packages/altocumulus/dist/index.js --smoke .
```

Run tests:

```bash
npm --workspace @cmls/altocumulus run test
```

Check the npm package contents before publishing:

```bash
npm pack --workspace @cmls/altocumulus --dry-run
```
