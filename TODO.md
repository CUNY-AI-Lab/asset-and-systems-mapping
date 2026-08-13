# Systems Mapping release evidence ledger

Updated: 2026-08-13

This ledger separates implemented and automated behavior from rendered-browser, local-handoff, GitHub, Railway, and live-provider proof. A checked item has current evidence. A source file or earlier screenshot alone is not enough to close an external gate.

## Current implementation and automated evidence

- [x] Use five direct, verb-led stages throughout: choose a scale and add a source, review source with your instructor, choose nodes and describe connections, build map, and revise and export.
  - Evidence: current `src/App.jsx`, canonical-stage UI regression, and server prototype-stage contract.
- [x] Keep the model's full criteria, scores, outcomes, and taxonomy out of the student workflow.
  - Evidence: the student evaluation response's `redirects` array contains at most three exact `{action, evidenceExcerpt?}` records. UI tests reject H/C identifiers, scores, outcome labels, model-review summaries, extra redirect fields, and more than three prompts.
- [x] Return the student to source evidence without supplying an interpretation.
  - Evidence: each student prompt is a short action of at most 500 characters with an optional evidence excerpt of at most 280 characters; the student then writes a separate note for the instructor.
- [x] Make suggestion generation server-authoritative.
  - Evidence: the client sends bounded project/source input to `POST /api/preflight/evaluations`; the server selects the effective teacher configuration, evaluates and validates the full result, stores it for teacher review, and returns only the student-safe prompts plus a one-time 192-bit capability and sanitized provenance.
- [x] Prevent a student from replacing the evaluated suggestion or configuration while submitting for review.
  - Evidence: `POST /api/preflight/submissions` accepts exactly `{evaluationId, studentAnnotation}`; the server consumes a same-session, unexpired evaluation once and copies its stored source, suggestion, configuration snapshot, and runtime metadata transactionally.
- [x] Keep instructor review asynchronous and non-gating.
  - Evidence: pending, approved, and rejected reviews remain in the combined source-review stage. Candidate choice and the persistent map remain available, including when no candidates were generated.
- [x] Implement the teacher review queue and three decision paths.
  - Evidence: the authenticated Teacher Console defaults to Review submissions, loads one selected detail, groups evidence excerpts, possible follow-up, and open questions under collapsed **Review details**, requires one instructor focus, shows one question only for **Add feedback and a question**, detects stale revisions, and records append-only decision events. The other visible actions are **Add feedback** and **Recommend another pass**; stored API decision IDs remain compatible with earlier records.
- [x] Align teacher control with the five student stages.
  - Evidence: Course settings loads only when selected and opens one stage at a time. Each stage contains bounded guidance and course-material fields. Saved previews include only the current stage, label instructor material as reference content, and avoid cumulative prompt growth. Published records remain read-only, earlier records can be cloned for rollback, and legacy module routes return `410`.
- [x] Persist the new evaluation and review workflow in both SQLite and PostgreSQL.
  - Evidence: matching schemas, transactions, constraints, migrations, retention locks, append-only triggers, and fresh PostgreSQL 17 integration tests.
- [x] Implement bounded retention.
  - Evidence: unsubmitted evaluations expire after 1 day; pending submissions after 30 days; decided submissions after 180 days. Retention removes rows that contain source text and leaves only hashed append-only purge receipts.
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
- [x] Reconcile every tracked release document to the current implementation and deployment boundary.
  - Evidence: README, release ledger, requirements, QA, security review, and reconciliation record agree on five stages, Part 1/Part 2, advisory review, current test/build evidence, and the Railway/GitHub provenance boundary as of 2026-08-13. This documentation-only release receipt changes no runtime behavior.

## Current automated run

- [x] Preserve the published pre-pedagogy release baseline: 130 passing tests, 3 PostgreSQL-gated skips, and a successful production Vite build.
- [x] Preserve the earlier server and course-profile run: 60 passed; 3 PostgreSQL-gated tests skipped in that ordinary SQLite run.
- [x] Preserve the latest disposable PostgreSQL 17 integration before the redesign: 3/3 passed. The current full run still reports the same 3 integration tests as environment-gated skips.
- [x] Run the current integrated client/domain/server suite: 160 passed; 3 PostgreSQL integration tests skipped because that environment was not configured.
- [x] Rebuild the production bundle after the five-stage Part 1/Part 2 changes; `pnpm build` passed.
- [x] Preserve the earlier seven-stage Course settings recapture as historical release evidence.
  - Evidence: `/Users/milwright/.codex/visualizations/2026/08/11/019ff16f-b119-7963-9090-525be49b8d8a/systems-mapping-course-settings-2026-08-11.zip` passes `unzip -t` but predates the six-section redesign.
