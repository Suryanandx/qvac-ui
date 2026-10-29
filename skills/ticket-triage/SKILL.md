---
name: ticket-triage
description: Route a batch of support tickets or issues to teams with priority, using the local decision model. Use for queues of tickets in a file.
license: Apache-2.0
---

# Ticket triage

1. Read tickets from the attached file with `search_files`.
2. For each ticket call `decide` with options for team and priority.
3. Show a table (Ticket, Team, Priority, Confidence) with `show_ui`. These are suggestions; nothing is reassigned.
