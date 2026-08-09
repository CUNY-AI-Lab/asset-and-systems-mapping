# Systems Mapping release evidence ledger

Updated: 2026-08-09

This ledger separates implemented and automated behavior from rendered-browser, local-handoff, GitHub, Railway, and live-provider proof. A checked item has current evidence. A source file or earlier screenshot alone is not enough to close an external gate.

## Current implementation and automated evidence

- [x] Replace the former **Preflight checklist** and **Repair gate** screens with the descriptive seven-stage sequence: Select scale, Source intake, Suggestion review, Instructor response, Candidate review, Map studio, Revision and export.
  - Evidence: current `src/App.jsx`, canonical-stage UI regression, and server prototype-stage contract.
- [x] Present internal H1–H4/C1–C8 results as annotation guidance rather than criterion IDs, scores, pass counters, or readiness-check copy in the student workflow.
  - Evidence: UI tests assert the three visible groups and the absence of `H1`, `C1`, `8/8`, and `readiness checks` from the student surface.
- [x] Make suggestion generation server-authoritative.
  - Evidence: the client sends bounded project/source input to `POST /api/preflight/evaluations`; the server selects the effective teacher configuration, performs and validates evaluation, stores the authoritative record, and returns a one-time 192-bit capability.
- [x] Prevent a student from replacing the evaluated suggestion or configuration while submitting for review.
  - Evidence: `POST /api/preflight/submissions` accepts exactly `{evaluationId, studentAnnotation}`; the server consumes a same-session, unexpired evaluation once and copies its stored source, suggestion, configuration snapshot, and runtime metadata transactionally.
- [x] Gate candidate generation on instructor response.
  - Evidence: pending reviews remain at Instructor response; approve and revise-and-approve unlock Candidate review; reject returns to Source intake while preserving the memo and graph.
- [x] Implement the teacher review queue and three decision paths.
  - Evidence: the authenticated dashboard defaults to Review submissions, loads one selected detail, requires an instructor annotation, shows revised-suggestion input only for revise-and-approve, detects stale revisions, and records append-only decision events.
- [x] Simplify teacher customization through progressive disclosure.
  - Evidence: Model guidance is secondary and lazy-loaded; it shows one selected module editor at a time while retaining 60 independently versioned preflight/builder × scope × module records.
- [x] Persist the new evaluation and review workflow in both SQLite and PostgreSQL.
  - Evidence: matching schemas, transactions, constraints, migrations, retention locks, append-only triggers, and fresh PostgreSQL 17 integration tests.
- [x] Implement bounded retention.
  - Evidence: unsubmitted evaluations expire after 1 day; pending submissions after 30 days; decided submissions after 180 days. Retention removes source-bearing rows and leaves only hashed append-only purge receipts.
- [x] Implement deterministic STEM Splitter and explicit Ollama Cloud runtime contracts.
  - Evidence: deterministic mode uses fixed server rules and discloses that prompt edits do not alter scoring. Ollama mode is server-only opt-in, pins `https://ollama.com`, limits source to 131,072 UTF-8 bytes, validates the exact result schema, and does not silently fall back on failure.
- [x] Keep capability identifiers out of portable releases.
  - Evidence: private, course, CUNY, and public projections redact both evaluation and instructor-review capabilities; imported redacted copies cannot poll the original review.
- [x] Harden local and hosted access boundaries in code.
  - Evidence: local default code `101` remains server-side; hosted mode rejects `101` and requires a 10–32 character code with at least six distinct characters, HTTPS origin, explicit host/proxy configuration, Secure cookies, and bounded issuance/evaluation/submission rates.
- [x] Preserve teacher isolation and account ownership.
  - Evidence: fresh databases seed Maria and Zach as unclaimed identities; a temporary operator token authorizes one claim; passphrases use salted scrypt derivations; teacher and student cookies/routes remain separate.
- [x] Preserve phone-primary map state and annotation behavior.
  - Evidence: automated contracts cover schema-v1 migration, exact layout/viewport restoration, pointer and keyboard node movement, pan/zoom/fit, node/relationship/map annotations, debounced persistence, JSON round-trip, and redaction.
- [x] Add restrained tertiary accents without making color the only signal.
  - Evidence: teal/micro-circle, amber/meso-square, plum/macro-diamond, and black/integration-double-circle are repeated in the legend; claim states use labeled outline and line patterns.
