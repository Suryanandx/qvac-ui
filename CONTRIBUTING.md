# Contributing to QVAC UI

Thanks for helping. QVAC UI is a small, readable codebase: a Node server (`server/`), a React chat UI (`src/`), shared OpenUI components (`shared/`) and Markdown skills (`skills/`).

## Set up

```bash
OPENUI_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 npm ci
npm run build
npm start
```

Open the printed `http://127.0.0.1:4317/#…` link, then choose models in **Settings → Models** (they download from the QVAC registry on request).

## Before you open a pull request

- `npm test` must pass. It runs without any model weights, using a scripted model and fake capabilities.
- If you touch native inference (`server/models.mjs`, `server/studio.mjs`, `server/capabilities.mjs`, `server/tools.mjs`), also run `npm run test:native-harness` with the models installed and include the summary in your PR.
- Keep the security model intact: tools that change outside data must set `write: true` (connectors) or go through approvals (MCP); model output is never executed or rendered as HTML.

## Common contributions

**A skill.** Add `skills/<name>/SKILL.md` in the [Agent Skills](https://agentskills.io) format: frontmatter with `name` (lowercase, dashes) and a one-sentence `description` that says when to use it, then numbered steps that name the tools to call. Keep it under about 300 words; small models follow short instructions better.

**A connector.** Add an entry to `server/connectors/definitions.mjs`: credential `fields` (mark secrets with `secret: true`), a `test` call, and `tools` with zod schemas. Read tools return plain JSON (arrays of objects render as tables). Mark anything that creates, sends or changes data as `write: true`. Add a contract test with a fake fetch in `tests/connectors.test.mjs`.

**A model.** Add a catalog entry in `server/catalog.mjs` that references a QVAC SDK registry constant (preferred, since it is pinned and checksum-verified) or a pinned Hugging Face URL with its SHA-256.

**A card component.** Add it to `shared/ui-library.mjs` (schema), `server/display.mjs` (builder) and `src/openui.jsx` (renderer). Components are display-only.

## Style

Match the surrounding code: ES modules, small functions, comments only where the reason isn't obvious. User-facing text should be plain and short.

By contributing you agree that your contributions are licensed under the Apache License 2.0.
