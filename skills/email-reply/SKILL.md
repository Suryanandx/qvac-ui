---
name: email-reply
description: Draft a reply to an email in the user's voice: answer each question, propose next steps, keep it short. Use when the user pastes or forwards an email.
license: Apache-2.0
---

# Email reply

1. Identify every question and request in the incoming email.
2. Draft a reply that answers each one in order, with a clear next step and a short subject line.
3. If Gmail or Outlook is connected and the user asks, save it with `gmail_create_draft` / `outlook_create_draft` (find them with `tool_search`). Never send.
