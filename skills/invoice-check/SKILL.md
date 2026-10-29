---
name: invoice-check
description: Check an invoice image or PDF: extract vendor, invoice number, dates, line items, tax and total, verify the arithmetic and flag problems. Use for invoices and bills.
license: Apache-2.0
---

# Invoice check

1. Call `extract_fields` on the invoice with fields: vendor, invoice_number, issue_date, due_date, subtotal, tax, total, currency, line_items.
2. Verify: line items add up to the subtotal, subtotal + tax = total, the due date is after the issue date.
3. Show the result with `show_ui` (a table of fields plus a list of checks marked pass/fail).
4. Flag likely OCR misreads (digits that look swapped, missing currency symbols). Never approve payment; suggest a human review for anything flagged.
