# Systems Mapping release evidence ledger

Updated: 2026-08-21

## 2026-08-21 ecological-level candidate

- [x] Use four analytical levels: Micro and Meso in Part 1; Exosphere and Macrosphere in Part 2.
- [x] Enforce Micro as nodes only and Meso as connections only among the exact carried Micro node IDs, with no new Meso nodes.
- [x] Render Exosphere and Macrosphere as filterable concentric ecological regions without mutating hidden graph records.
- [x] Keep every stage, level, and map route open regardless of review or evaluation state.
- [x] Remove the buggy course-wide active-evaluation ceiling while leaving per-session supersession, request/provider bounds, submission queues, and retention purges unchanged.
- [x] Store Course settings once per Part and section. Both levels in a Part share the saved guidance and course material.
- [x] Treat **Preview level** as runtime context only. Safe preview output contains saved guidance and course material plus Part, section, contextual level, and revision; it excludes the effective prompt, guardrails, internal modules, and fingerprints.
- [x] Keep the current student flow memo-driven, with no note, question, submission, or review-status field. Teacher Console retains earlier review records and the compatibility API without gating student progress.
- [x] Record the final candidate suite and fresh PostgreSQL counts after the last code change; do not carry forward an earlier count.
  - Evidence: the ordinary suite passed 227 tests with 4 PostgreSQL tests skipped behind their environment guard. A fresh native PostgreSQL 17.5 loopback run passed its 4/4 `*_test` cases, including a populated v8→v9 migration. `pnpm build` passed with `index-DKxOo_cS.js`, `TeacherDashboard-CO55RhLk.js`, and `index-CisvqIv_.css`; `pnpm audit --prod` reported no known vulnerabilities; `git diff --check` passed; and gitleaks found no secrets in the dirty diff or three intended untracked documentation/concept files.
- [x] Finish and inspect the annotated desktop/phone screenshot package.
  - Evidence: `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ecological-cycle-qa-2026-08-21/systems-mapping-ecological-cycle-qa-2026-08-21.zip`, SHA-256 `89f959144d0257a0a21d6440f7be3a37e50925f60adc7dd1687caeb246277c11`, contains 40 true PNGs, 4 fabricated memos, and 4 metadata/assertion files. It covers 15 states at desktop and 390 px plus five each at 320 and 430 px, with strict checks finding no truncation, overlap, overflow, console errors, or captured success toasts; graph assertions record Micro 6/0, Meso exact carried IDs, cumulative 21/19, and Teacher Console after authentication. No credentials are packaged.
- [ ] Commit and push the changed tree, update GitHub `main`, deploy that commit to Railway, and record live migration/health/access/Teacher Console/configuration/logout/bundle evidence.
- [ ] Run a live model-provider acceptance only if a rotated server-only key is authorized and enabled.

## 2026-08-19 memo review redesign

This redesign supersedes the earlier "student-safe redirects" contract. Items in later historical sections that describe at-most-three `{action, evidenceExcerpt}` records, unmet-criteria filtering, a student note for instructor review, or memo edits retiring map items describe the pre-redesign behavior and are retained only as provenance.

- [x] Replace the rubric suggestion contract (H1–H4 / C1–C8, redirects) with a bounded memo review contract: `guidance`, `nodes`, `connections`, `example`, `readiness` — the model's reading reaches the student without a score and remains subject to level-specific rules.
  - Evidence: `server/app.js` `OLLAMA_SUGGESTION_SCHEMA_INSTRUCTION`, `normalizeMemoReview`, `studentMemoReview`; `server/preflight.test.js`; `src/domain.test.js`.
- [x] Call the model automatically on **review your memo**, seed **choose nodes and describe connections** from its proposals merged with local extraction, and let the readiness signal encourage advancement without gating anything.
  - Evidence: `src/App.jsx` auto-review effect, `buildCandidatesFromProject`, readiness banner; `src/App.test.jsx`.
