---
name: form-extraction
description: Extract named fields from forms, IDs, applications or any structured document into a table. Use when the user wants specific fields pulled out.
license: Apache-2.0
---

# Form extraction

1. Ask which fields are needed if the user did not say.
2. Call `extract_fields` with those fields for each attached document.
3. Show one row per document with `show_ui`; mark missing fields as blank, never guessed.
4. Offer CSV export with `save_document`.
