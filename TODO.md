# Systems Mapping release evidence ledger

Updated: 2026-08-11

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
  - Evidence: the authenticated Teacher Console defaults to Review submissions, loads one selected detail, keeps full criteria and scores collapsed behind **Model review details**, requires one instructor focus, shows one question only for **Approve with a question**, detects stale revisions, and records append-only decision events.
- [x] Align teacher control with the seven student stages.
  - Evidence: Course settings loads only when selected and opens one stage at a time. Each stage contains bounded guidance and course-material fields. Saved previews include the current and completed stages in order, exclude later stages, and label instructor material as reference content. Published records remain read-only, earlier records can be cloned for rollback, and legacy module routes return `410`.
- [x] Persist the new evaluation and review workflow in both SQLite and PostgreSQL.
  - Evidence: matching schemas, transactions, constraints, migrations, retention locks, append-only triggers, and fresh PostgreSQL 17 integration tests.
- [x] Implement bounded retention.
  - Evidence: unsubmitted evaluations expire after 1 day; pending submissions after 30 days; decided submissions after 180 days. Retention removes source-bearing rows and leaves only hashed append-only purge receipts.
- [x] Implement deterministic STEM Splitter and explicit Ollama Cloud runtime contracts.
  - Evidence: deterministic mode uses fixed server rules and discloses that prompt edits do not alter scoring. Ollama mode is server-only opt-in, pins `https://ollama.com`, limits source to 131,072 UTF-8 bytes, validates the exact result schema, and does not silently fall back on failure.
- [x] Keep capability identifiers out of portable releases.
  - Evidence: private, course, CUNY, and public projections redact both evaluation and instructor-review capabilities; imported redacted copies cannot poll the original review.
- [x] Harden local and hosted access boundaries in code.
  - Evidence: local default code `101` remains server-side. Hosted private-course mode rejects it and requires a 10–32 character code with at least six distinct characters; hosted public-demo mode accepts it only with the exact server-side opt-in flag. Both retain HTTPS origin, explicit host/proxy configuration, Secure cookies, and bounded issuance/evaluation/submission rates.
- [x] Preserve teacher isolation and account ownership.
  - Evidence: fresh databases seed Maria and Zach as unclaimed identities; a temporary operator token authorizes one claim; passphrases use salted scrypt derivations; teacher and student cookies/routes remain separate.
- [x] Preserve phone-primary map state and annotation behavior.
  - Evidence: automated contracts cover schema-v1 migration, exact layout/viewport restoration, pointer and keyboard node movement, pan/zoom/fit, node/relationship/map annotations, debounced persistence, JSON round-trip, and redaction.
- [x] Add restrained tertiary accents without making color the only signal.
  - Evidence: teal/micro-circle, amber/meso-square, plum/macro-diamond, and black/integration-double-circle are repeated in the legend; claim states use labeled outline and line patterns.
- [x] Neutralize CSV formula cells and reject unknown or credential-shaped project fields.
  - Evidence: byte-level CSV tests cover formula/control/leading-whitespace prefixes; schema and portable-export canaries fail closed.
- [x] Reconcile README, requirements, QA, and security documentation to the current implementation while preserving the source authority note.
  - Evidence: documentation updated 2026-08-11; `docs/SOURCE_LEDGER.md` was not modified.

## Current automated run

- [x] Preserve the published pre-pedagogy release baseline: 130 passing tests, 3 PostgreSQL-gated skips, and a successful production Vite build.
- [x] Current server and course-profile contract: 57 passed; 3 PostgreSQL-gated tests skipped in the ordinary SQLite run.
- [x] Current fresh disposable PostgreSQL 17 integration: 3/3 passed.
- [x] Current integrated client/domain/server suite: 145 passed; 3 PostgreSQL-gated tests skipped. Current server group: 59 passed; the same 3 PostgreSQL tests were gated.
- [x] Rebuild the production bundle after the frozen pedagogy changes.
- [x] Recapture Course settings at 320, 390, 430, and 1440 px after the seven-stage progression editor replaced the earlier settings view.
  - Evidence: all seven stages rendered at each viewport with no document-level horizontal overflow and no browser warnings/errors. `/Users/milwright/.codex/visualizations/2026/08/11/019ff16f-b119-7963-9090-525be49b8d8a/systems-mapping-course-settings-2026-08-11.zip` passes `unzip -t`.

## Current local and browser proof

- [x] Restart the final production server on `127.0.0.1:4177` while preserving the real SQLite database and verify the health endpoint.
  - Evidence: the final server reported `http://127.0.0.1:4177`; `/api/health` returned `{"status":"ok"}`.
- [x] Audit the real handoff database with value-free queries and preserve existing user-owned account/session state.
  - Evidence: integrity `ok`; 2 accounts with 1 already claimed; 1 existing teacher session; 0 student sessions, evaluations, submissions, review events, or prototype events. The existing code-owned prompt base remains internal. Data directory/files are `0700`/`0600`.