- [x] Keep the memo collapsed but editable on every later stage; memo edits never retire map items or clear candidates — they only mark guidance refreshable by fingerprint.
  - Evidence: `MemoDrawer`, `invalidateSubmissionDerived`, staleness tests in `src/App.test.jsx`.
- [x] Remove instructor-review UI from the student workflow (no "Add a note", "Note for instructor", "Instructor guidance", or review-status panels). Server review endpoints and the Teacher Console queue remain for retained records.
- [x] Allow connection suggestions with an empty description: the client sends a bounded excerpt of the memo itself, and the button requires only two nodes.
- [x] Preserve the 2026-08-19 run as historical evidence: 166 client tests passing (3 PostgreSQL-gated skips), 65 server tests passing, production Vite build succeeding.

This ledger separates implemented behavior from rendered-browser, GitHub, Railway, and live-provider proof. A checked item confirms the implementation or the specifically labeled historical receipt; it does not close a later external gate. A code reference or earlier screenshot alone is not enough to verify the current candidate.

## Implemented contract

- [x] Use five direct, verb-led stages throughout: add your memo, review your memo, choose nodes and describe connections, build map, and revise and export.
  - Evidence: current `src/App.jsx`, canonical-stage UI regression, and server prototype-stage contract.
- [x] Keep the model's full criteria, scores, outcomes, and taxonomy out of the student workflow.
  - Evidence: the student evaluation response contains bounded `review` fields only: `guidance`, `nodes`, `connections`, `example`, and `readiness`. It excludes criteria, scores, prompt text, guardrails, fingerprints, and provider-only output.
- [x] Ground guidance and suggestions in the memo without adding them automatically.
  - Evidence: Micro returns nodes only; Meso returns no nodes and may connect only exact carried Micro IDs; every candidate still requires an explicit student decision.
- [x] Make suggestion generation server-authoritative.
  - Evidence: the client sends bounded project details and memo text to `POST /api/preflight/evaluations`; the server selects the effective configuration, validates the level-specific result, and returns the bounded review with sanitized runtime metadata.
- [x] Keep the retained instructor-review API non-gating and separate from the current student UI.
  - Evidence: the current student flow has no note, question, submission, or review-status field. Retained submissions remain transactional and Teacher Console can still display their records without controlling map access.
- [x] Align teacher control with the five student stages.
  - Evidence: Course settings loads only when selected and opens one Part and section at a time. Each Part-and-section pair contains bounded guidance and course-material fields shared by both levels in that Part. **Preview level** supplies context only. Safe preview output excludes the effective prompt, guardrails, internal modules, and fingerprints. Published records remain read-only, earlier records can be cloned for rollback, and legacy module routes return `410`.
- [x] Persist the new evaluation and review workflow in both SQLite and PostgreSQL.
  - Evidence: matching schemas, transactions, constraints, migrations, retention locks, append-only triggers, and fresh PostgreSQL 17 integration tests.
- [x] Implement bounded retention.
  - Evidence: unsubmitted evaluations expire after 1 day; pending submissions after 30 days; decided submissions after 180 days. Retention removes rows that contain memo text and leaves only hashed append-only purge receipts.
- [x] Implement the deterministic Systems Mapping runtime and explicit provider contracts.
  - Evidence: deterministic mode follows the same level-specific output boundaries and sends no memo outside the classroom server. Provider mode is server-only opt-in, limits memo text to 131,072 UTF-8 bytes, validates the exact result schema, and does not silently fall back on failure.
- [x] Keep capability identifiers out of portable releases.
  - Evidence: private, course, CUNY, and public projections redact both evaluation and instructor-review capabilities; imported redacted copies cannot poll the original review.
