---
name: meeting-minutes
description: Turn a meeting recording or transcript into minutes with decisions, action items, owners and deadlines. Use when the user shares a meeting recording or asks for minutes or action items.
license: Apache-2.0
---

# Meeting minutes

1. If an audio file is attached, call `meeting_notes` on it (it transcribes, labels speakers and extracts structure). If only a transcript or notes file is attached, use `search_files` to read it.
2. Write the minutes in this order:
   - **Summary**: three sentences at most.
   - **Decisions**: one bullet per decision, phrased as a fact.
   - **Action items**: a table with Owner, Task, Due. Write "unspecified" for anything not said. Never invent owners or dates.
   - **Open questions**: anything raised but not resolved.
3. Offer to save the minutes with `save_document` (Markdown) or create a flow for future meetings.
