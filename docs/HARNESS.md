# Harness design

## A turn

1. The browser posts `/api/chat` with `{ text | voiceAttachmentId, agent, speak }` and reads Server-Sent Events.
2. **Voice note:** if `voiceAttachmentId` is set, the Brain runs `transcribe_audio` first and the transcript becomes the user message.
3. **Slash command:** if the text is a command (`/ocr`, `/flow name`, …), the matching tool runs before the model is consulted. Its result is added to the model history as if the model had called it.
4. **Tool loop (at most 6 rounds):** the model gets a system prompt (agent persona, attached files as `file-N`, skill names, saved flows, connected services) plus the local tools as JSON-schema functions. Connector tools (and MCP tools beyond eight) are *deferred*: only QVAC's built-in `tool_search` and a short catalog are in the prompt, and a tool's schema enters the conversation when the model searches for it. QVAC's native tool calling (Hermes dialect for Qwen3) returns text and tool calls. Each call is validated with zod, executed, and its bounded result is appended as a `tool` message. The final round offers no tools, which forces an answer.
5. **Spoken reply:** if `speak` is on, the final text is synthesized with `speak`.
6. The assistant message is stored with ordered `parts` (text and tool cards), provenance and an audit event.

Earlier turns are replayed with their tool calls and bounded tool results (memos), so follow-up questions can use previous results.

Stream events: `start`, `user`, `delta`, `tool_start`, `progress`, `tool_search`, `tool_end`, `flow`, `approval`, `approval_done`, `failure`, `done`.

## Guards

- **Invented input:** small models batch "decode the file" and "speak the result" in one round and make up the argument. When a round contains a data-reading tool, the tools that consume text (`speak`, `show_ui`, `decide`, `create_flow`) are deferred and the model is asked to call them again with the real results.
- **Repeat calls:** a tool call with identical arguments runs once per turn, and any one tool runs at most three times per turn.
- **Named services:** when the message names a connected service ("Wikipedia", "GitHub", "weather") its tools skip tool search and go straight into the prompt; the SDK's top two search matches are promoted too when a word from the message appears in the tool name. Small models handle "search, then call" unreliably.
- **Offline mode:** the system prompt says outside services are off, so the model answers directly instead of hunting for tools.
- **Hidden tools:** capabilities without configured weights are not offered to the model.
- **Untrusted data:** file text, transcripts, OCR and MCP results are labelled as untrusted data. The model is told never to follow instructions inside them.
- **Display:** cards are built server-side from validated data with `jsonToOpenUI` (`server/display.mjs`). Model text only ever fills string props. The shared component vocabulary (`shared/ui-library.mjs`) has no actions, links or code execution.
- **One job at a time:** one chat turn runs at a time; capability runs are serialized and native models are unloaded after each run.

## MCP

`server/mcp.mjs` connects user-configured servers through the official `@modelcontextprotocol/sdk` client (stdio or Streamable HTTP). Tool names are namespaced as `server__tool`, with at most 24 MCP tools offered. Only the user can add servers, in Settings; the model cannot.

Calls to an untrusted server wait on `server/approvals.mjs`: the approval is bound to a SHA-256 digest of the exact tool and arguments, used once, and expires after five minutes or when the turn is cancelled. Declined calls never reach the server. Stdio servers get a minimal environment (`PATH`, `HOME` and the variables you set).

## Flows

Flows are stored records `{ name, description, steps[], instruction }`. Steps are limited to `transcribe_audio`, `read_image_text`, `classify_image`, `decode_brain_signals`, `analyze_table`, `speak` and `search_files`. The runner passes the flow's file to file tools, and the previous step's text to `speak` and `search_files`. It stops at the first failed step and marks the rest skipped. Nested results appear in the chat as their own cards.

## API

All `/api/*` routes need the session bearer token and a same-origin request.

| Route | Purpose |
|---|---|
| `GET /api/state` | Chats, active messages and attachments, tools, flows, model, capabilities, MCP status |
| `POST /api/chat` | One turn (SSE) |
| `POST /api/cancel` | Stop the active turn |
| `POST /api/approvals` | `{ id, decision, digest }` for a pending MCP call |
| `POST /api/attachments` | `{ name, base64 }`: WAV, PNG/JPEG, BCI `.bin`, CSV/TXT/MD/JSON, up to 12 MiB |
| `POST /api/samples` | Attach a bundled fixture by name |
| `GET /api/audio/:id` | Generated speech (WAV) |
| `POST /api/conversations` | Create, select, rename, archive or restore a chat |
| `POST /api/settings/model`, `/api/settings/capability` | Configure local weights |
| `POST /api/mcp` | Add, update (enabled or trusted), remove or reconnect a server |
| `POST /api/flows` | Delete a flow |
| `GET /api/audit` | Recent audit events and hash-chain status |
| `POST /api/catalog` | List the model catalog, start or cancel a download |
| `POST /api/connectors` | Save, enable, disable, remove, test or start OAuth for a connector |
| `GET /oauth/callback` | OAuth redirect target (authenticated by single-use state) |
| `POST /api/skills` | Save, enable, disable, delete or read a skill |
| `GET /api/vault`, `POST /api/vault` | Vault status; index waiting documents |
| `GET /api/media/:id`, `GET /api/exports/:id` | Generated images and music; saved files |
| `POST /api/settings/app` | Offline mode |

## Skills

`server/skills.mjs` loads `skills/*/SKILL.md` (built-in) and `<workspace>/skills/*/SKILL.md` (imported) in the Agent Skills format. The prompt lists each enabled skill's name and the first sentence of its description; `use_skill` returns the full instructions (progressive disclosure). Skills are text only; nothing in a skill folder is executed.

## Connectors

`server/connectors/definitions.mjs` declares each service: credential fields, a test call and zod-typed tools (`write: true` for anything that changes outside data). `server/connectors/index.mjs` seals credentials with AES-256-GCM (`server/secrets.mjs`, key in the macOS Keychain or a `0600` file), runs OAuth 2.0 with PKCE and a loopback redirect for Google and Microsoft, refreshes tokens, and exposes enabled tools to the registry. Results become tables or metric cards. Offline mode removes them.

## Use-case pipelines

`server/studio.mjs` runs one heavy native job at a time:

- **Meeting notes:** resample to 16 kHz mono → Sortformer speaker turns → Whisper small per turn (with Silero VAD when transcribing whole files) → schema-constrained JSON notes from the brain → card plus Markdown export.
- **Field extraction:** vision brain with a JSON schema, or OCR/document text plus the brain.
- **Translation:** Bergamot pairs, pivoting through English; African languages use QVAC TranslatePsy-AfriSLM with its published prompt.
- **Vault:** EmbeddingGemma vectors stored in the workspace SQLite; cosine search in process; documents index in the background.
- **Specialists:** QVAC MedPsy (medical questions) and VisionPsy (images when the brain has no vision) load per call.
- **Generation:** FLUX.2 klein images and ACE-Step music. The brain is unloaded first so two large models never share memory.

## Models

`server/catalog.mjs` lists curated entries that reference QVAC SDK registry constants (pinned source and SHA-256) or pinned Hugging Face URLs with their SHA-256. Downloads go through `downloadAsset` into one shared cache. Downloading a capability entry configures that tool automatically.