- [x] Harden local and hosted access boundaries in code.
  - Evidence: local default code `101` remains server-side. Hosted private-course mode rejects it and requires a 10–32 character code with at least six distinct characters; hosted public-demo mode accepts it only with the exact server-side opt-in flag. Both retain HTTPS origin, explicit host/proxy configuration, Secure cookies, and bounded issuance/evaluation/submission rates.
- [x] Preserve teacher isolation and account ownership.
  - Evidence: fresh databases seed Maria and Zach as unclaimed identities; a temporary operator token authorizes one claim; passphrases use salted scrypt derivations; teacher and student cookies/routes remain separate.
- [x] Preserve phone-primary map state and annotation behavior.
  - Evidence: automated contracts cover schema-v1 migration, exact layout/viewport restoration, pointer and keyboard node movement, pan/zoom/fit, node/relationship/map annotations, debounced persistence, JSON round-trip, and redaction.
- [x] Keep level identification visually restrained and separate from map labels.
  - Evidence: the Map key identifies Micro, Meso, Exosphere, and Macrosphere; Exosphere and Macrosphere use ecological regions; complete labels remain above connection lines and clear of icons.
- [x] Neutralize CSV formula cells and reject unknown or credential-shaped project fields.
  - Evidence: byte-level CSV tests cover formula/control/leading-whitespace prefixes; schema and portable-export canaries fail closed.
- [x] Reconcile release documentation to the ecological-level candidate and preserve old GitHub/Railway receipts as historical evidence only.

## Historical automated and screenshot receipts

- [x] Preserve the published pre-pedagogy release baseline: 130 passing tests, 3 PostgreSQL-gated skips, and a successful production Vite build.
- [x] Preserve the earlier server and course-profile run: 60 passed; 3 PostgreSQL-gated tests skipped in that ordinary SQLite run.
- [x] Preserve the latest disposable PostgreSQL 17 integration before the redesign: 3/3 passed. The current full run still reports the same 3 integration tests as environment-gated skips.
- [x] Preserve the 2026-08-17 integrated client/domain/server suite: 171 passed; 3 PostgreSQL integration tests skipped because that environment was not configured. This count predates the ecological-level candidate.
- [x] Rebuild the production bundle after the five-stage Part 1/Part 2 changes; `pnpm build` passed.
- [x] Preserve the earlier seven-stage Course settings recapture as historical release evidence.
  - Evidence: `/Users/milwright/.codex/visualizations/2026/08/11/019ff16f-b119-7963-9090-525be49b8d8a/systems-mapping-course-settings-2026-08-11.zip` passes `unzip -t` but predates the six-section redesign.
- [x] Preserve representative six-section, direct-map, empty-map, review, and Teacher Console views across 320, 390, 430, and 1440 px as historical evidence.
  - Evidence: `/Users/milwright/.codex/visualizations/2026/08/11/019fe2ef-096c-7093-b898-9a6e64ef1b23/systems-mapping-semester-cycle-qa.zip` contains 7 historical PNGs and passes `unzip -t`.
- [x] Preserve the earlier five requested views at desktop and mobile sizes, including early and populated multi-level maps.
  - Evidence: `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ui-qa-2026-08-12.zip` contains 10 PNGs—five paired desktop/mobile views—plus annotations. ZIP integrity and visual inspection passed; the developed-map pair records the populated map and visible scale layers.

## Historical local and browser proof

- [x] Restart the final production server on `127.0.0.1:4177` while preserving the real SQLite database and verify the health endpoint.
  - Evidence: the final server reported `http://127.0.0.1:4177`; `/api/health` returned `{"status":"ok"}`.
- [x] Audit the real handoff database with value-free queries and preserve existing user-owned account/session state.
  - Evidence: integrity `ok`; 2 accounts with 1 already claimed; 1 existing teacher session; 0 student sessions, evaluations, submissions, review events, or prototype events. The existing code-owned prompt base remains internal. Data directory/files are `0700`/`0600`.
