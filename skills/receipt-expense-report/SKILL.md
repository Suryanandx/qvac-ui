---
name: receipt-expense-report
description: Turn one or more receipt photos into an expense report table with merchant, date, category and amount. Use for receipts and expense claims.
license: Apache-2.0
---

# Receipt expense report

1. For each attached receipt image, call `extract_fields` with fields: merchant, date, total, currency, category (one of meals, travel, lodging, supplies, other).
2. Build one table (Merchant, Date, Category, Amount) and a total per category with `show_ui`.
3. Offer `save_document` as CSV for import into an expense tool.
