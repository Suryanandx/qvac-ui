# Security

QVAC UI runs AI models and stores data on your own computer. Its security model:

- **Local only by default.** The server listens on `127.0.0.1` and every API call needs a per-session bearer token (the part of the launch URL after `#`). Cross-origin requests and unknown `Host` headers are rejected.
- **Model output is data.** Answers render through a fixed set of display-only OpenUI components. No model output is executed, evaluated or inserted as HTML.
- **Outside effects need approval.** Connector tools that create, send or change data, and every call to an untrusted MCP server, pause on an approval bound to a SHA-256 digest of the exact arguments. Approvals are single-use and expire.
- **Untrusted content stays untrusted.** File text, transcripts, OCR, connector and MCP results are labelled as data the model must not follow as instructions. Small models can still be misled; approvals are the real safeguard.
- **Credentials.** Connector secrets are encrypted with AES-256-GCM using a key stored in the macOS Keychain (or a `0600` key file elsewhere) and are never sent to the browser.
- **Offline mode** removes every connector and MCP tool.
- **Not encrypted at rest:** chats, files and the vault are stored in a permission-restricted folder (`.local/`), not encrypted. Use full-disk encryption.

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a vulnerability** (Security → Advisories) on this repository rather than in a public issue. Include steps to reproduce and the impact. We aim to respond within a week.
