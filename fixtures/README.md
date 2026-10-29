# Sample files

These files power the one-click samples in the app (Attach → Sample files) and the tests. All business content is synthetic: no real people, companies or customers.

| File | What it is | Made by |
|---|---|---|
| `team-meeting.wav` | 33 s two-voice meeting (launch plan, owners, a delayed date) | `scripts/make-team-meeting.mjs`, local Supertonic voices F1 and M1 |
| `meeting-recording.wav`, `voice-question.wav` | Short single-voice recordings | Local Supertonic TTS (`speech-provenance.json`) |
| `invoice.png`, `invoice.html` | Invoice INV-2026-1042, total $1,296, tax $96 | `scripts/make-fixtures.mjs` |
| `business-sales.csv` | 36 rows of monthly sales by region and product | `scripts/make-fixtures.mjs` |
| `meeting-notes.md`, `competitor-notes.md`, `support-tickets.json` | Text sources for search, the vault and triage | `scripts/make-fixtures.mjs` |
| `remote-work-policy.pdf` | One-page policy with a real PDF text layer | Hand-written minimal PDF |
| `vendor-onboarding.docx` | Short Word checklist | Minimal Office Open XML package |
| `expected-invoice.json`, `expected-sales-results.json` | Expected values used by checks | `scripts/make-fixtures.mjs` |
| `bci/` | Public QVAC BCI research recordings | Upstream release; see `bci/README.md` |