- [x] Preserve the earlier disposable browser journey through the then-visible **Approve with a question** action.
  - Evidence: this historical journey verified questions tied to passages in the memo, collapsed review details, one instructor focus and question, the student response, candidate choice, map entry, and revision section before the non-gating redesign and current feedback labels.
- [x] Preserve class-entry and changed student and teacher views at 320, 390, 430, and 1440 px as historical evidence with no document-level horizontal overflow.
  - Evidence: the original 50-PNG archive is `/Users/milwright/.codex/visualizations/2026/08/08/019fe2ef-096c-7093-b898-9a6e64ef1b23/systems-mapping-app-all-views-2026-08-11.zip`; the four earlier Course settings captures are in `/Users/milwright/.codex/visualizations/2026/08/11/019ff16f-b119-7963-9090-525be49b8d8a/systems-mapping-course-settings-2026-08-11.zip`. Both pass `unzip -t`.
- [x] Preserve the first five-stage Railway snapshot as historical evidence.
  - Evidence: dirty-working-tree deployment `3ea599f4-7fb5-4dd3-998d-c55134a69f15` reached terminal `SUCCESS`; health and root returned 200, class access and session/configuration checks succeeded, logout removed access, and copy and no-5xx checks passed. The later clean-main deployment superseded it for that preceding tree only.
- [x] Preserve the earlier production dependency audit and source/application-bundle scans.
  - Evidence: the production audit reported no known vulnerabilities; credential scans were clean; the application bundle excludes the local class code, source maps, dangerous HTML, teacher identity, review capabilities, and server prompt content. Numeric `101` values in the library bundle are unrelated glyph-table data.

## Historical follow-up carried into the current release gates

- [ ] Exercise **Add feedback** and **Recommend another pass** in separate current browser fixtures. These actions retain the compatible `approve` and `reject` API IDs; their automated branches pass, but the five-view package is not a complete teacher-review journey.
- [ ] Verify current reload restoration and JSON export/import restoration in the rendered application.
- [ ] Extend rendered interaction receipts for map drag, keyboard movement, zoom/pan/fit, and every annotation surface. Earlier persistence and candidate-to-map receipts remain historical regression evidence.

## Historical GitHub and Railway proof

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
- [ ] If the retained review API is exercised, run that compatibility journey separately against the candidate deployment. Earlier deployment, health, headers, entry behavior, and disposable review evidence remain historical only.

## Required Ollama Cloud proof

- [ ] Revoke the credential previously exposed in chat and create a fresh key.
- [ ] Configure only the rotated key as server-side `OLLAMA_API_KEY`; leave it out of source, browser storage, build output, logs, and exports.
- [ ] Enable Ollama Cloud explicitly and run one authorized acceptance test for sending memo text to the provider. Verify the provider/model disclosure, valid schema receipt, stored runtime provenance, size rejection, generic failure handling, and no deterministic fallback.
- [ ] Configure and verify the rotated key separately in Railway. The current blank local key and disabled Railway Ollama state do not satisfy this gate.

## Release boundary

PR #5, commit `abddbd0a2640aa0e4db0dcf0a1c47d65e9983597`, Railway deployment `39d38543-20ca-4626-95e6-237ef9213881`, and dirty-working-tree deployment `3ea599f4-7fb5-4dd3-998d-c55134a69f15` are historical receipts for the preceding Macro/Integration implementation. They do not verify the current Micro/Meso/Exosphere/Macrosphere candidate. Current local tests and rendered captures are complete; the release boundary remains open until the changed tree is committed, pushed to `main`, deployed, and read back live. A live model-provider run remains separate and requires an authorized rotated key.

The authority order remains in `docs/SOURCE_LEDGER.md`: the fuller Drive specification governs behavior; supplied wireframes govern compatible presentation; CALI materials provide context; August 5 notes remain unconfirmed minutes; direct user decisions supersede earlier visual/product choices; and STEM Splitter is an architecture precedent rather than subject-matter authority.
