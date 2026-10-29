---
name: budget-variance
description: Compare budget versus actual figures in a spreadsheet and explain the largest variances. Use for budget, forecast or plan-vs-actual files.
license: Apache-2.0
---

# Budget variance

1. Call `analyze_table` to get exact column totals.
2. Compute variance = actual − budget and variance % for each line the table exposes; only use numbers from the tool result.
3. Show a table of the five largest variances with `show_ui` and explain each in one sentence.