- [x] Complete the current disposable browser journey through **Approve with a question**.
  - Evidence: the journey verified source-return prompts, collapsed **Model review details**, one instructor focus and question, the student response, candidate choice, map entry, and revision stage.
- [x] Capture the current class entry and changed student and teacher views at 320, 390, 430, and 1440 px with no document-level horizontal overflow.
  - Evidence: the original 50-PNG archive is `/Users/milwright/.codex/visualizations/2026/08/08/019fe2ef-096c-7093-b898-9a6e64ef1b23/systems-mapping-app-all-views-2026-08-11.zip`; the four current Course settings captures are in `/Users/milwright/.codex/visualizations/2026/08/11/019ff16f-b119-7963-9090-525be49b8d8a/systems-mapping-course-settings-2026-08-11.zip`. Both pass `unzip -t`.
- [x] Verify the deployed public-demo class access with `101`, read back the course-server session, and close the test session. Earlier browser-entry evidence retains the zero-console-warning check.
- [x] Run the production dependency audit and final source/application-bundle scans.
  - Evidence: the production audit reported no known vulnerabilities; credential scans were clean; the application bundle excludes the local class code, source maps, dangerous HTML, teacher identity, review capabilities, and server prompt content. Numeric `101` values in the library bundle are unrelated glyph-table data.

## Active-beta browser follow-up

- [ ] Exercise simple **Approve** and **Reject** in separate current browser fixtures. These branches are automated but were not part of the disposable rendered journey above.
- [ ] Verify current reload restoration and JSON export/import restoration in the rendered application.
- [ ] Extend rendered interaction receipts for map drag, keyboard movement, zoom/pan/fit, and every annotation surface. Automated persistence coverage and the verified candidate → map → revision journey remain release evidence.

## Current GitHub and Railway proof

- [x] Confirm that the tracked publication excludes `.env`, databases, WAL/SHM files, local browser state, screenshots, credentials, and test fixtures.
- [x] Read back the private `CUNY-AI-Lab/systems-mapping` GitHub repository and published commit lineage.
  - Evidence: application-contract commit `cb2a959`; commit `23aa134` adds the README **Active beta** notice; PR [#1](https://github.com/CUNY-AI-Lab/systems-mapping/pull/1) merged the seven-stage settings change into `main` at `95c01f4`.
- [x] Create/link a Railway project and application service in the intended workspace, attach PostgreSQL, and configure `DATABASE_URL`, `PUBLIC_ORIGIN`, `HOST`, `TRUST_PROXY_HOPS`, and a strong server-only class code.
  - Evidence: Railway project `ed729bd9-403b-46a6-a97c-99ad9a0294c8`, web service `7230902f-5f52-474f-8d80-5ea05d2dbedb`, and PostgreSQL service `7cee59ec-c32a-4f6e-a626-be4843cdaede`.
- [x] Run the Railway migration/deploy to terminal `SUCCESS` and verify the public domain and database-backed health endpoint.
  - Evidence: public-demo deployment `3e7210a0-33a4-4a2e-8d26-b15508c8c5ab` reached `SUCCESS`; `https://web-production-08455.up.railway.app/api/health` returned `{"status":"ok"}`, and expected hardening headers and Secure cookie attributes passed readback.
- [x] Verify deployed `101` access, session readback, and logout; retain the earlier zero-console-warning browser entry as historical evidence.
- [ ] Run the full teacher-review journey against the deployed Railway/PostgreSQL service as an active-beta follow-up. Current deployment, health, headers, entry behavior, and local disposable review evidence remain independently verified.

## Required Ollama Cloud proof

- [ ] Revoke the credential previously exposed in chat and create a fresh key.
- [ ] Configure only the rotated key as server-side `OLLAMA_API_KEY`; leave it out of source, browser storage, build output, logs, and exports.
- [ ] Enable Ollama Cloud explicitly and run one authorized source-egress acceptance test that verifies the provider/model disclosure, valid schema receipt, stored runtime provenance, size rejection, generic failure handling, and no deterministic fallback.
- [ ] Configure and verify the rotated key separately in Railway. The current blank local key and disabled Railway Ollama state do not satisfy this gate.

## Release boundary

The current seven-stage Course settings tree is automated, built, scanned, locally browser-verified at 320, 390, 430, and 1440 px, merged into `main` through PR [#1](https://github.com/CUNY-AI-Lab/systems-mapping/pull/1), and deployed with health/header/bundle readback. It still requires a full deployed teacher journey. Ollama Cloud remains a separate disabled capability until its exposed credential is revoked, a rotated key is installed, and a live provider run is authorized.

The authority order remains in `docs/SOURCE_LEDGER.md`: the fuller Drive specification governs behavior; supplied wireframes govern compatible presentation; CALI materials provide context; August 5 notes remain unconfirmed minutes; direct user decisions supersede earlier visual/product choices; and STEM Splitter is an architecture precedent rather than subject-matter authority.
