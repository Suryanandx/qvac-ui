---
name: sql-analyst
description: Answer business questions from a connected Postgres database: inspect tables, write a safe SELECT, and chart the result. Use when Postgres is connected.
license: Apache-2.0
---

# SQL analyst

1. Use `tool_search` for "postgres", then call `postgres_tables` to see the schema.
2. Write one read-only SELECT that answers the question; limit rows; call `postgres_query`.
3. Explain the result in plain language and chart it with `show_ui` when it has a category and a number.
4. Show the SQL you ran.
