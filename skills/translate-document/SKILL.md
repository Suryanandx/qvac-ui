---
name: translate-document
description: Translate text or a document between languages locally, preserving formatting. Use when the user asks to translate.
license: Apache-2.0
---

# Translate document

1. Get the text (from the message, `search_files`, `read_image_text` or a transcript).
2. Call `translate_text` with the target language; translate long text in paragraphs.
3. Return the translation; offer `speak` to read it aloud and `save_document` to keep it.
4. If the language pair is not installed, tell the user to download it in Settings → Models.
