---
name: read-aloud
description: Read a document, translation or answer aloud, in short chunks. Use when the user asks to hear something.
license: Apache-2.0
---

# Read aloud

1. Get the text (message, file via `search_files`, or a previous answer).
2. Call `speak` in chunks of up to 1,200 characters, splitting at paragraph or sentence ends.
3. Skip tables and code; describe them in a sentence instead.
