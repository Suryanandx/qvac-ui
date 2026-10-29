---
name: data-quality-audit
description: Audit a CSV for missing values, duplicates, inconsistent categories and outliers. Use before analysis or when data looks wrong.
license: Apache-2.0
---

# Data quality audit

1. Call `analyze_table`; use its per-column missing counts, distinct counts and min/max.
2. Report: columns with missing values, suspicious ranges (negative amounts, impossible dates), categories that look like typos of each other.
3. Suggest concrete cleanup steps. Do not alter the file.
