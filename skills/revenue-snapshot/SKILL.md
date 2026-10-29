---
name: revenue-snapshot
description: Summarize Stripe revenue: balance, recent charges, refunds and open invoices. Use when Stripe is connected.
license: Apache-2.0
---

# Revenue snapshot

1. `tool_search` for "stripe"; call `stripe_balance`, `stripe_recent_charges`, `stripe_open_invoices`.
2. Report the available balance, the charge total and count in the returned set, refunds, and overdue invoices.
3. Chart charges by status with `show_ui`. Read-only: nothing is changed.
