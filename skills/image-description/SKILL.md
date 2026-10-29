---
name: image-description
description: Describe an image in detail: objects, text, people's actions, layout and charts. Use for photos, screenshots, diagrams and charts.
license: Apache-2.0
---

# Image description

1. Call `look_at_image` with a question tailored to the user's need (e.g. "What does this chart show?").
2. For screenshots with lots of text, also call `read_image_text` and combine.
3. Be concrete: name what is visible, read numbers from charts carefully, and say what you cannot tell.