- [x] Preserve representative six-section, direct-map, empty-map, review, and Teacher Console views across 320, 390, 430, and 1440 px as historical evidence.
  - Evidence: `/Users/milwright/.codex/visualizations/2026/08/11/019fe2ef-096c-7093-b898-9a6e64ef1b23/systems-mapping-semester-cycle-qa.zip` contains 7 historical PNGs and passes `unzip -t`.
- [x] Recapture the five requested views at desktop and mobile sizes, including early and populated multi-scale maps.
  - Evidence: `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ui-qa-2026-08-12.zip` contains 10 PNGs—five paired desktop/mobile views—plus annotations. ZIP integrity and visual inspection passed; the developed-map pair records the populated map and visible scale layers.

## Current local and browser proof

- [x] Restart the final production server on `127.0.0.1:4177` while preserving the real SQLite database and verify the health endpoint.
  - Evidence: the final server reported `http://127.0.0.1:4177`; `/api/health` returned `{"status":"ok"}`.
- [x] Audit the real handoff database with value-free queries and preserve existing user-owned account/session state.
  - Evidence: integrity `ok`; 2 accounts with 1 already claimed; 1 existing teacher session; 0 student sessions, evaluations, submissions, review events, or prototype events. The existing code-owned prompt base remains internal. Data directory/files are `0700`/`0600`.
- [x] Preserve the earlier disposable browser journey through the then-visible **Approve with a question** action.
  - Evidence: this historical journey verified questions tied to passages in the source, collapsed review details, one instructor focus and question, the student response, candidate choice, map entry, and revision section before the non-gating redesign and current feedback labels.
- [x] Preserve class-entry and changed student and teacher views at 320, 390, 430, and 1440 px as historical evidence with no document-level horizontal overflow.
  - Evidence: the original 50-PNG archive is `/Users/milwright/.codex/visualizations/2026/08/08/019fe2ef-096c-7093-b898-9a6e64ef1b23/systems-mapping-app-all-views-2026-08-11.zip`; the four earlier Course settings captures are in `/Users/milwright/.codex/visualizations/2026/08/11/019ff16f-b119-7963-9090-525be49b8d8a/systems-mapping-course-settings-2026-08-11.zip`. Both pass `unzip -t`.
- [x] Preserve the first five-stage Railway snapshot as historical evidence.
  - Evidence: dirty-working-tree deployment `3ea599f4-7fb5-4dd3-998d-c55134a69f15` reached terminal `SUCCESS`; health and root returned 200, class access and session/configuration checks succeeded, logout removed access, and copy and no-5xx checks passed. Clean-main deployment evidence below supersedes it as current provenance.
- [x] Run the production dependency audit and final source/application-bundle scans.
  - Evidence: the production audit reported no known vulnerabilities; credential scans were clean; the application bundle excludes the local class code, source maps, dangerous HTML, teacher identity, review capabilities, and server prompt content. Numeric `101` values in the library bundle are unrelated glyph-table data.

## Active-beta browser follow-up

- [ ] Exercise **Add feedback** and **Recommend another pass** in separate current browser fixtures. These actions retain the compatible `approve` and `reject` API IDs; their automated branches pass, but the five-view package is not a complete teacher-review journey.
- [ ] Verify current reload restoration and JSON export/import restoration in the rendered application.
- [ ] Extend rendered interaction receipts for map drag, keyboard movement, zoom/pan/fit, and every annotation surface. Automated persistence coverage and the verified candidate → map → revision journey remain release evidence.

## Current GitHub and Railway proof