- [x] Neutralize CSV formula cells and reject unknown or credential-shaped project fields.
  - Evidence: byte-level CSV tests cover formula/control/leading-whitespace prefixes; schema and portable-export canaries fail closed.
- [x] Reconcile README, requirements, QA, and security documentation to the current implementation while preserving the source authority note.
  - Evidence: documentation updated 2026-08-09; `docs/SOURCE_LEDGER.md` was not modified.

## Current automated run

- [x] Focused student UI/domain suite: 67/67 passed.
- [x] Server suite: 53 passed; 3 PostgreSQL-gated tests skipped in the ordinary SQLite run.
- [x] Fresh disposable PostgreSQL 17 integration: 3/3 passed.
- [x] Full suite: 129 passed and 3 PostgreSQL-gated skipped across 9 passing files and 1 skipped file.
- [x] Production Vite build completed successfully.

## Required local and browser proof

- [ ] Restart the final production server on `127.0.0.1:4177` while preserving the real SQLite database; verify the listener, health endpoint, security headers, and current UI.
- [ ] Audit the real handoff database with value-free queries: two unclaimed teacher accounts, no teacher/student QA sessions, no QA prompt revisions, no review fixtures, and a passing integrity check.
- [ ] Run the current class access → source intake → suggestion review → submit → teacher approve/revise/reject → student refresh → candidate review journey in the in-app browser against a disposable database.
- [ ] Verify the current build at desktop plus 320, 390, and 430 CSS px with no document-level horizontal overflow, no occluded primary controls, at least 44 px primary touch targets, visible focus, and zero relevant console errors.
- [ ] Verify map drag, keyboard movement, zoom/pan/fit, annotation edits, reload restoration, export/import restoration, and the complete color/shape/line legend in the current rendered build.
- [ ] Capture and inspect current phone student and desktop teacher screenshots. Existing map screenshots predate the suggestion/instructor overhaul and are not final acceptance evidence.
- [ ] Re-run `pnpm audit` and `pnpm audit --prod` against the final lockfile, then scan source and `dist/` for the local class code, credentials, secrets, prompt bodies, teacher identity/history, review capabilities, dangerous HTML sinks, and source maps.

## Required GitHub and Railway proof

- [ ] Initialize the intended Git repository without `.env`, databases, WAL/SHM files, local browser state, screenshots, credentials, or test fixtures.
- [ ] Create and read back the private `CUNY-AI-Lab/system-mapping` GitHub repository and verify the published commit matches the tested tree.
- [ ] Create/link a Railway project and application service in the intended workspace, attach PostgreSQL, and configure `DATABASE_URL`, `PUBLIC_ORIGIN`, `HOST`, `TRUST_PROXY_HOPS`, and a strong server-only class code.
- [ ] Run the Railway migration/deploy to terminal `SUCCESS`, then verify the public domain, `/api/health`, database tables, Secure cookies, origin/proxy behavior, and absence of seeded credentials or test data.
- [ ] Confirm the hosted review workflow against Railway PostgreSQL. Local PostgreSQL parity is not a production deployment claim.

## Required Ollama Cloud proof

- [ ] Revoke the credential previously exposed in chat and create a fresh key.
- [ ] Configure only the rotated key as server-side `OLLAMA_API_KEY`; leave it out of source, browser storage, build output, logs, and exports.
- [ ] Enable Ollama Cloud explicitly and run one authorized source-egress acceptance test that verifies the provider/model disclosure, valid schema receipt, stored runtime provenance, size rejection, generic failure handling, and no deterministic fallback.
- [ ] Configure and verify the rotated key separately in Railway. The current blank local key and unmodified Railway state do not satisfy this gate.

## Completion rule

Do not call the release complete until every unchecked external gate above has evidence. Automated green status establishes implementation readiness, not browser acceptance, GitHub publication, Railway delivery, a clean real database, or a live Ollama Cloud run.

The authority order remains in `docs/SOURCE_LEDGER.md`: the fuller Drive specification governs behavior; supplied wireframes govern compatible presentation; CALI materials provide context; August 5 notes remain unconfirmed minutes; direct user decisions supersede earlier visual/product choices; and STEM Splitter is an architecture precedent rather than subject-matter authority.
