---
name: bug-report
description: Turn a description, screenshot or log into a well-formed bug report and optionally file it. Use when the user reports a bug.
license: Apache-2.0
---

# Bug report

1. If there is a screenshot, call `look_at_image` to describe what it shows.
2. Write: title, steps to reproduce, expected, actual, environment, severity.
3. If GitHub, Linear or Jira is connected and the user asks, file it (`github_create_issue`, `linear_create_issue`); the user approves the exact content first.