- [x] Confirm that the tracked publication excludes `.env`, databases, WAL/SHM files, local browser state, screenshots, credentials, and test fixtures.
- [x] Read back the private `CUNY-AI-Lab/systems-mapping` GitHub repository and published commit lineage.
  - Evidence: application-contract commit `cb2a959`; commit `23aa134` adds the README **Active beta** notice; PR [#1](https://github.com/CUNY-AI-Lab/systems-mapping/pull/1) merged the seven-stage settings change into `main` at `95c01f4`; PR [#5](https://github.com/CUNY-AI-Lab/systems-mapping/pull/5) merged the reconciled five-stage implementation into `main` at `abddbd0a2640aa0e4db0dcf0a1c47d65e9983597`. Local `main`, `origin/main`, and GitHub `main` were synchronized at that implementation merge commit before this documentation-only receipt.
- [x] Create/link a Railway project and application service in the intended workspace, attach PostgreSQL, and configure `DATABASE_URL`, `PUBLIC_ORIGIN`, `HOST`, `TRUST_PROXY_HOPS`, and a strong server-only class code.
  - Evidence: Railway project `ed729bd9-403b-46a6-a97c-99ad9a0294c8`, web service `7230902f-5f52-474f-8d80-5ea05d2dbedb`, and PostgreSQL service `7cee59ec-c32a-4f6e-a626-be4843cdaede`.
- [x] Preserve public-demo deployment `3e7210a0-33a4-4a2e-8d26-b15508c8c5ab` as historical evidence for the preceding tracked tree.
  - Evidence: it reached `SUCCESS`; `https://web-production-08455.up.railway.app/api/health` returned `{"status":"ok"}`, and expected hardening headers and Secure cookie attributes passed readback.
- [x] Deploy and verify the clean five-stage implementation merge on Railway.
  - Evidence: deployment `39d38543-20ca-4626-95e6-237ef9213881`, built from clean `main` commit `abddbd0a2640aa0e4db0dcf0a1c47d65e9983597`, reached `SUCCESS`. Migration reported ready; live health and root returned 200 with expected security headers; class code `101` created a session; public configuration returned Part 1 and Part 2 scale groupings; logout removed access; exact local/live application-bundle hashes matched; requested copy was present; banned copy was absent; and logs showed no 5xx responses.
- [x] Record the clean-main release in a documentation-only receipt.
  - Evidence: this receipt changes no runtime behavior.
- [ ] Run the full teacher-review journey against the deployed Railway/PostgreSQL service as an active-beta follow-up. Current deployment, health, headers, entry behavior, and local disposable review evidence remain independently verified.

## Required Ollama Cloud proof

- [ ] Revoke the credential previously exposed in chat and create a fresh key.
- [ ] Configure only the rotated key as server-side `OLLAMA_API_KEY`; leave it out of source, browser storage, build output, logs, and exports.
- [ ] Enable Ollama Cloud explicitly and run one authorized source-egress acceptance test that verifies the provider/model disclosure, valid schema receipt, stored runtime provenance, size rejection, generic failure handling, and no deterministic fallback.
- [ ] Configure and verify the rotated key separately in Railway. The current blank local key and disabled Railway Ollama state do not satisfy this gate.

## Release boundary

PR #5 merged the reconciled five-stage implementation into GitHub `main` at `abddbd0a2640aa0e4db0dcf0a1c47d65e9983597`, and local `main`, `origin/main`, and GitHub `main` were synchronized at that commit. Railway deployment `39d38543-20ca-4626-95e6-237ef9213881` verified that clean implementation merge; dirty-working-tree deployment `3ea599f4-7fb5-4dd3-998d-c55134a69f15` remains historical evidence. The current five-stage scale-layer workflow groups Micro and Meso in Part 1 and Macro and Integration in Part 2; instructor review is asynchronous and advisory and never controls advancement. The paired five-view artifact closes the requested desktop/mobile recapture and populated-map evidence, while a complete live Teacher Console transaction and rendered reload/export journey remain follow-up. This documentation-only release receipt changes no runtime behavior. Ollama Cloud remains a separate disabled capability until its exposed credential is revoked, a rotated key is installed, and a live provider run is authorized.

The authority order remains in `docs/SOURCE_LEDGER.md`: the fuller Drive specification governs behavior; supplied wireframes govern compatible presentation; CALI materials provide context; August 5 notes remain unconfirmed minutes; direct user decisions supersede earlier visual/product choices; and STEM Splitter is an architecture precedent rather than subject-matter authority.
