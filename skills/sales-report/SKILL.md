---
name: sales-report
description: Analyze sales data from a CSV: totals, breakdowns by region/product/month, top performers and a chart. Use for sales or revenue spreadsheets.
license: Apache-2.0
---

# Sales report

1. Call `analyze_table` on the CSV, with `group_by` set to the dimension the user asked about (region, product, month…).
2. Report totals exactly as computed. Rank the top and bottom groups.
3. Point out the biggest change between periods only if periods exist in the data.
4. Show a chart with `show_ui` if the user wants a different grouping than the default card.
