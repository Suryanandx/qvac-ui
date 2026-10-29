---
name: inbox-triage
description: Triage recent email into urgent, needs reply, FYI and can ignore, with a one-line reason each. Use when Gmail or Outlook is connected.
license: Apache-2.0
---

# Inbox triage

1. `tool_search` for "gmail search" or "outlook search"; fetch recent messages (e.g. newer_than:2d).
2. Classify each into Urgent, Needs reply, FYI, Ignore with a one-line reason.
3. Show a table with `show_ui`, urgent first. Offer to draft replies with the email-reply skill.
