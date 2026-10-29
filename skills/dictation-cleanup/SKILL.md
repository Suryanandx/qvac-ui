---
name: dictation-cleanup
description: Clean up dictated speech into polished text: remove filler words, fix punctuation, keep the speaker's meaning. Use after a voice note or dictation.
license: Apache-2.0
---

# Dictation cleanup

1. Use the transcript from the voice note or `transcribe_audio`.
2. Remove filler (um, uh, you know), fix punctuation and paragraphs, and correct obvious misrecognitions only when the meaning is clear.
3. Keep the speaker's wording and tone; do not add content.
4. Return the cleaned text, then a one-line list of anything you were unsure about.
