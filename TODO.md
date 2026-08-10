# Systems Mapping release evidence ledger

Updated: 2026-08-09

This ledger separates implemented and automated behavior from rendered-browser, local-handoff, GitHub, Railway, and live-provider proof. A checked item has current evidence. A source file or earlier screenshot alone is not enough to close an external gate.

## Current implementation and automated evidence

- [x] Use seven direct, verb-led actions throughout: **Choose a scale**, **Add a source**, **Review suggestions**, **Check your instructor's response**, **Choose what to map**, **Build the map**, and **Revise and export**.
  - Evidence: current `src/App.jsx`, canonical-stage UI regression, and server prototype-stage contract.
- [x] Keep the model's full criteria, scores, outcomes, and taxonomy out of the student workflow.
  - Evidence: the student evaluation response's `redirects` array contains at most three exact `{action, evidenceExcerpt?}` records. UI tests reject H/C identifiers, scores, outcome labels, model-review summaries, extra redirect fields, and more than three prompts.
- [x] Return the student to source evidence without supplying an interpretation.
  - Evidence: each student prompt is a short action of at most 500 characters with an optional evidence excerpt of at most 280 characters; the student then writes a separate note for the instructor.
- [x] Make suggestion generation server-authoritative.
  - Evidence: the client sends bounded project/source input to `POST /api/preflight/evaluations`; the server selects the effective teacher configuration, evaluates and validates the full result, stores it for teacher review, and returns only the student-safe prompts plus a one-time 192-bit capability and sanitized provenance.
- [x] Prevent a student from replacing the evaluated suggestion or configuration while submitting for review.
  - Evidence: `POST /api/preflight/submissions` accepts exactly `{evaluationId, studentAnnotation}`; the server consumes a same-session, unexpired evaluation once and copies its stored source, suggestion, configuration snapshot, and runtime metadata transactionally.
- [x] Gate candidate generation on instructor response.
  - Evidence: pending reviews send the student to **Check your instructor's response**. **Approve** and **Approve with a question** let the student choose what to map. **Reject** returns the student to **Add a source** while preserving the memo and graph.
- [x] Implement the teacher review queue and three decision paths.
  - Evidence: the authenticated dashboard defaults to Review submissions, loads one selected detail, keeps full criteria/scores collapsed behind **Model review details**, requires one instructor focus, shows one question only for **Approve with a question**, detects stale revisions, and records append-only decision events.
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

- [x] Preserve the published pre-pedagogy release baseline: 130 passing tests, 3 PostgreSQL-gated skips, and a successful production Vite build.
- [x] Current server pedagogy contract: 53 passed; 3 PostgreSQL-gated tests skipped in the ordinary SQLite run.
- [x] Current fresh disposable PostgreSQL 17 integration: 3/3 passed.
- [x] Current integrated client/domain/server suite: 132 passed; 3 PostgreSQL-gated tests skipped.
- [x] Rebuild the production bundle after the frozen pedagogy changes.

## Required local and browser proof

- [x] Restart the final production server on `127.0.0.1:4177` while preserving the real SQLite database and verify the health endpoint.
  - Evidence: the final server reported `http://127.0.0.1:4177`; `/api/health` returned `{"status":"ok"}`.
- [x] Audit the real handoff database with value-free queries and preserve existing user-owned account/session state.
  - Evidence: integrity `ok`; 2 accounts with 1 already claimed; 1 existing teacher session; 0 student sessions, evaluations, submissions, review events, or prototype events; 60 prompt modules and 60 seed-history rows. Data directory/files are `0700`/`0600`.
- [ ] Re-run all three teacher-decision branches in the in-app browser against a disposable database. The earlier approve-path proof predates the frozen source-prompt projection; verify **Approve**, **Approve with a question**, and **Reject** from student submission through refresh.
- [ ] Verify the current build at desktop plus 320, 390, and 430 CSS px with no document-level horizontal overflow, no occluded primary controls, at least 44 px primary touch targets, visible focus, and zero relevant console errors.
- [ ] Verify map drag, keyboard movement, zoom/pan/fit, annotation edits, reload restoration, export/import restoration, and the complete color/shape/line legend in the current rendered build.
- [ ] Recapture and inspect the changed **Review suggestions**, teacher **Model review details**, focus/question decision form, and instructor-response states at 320, 390, 430, and 1440 px.
  - Prior evidence retained: 44 PNGs across 11 pre-pedagogy app states in `systems-mapping-final`; the companion ZIP passes `unzip -t`, but those images do not prove the frozen projection.
- [ ] Re-run `pnpm audit` and `pnpm audit --prod` against the final lockfile, then scan source and `dist/` for the local class code, credentials, secrets, prompt bodies, teacher identity/history, review capabilities, dangerous HTML sinks, and source maps.

## Required GitHub and Railway proof

- [ ] Reconfirm that the changed publication set excludes `.env`, databases, WAL/SHM files, local browser state, screenshots, credentials, and test fixtures.
- [x] Create and read back the private `CUNY-AI-Lab/systems-mapping` GitHub repository and verify the published commit.
  - Evidence: `main` was pushed through `62a546e`; GitHub readback reported `PRIVATE` and the `main` default branch.
- [ ] Commit and push the frozen pedagogy changes, then read back the resulting private GitHub commit.
- [x] Create/link a Railway project and application service in the intended workspace, attach PostgreSQL, and configure `DATABASE_URL`, `PUBLIC_ORIGIN`, `HOST`, `TRUST_PROXY_HOPS`, and a strong server-only class code.
  - Evidence: Railway project `ed729bd9-403b-46a6-a97c-99ad9a0294c8`, web service `7230902f-5f52-474f-8d80-5ea05d2dbedb`, and PostgreSQL service `7cee59ec-c32a-4f6e-a626-be4843cdaede`.
- [x] Run the Railway migration/deploy to terminal `SUCCESS` and verify the public domain and database-backed health endpoint.
  - Evidence: deployment `f23a2cf0-6f4b-462f-b1e2-8a1c5e2bc7de`; `https://web-production-08455.up.railway.app/api/health` returned `{"status":"ok"}`. Browser-level Secure-cookie/origin and live review acceptance remain below.
- [ ] Deploy and read back the frozen pedagogy commit, then confirm the changed review workflow against Railway PostgreSQL. Local PostgreSQL parity and the earlier deployment are not proof of the changed production tree.

## Required Ollama Cloud proof

- [ ] Revoke the credential previously exposed in chat and create a fresh key.
- [ ] Configure only the rotated key as server-side `OLLAMA_API_KEY`; leave it out of source, browser storage, build output, logs, and exports.
- [ ] Enable Ollama Cloud explicitly and run one authorized source-egress acceptance test that verifies the provider/model disclosure, valid schema receipt, stored runtime provenance, size rejection, generic failure handling, and no deterministic fallback.
- [ ] Configure and verify the rotated key separately in Railway. The current blank local key and unmodified Railway state do not satisfy this gate.

## Completion rule

Do not call the release complete until every unchecked gate above has evidence. The prior GitHub/Railway release remains published, but it does not prove the changed pedagogy bundle, browser behavior, or a live Ollama Cloud run.

The authority order remains in `docs/SOURCE_LEDGER.md`: the fuller Drive specification governs behavior; supplied wireframes govern compatible presentation; CALI materials provide context; August 5 notes remain unconfirmed minutes; direct user decisions supersede earlier visual/product choices; and STEM Splitter is an architecture precedent rather than subject-matter authority.
