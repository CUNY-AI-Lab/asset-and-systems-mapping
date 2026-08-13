# Systems Mapping — QA and visual-fidelity report

Updated: 2026-08-13

## Current status

The current active-beta working tree uses a five-stage learning cycle around one persistent map. Node selection and connection prompting share one stage. Part 1 groups Micro and Meso; Part 2 groups Macro and Integration. Instructor review is asynchronous and advisory, so pending or returned work never prevents stage navigation, scale changes, candidate choice, or map access. Accumulated Micro, Meso, Macro, and Integration records can be viewed as combined or individual layers. The latest automated, build, desktop/mobile, and Railway snapshot evidence for this redesign is recorded below. GitHub `main` does not yet contain the implementation.

The original image set, four-viewport Course settings recapture, and public-demo deployment `3e7210a0-33a4-4a2e-8d26-b15508c8c5ab` remain historical evidence for the preceding tracked release. The current paired five-view artifact verifies the redesigned landing, post-code state, early map, populated map, and Teacher Console at desktop and mobile sizes. Railway deployment `3ea599f4-7fb5-4dd3-998d-c55134a69f15` verifies the current working-tree snapshot, but it is not a commit-backed release. Live Ollama remains disabled and unverified.

## Completed automated runs

| Gate | Current result | Scope |
| --- | --- | --- |
| Published release baseline | 130 passed; 3 PostgreSQL-gated skipped | Pre-pedagogy GitHub/Railway tree; retained as historical release evidence, not the new total. |
| Earlier standalone `pnpm test:server` | 60 passed; 3 PostgreSQL-gated skipped | Historical focused receipt for stage-specific course settings, source-prompt projection, teacher-only full detail, focus/question decisions, SQLite API/auth/config/evaluation/review/retention, hosted mode, public-demo gating, and Ollama adapter. The current full run supersedes it as the integrated total. |
| Latest disposable PostgreSQL 17 integration before this redesign | 3/3 passed | Teacher-only full result, minimized student projection/status, decision persistence, and database parity; rerun remains a release gate because PostgreSQL was not configured for the current local suite. |
| Current focused App/domain contract | Green; no separate subtotal recorded | Covered by the integrated frozen-tree run without inventing a focused-test count. |
| Current full `pnpm test` | 160 passed; 3 PostgreSQL integration tests skipped | Integrated client, domain, server, shared contract, adapters, and persistence tree; PostgreSQL was not configured for the ordinary run. |
| Current `pnpm build` | Passed | Production Vite bundle rebuilt after the five-stage cycle update; Teacher Console is emitted as a separate on-demand chunk instead of loading on the student entry path. |
| Current production dependency audit | No known vulnerabilities | Production dependency set only. |
| Current source/application-bundle scans | Clean | No credential values; no application-bundle class code, source maps, dangerous HTML sink, teacher identity, review capability, or server prompt. |

The PostgreSQL skips in the current ordinary suite are environment gates, not hidden failures. The equivalent integration group passed earlier against a fresh disposable PostgreSQL 17 database; that historical receipt does not replace a current configured PostgreSQL rerun.

The current production audit reported no known vulnerabilities. Source and application-bundle credential scans were clean. The application bundle excludes the local class code `101`; unrelated numeric `101` values occur only in a library bundle's glyph tables. No source map, dangerous HTML sink, teacher identity, review capability, or server prompt content was found in the application bundle.

## GitHub and Railway evidence

- Private GitHub repository: `CUNY-AI-Lab/systems-mapping`. GitHub readback confirmed that PR [#1](https://github.com/CUNY-AI-Lab/systems-mapping/pull/1) merged into `main` at commit `95c01f4`; current GitHub `main` still precedes the five-stage Part 1/Part 2 implementation.
- The tracked publication excludes environment files, databases, local state, screenshots, and test fixtures.
- Railway project: `systems-mapping` (`ed729bd9-403b-46a6-a97c-99ad9a0294c8`) with web and PostgreSQL services.
- Historical Railway deployment `3e7210a0-33a4-4a2e-8d26-b15508c8c5ab` reached `SUCCESS` for the preceding tracked public-demo tree; database-backed health, hardening headers, Secure cookie attributes, class access, session readback, and logout passed.
- Current snapshot deployment `3ea599f4-7fb5-4dd3-998d-c55134a69f15` reached terminal `SUCCESS`. Live health and root returned 200; class access, session and configuration readback, logout cleanup, copy, and no-5xx checks passed. Railway received a dirty working-directory snapshot, so this receipt does not establish a GitHub commit-to-deployment chain.
- Public health readback: `https://web-production-08455.up.railway.app/api/health` returned `{"status":"ok"}`.
- The deployed service accepted `101` only under the explicit public-demo configuration. The earlier browser entry and header readback remain historical hardening evidence; the latest snapshot acceptance covers health, root, session/configuration behavior, logout, copy checks, and absence of 5xx responses.
- The preserved local SQLite handoff store passed `PRAGMA integrity_check`; it contains no student sessions, evaluations, review submissions/events, or prototype events. One previously claimed teacher account and its existing session were retained as user-owned state.

## Automated behavior verified

### Student access and resume

- Class access is an asynchronous server exchange; rejected codes are not persisted.
- A valid student cookie restores the saved local stage and project summary.
- Invalid, throttled, expired, and unavailable-server states retain the local project.
- A prototype-logging 401 triggers a session recheck; it cannot expire a newer valid grant solely because an older request failed.
- Hosted runtime disclosure identifies course-server persistence, 1/30/180-day retention, and deterministic or Ollama provider behavior.

### Suggestion and instructor-review workflow

- The interface names five repeatable stages directly: choose a scale and add a source; review source with your instructor; choose nodes and describe connections; build map; and revise and export.
- The student surface displays only **Return to the source** with zero to three short prompts. Each prompt contains one action and may include one short evidence excerpt.
- The student adds a separate note for the instructor. No criterion ID, status, score, threshold, outcome, taxonomy, rationale, missing-variable field, or synthesized model-review group is exposed.
- Suggestion generation posts exact source/project input to the authoritative evaluation endpoint and accepts only `{evaluation:{id,redirects,configSnapshot,runtime,createdAt,expiresAt}}`.
- The request includes bounded project custom instructions but excludes the local fixed prompt. The returned configuration snapshot contains revisions/fingerprints/module versions, not teacher prompt text or custom-instruction text.
- Review submission sends exactly `{evaluationId, studentAnnotation}`; it cannot replace suggestion/configuration data.
- Pending, approved, and returned review states leave candidate choice, every stage, every scale, and the map available in every cycle. Instructor decisions add direction without changing the source, current stage, or graph records.
- A pending review resumes after class-session renewal using the locally held review capability. Portable copies cannot poll because capabilities are redacted.
- Ollama Cloud source/inquiry byte limits are checked in the client and server. Provider failures remain errors rather than deterministic fallbacks.

### Teacher Console

- The Teacher Console opens on a pending queue and does not load Course settings until selected.
- One selected submission shows source text, the inquiry, and the student's note. Collapsed **Review details** groups evidence excerpts, possible follow-up, and open questions without presenting model scores or criterion labels as the instructor's judgment.
- Exactly three visible feedback actions are available: **Add feedback**, **Add feedback and a question**, and **Recommend another pass**. Every action requires one **Focus for the student**. **Add feedback and a question** alone reveals and requires one **Question for the student**; stored API decision IDs remain compatible with earlier records, and no revised-model-suggestion field is accepted.
- A recorded decision leaves the pending queue and displays returned append-only history.
- Expected-revision conflicts preserve the unsent teacher draft and require an explicit reload before retry.
- Course settings follows the five student stages and opens one stage at a time.
- Every stage provides one field for model guidance and one field for pasted course material. Unsaved text blocks preview and publication. A saved draft can be previewed by stage and scale, then published with a second change note.
- Prompt tests prove that only the current stage enters the request and supporting material is labeled as reference content.
- Publishing retires the previous profile, records append-only history, and changes the runtime fingerprint. Deterministic scoring remains fixed while Ollama prompt composition changes.
- Legacy module, module-history, and direct-effective-prompt endpoints return `410` after teacher authentication.
- Manual teacher claim requires account ID, passphrase confirmation, and a server bootstrap token; the unauthenticated surface does not enumerate Maria or Zach.

### Server authority, persistence, and security

- An evaluation ID is random, same-session, one-use, and time-limited. Consumption and pending-snapshot creation are transactional.
- Student status responses are minimal. Teacher queue/detail/decision routes are teacher-authenticated.
- SQLite and PostgreSQL implement equivalent tables, constraints, indexes, append-only protections, retention locks, and prepared-query behavior.
- Evaluations expire after 1 day. Pending review snapshots expire after 30 days; decided snapshots after 180 days. Only a hashed purge receipt survives submission retention.
- Hosted mode requires HTTPS, explicit host/proxy configuration, Secure cookies, and bounded session/evaluation/submission capacity. Private courses require a strong non-`101` code; a public demo requires the exact server-side `true`/`101` opt-in pair.
- Exact-origin and trusted-Host checks, restrictive security headers, no-store API responses, body/content-type limits, throttles, and generic internal/provider failures are tested.
- Ollama adapter tests cover fixed production endpoint, non-enumerable key handling, authorization header, JSON-only input treatment, cancellation/timeout, HTTP failure, bounded streaming/body size, malformed/extra fields, and runtime metadata.

### Project, graph, and export

- Legacy projects migrate into five stages with deterministic node positions, a bounded viewport, and stable node, relationship, and map annotation IDs.
- Every scale is selectable without a release prerequisite. The map is directly available from every stage, accepts an empty graph, opens with all active scale layers visible, and filters layers without changing stored graph records.
- Editing a source retires only graph records on the current scale that match the prior source fingerprint; accumulated records on other scales remain active.
- Layout, viewport, and every annotation surface round-trip through canonical JSON.
- Pointer movement commits one completed node move; keyboard movement supports fine and coarse steps; pan/zoom/fit persist bounded viewport state.
- Annotation saves report queued, saved, and failure states without discarding in-memory work.
- Import validation rejects unknown fields, credential-shaped values, invalid references, malformed geometry, oversized collections, and policy escalation.
- Every sharing tier redacts evaluation and review capability IDs. Restricted/sensitive projections also redact source and derived prose according to tier while preserving IDs and a manifest.
- CSV output neutralizes formula markers, tabs/carriage returns, and leading-whitespace variants at the byte boundary.

## Visual-fidelity reconciliation

| Decision | Current implementation | Verification state |
| --- | --- | --- |
| Direct stage names | Five verb-led labels are used throughout. | Automated DOM and the paired desktop/mobile five-view artifact verified. |
| Return to source evidence | At most three short prompts plus the student's note; no student-facing model codification or synthesized groups. | Integrated automation and current rendered journey verified. |
| Teacher review details | Evidence excerpts, possible follow-up, and open questions are collapsed; the instructor writes one focus and optionally one question. | Integrated automation verified; a complete current rendered teacher-review journey remains follow-up. |
| Teacher Console | Review queue first; Course settings secondary and lazy; one editor across five repeatable stages. | Automated DOM verified; current five-stage Course settings rendered at desktop and mobile sizes. |
| Editorial typography | Modest serif headings, humanist controls, monospace provenance; no oversized display copy. | Source and rendered-browser verified. |
| Monochrome-dominant palette | White/black/gray surfaces with restrained teal, amber, and plum accents. | Source and rendered-browser verified; dedicated contrast audit remains separate. |
| Redundant legend | Micro/teal/circle; meso/amber/square; macro/plum/diamond; integration/black/double-circle; claim states repeated through text and line pattern. | DOM/source and rendered-browser verified. |
| Phone-primary map | Safe-area chrome, internal canvas containment, phone inspector, 44/48 px controls, durable layout/viewport/annotations. | Automated behavior plus current 320/390/430 rendered geometry verified. |

## Screenshots and browser evidence

The original screenshot archive is `/Users/milwright/.codex/visualizations/2026/08/08/019fe2ef-096c-7093-b898-9a6e64ef1b23/systems-mapping-app-all-views-2026-08-11.zip`. It contains 50 PNGs covering 11 student and teacher states plus the earlier Course settings view. The preceding progression-editor recapture is `/Users/milwright/.codex/visualizations/2026/08/11/019ff16f-b119-7963-9090-525be49b8d8a/systems-mapping-course-settings-2026-08-11.zip`; it contains the earlier Course settings view at 320, 390, 430, and 1440 px. Both pass `unzip -t`. All displayed classroom content is synthetic.

The earlier six-section semester-cycle browser archive is `/Users/milwright/.codex/visualizations/2026/08/11/019fe2ef-096c-7093-b898-9a6e64ef1b23/systems-mapping-semester-cycle-qa.zip`. It contains 7 historical PNGs across 320, 390, 430, and 1440 px covering class entry, the then-current six sections, direct empty-map access, the non-gating review screen, Teacher Console access, and the earlier Course settings. It passes `unzip -t`; it does not verify the current five-stage Part 1/Part 2 presentation.

The current artifact is `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ui-qa-2026-08-12.zip`. It contains 10 PNGs—five desktop/mobile pairs covering landing, post-code state, early map, populated map, and Teacher Console—plus annotations. ZIP integrity and visual inspection passed. The populated-map pair records the developed map and visible scale layers. This artifact closes the requested five-view recapture; it does not replace a full rendered teacher-review transaction.

The semester-cycle concept is `docs/concepts/semester-map-cycle-spec-v1.png`. It is a design specification, not rendered-browser evidence.

## Rendered journey for the current tree

Use a disposable database and temporary teacher claim values, never the real handoff database:

1. Open the production build and enter class access.
2. Start or resume a project, add a source, and generate suggestions.
3. Confirm that **review the source with your instructor** shows no more than three short questions tied to the source and no full model codification; add a student note.
4. Submit a student note and confirm that the instructor has not responded yet.
5. Sign into the Teacher Console, confirm **Review details** starts collapsed, use the evidence excerpts and open questions as reference, write one focus and one question, and select **Add feedback and a question**.
6. Return as the student, refresh the response, and verify the instructor focus/question without a source or map rewrite.
7. Verify that mapping was already available while review was pending, open an empty map if no candidates exist, and combine at least two scale layers.
8. Capture class entry and changed views at 320, 390, 430, and 1440 px and inspect for horizontal overflow.

The earlier disposable journey passed against the preceding workflow. The current five-view artifact verifies the five-stage Part 1/Part 2 presentation and populated map; the complete non-gating review transaction described above remains follow-up before a fully rendered teacher-review claim.

## Active-beta follow-up

- Exercise **Add feedback** and **Recommend another pass** in separate current rendered fixtures. Their compatible `approve` and `reject` API branches pass automated tests, but the five-view artifact is not a complete teacher-review journey.
- Verify current reload restoration and export/import restoration in the rendered application.
- Extend current rendered receipts for map drag, keyboard movement, zoom/pan/fit, every annotation surface, and full focus traversal. Automated coverage remains green.
- The final loopback listener and real SQLite handoff database are healthy; the one pre-existing claimed teacher account/session was intentionally preserved rather than treated as QA residue.
- Railway snapshot deployment `3ea599f4-7fb5-4dd3-998d-c55134a69f15` reached `SUCCESS`; health, root, hosted `101` access, session/configuration readback, logout, copy, and no-5xx checks passed. Because it came from a dirty working directory and GitHub `main` lacks the implementation, a commit-backed redeployment remains required for release provenance. A full teacher-review journey against deployed Railway/PostgreSQL remains useful beta coverage.
- Local `.env` contains no Ollama key. The previously pasted key is exposed and must be revoked; no live provider run has occurred.
- Deterministic STEM Splitter does not interpret teacher prompt or project-instruction text. Its configuration snapshots are provenance only; prompt customization affects actual generation only when an accepted provider adapter is enabled.
- Hosted review stores the source excerpt for the disclosed retention period. Institutional approval and operating policy remain separate from code correctness.

These follow-ups do not invalidate the verified Railway snapshot. They limit commit-backed release, complete teacher-review, and optional-provider claims.

## Provenance caveat

The source authority remains as recorded in `docs/SOURCE_LEDGER.md`. The governing Drive specification, supplied wireframes, CALI materials, and direct user decisions inform the implementation. Zach's August 5 notes remain unconfirmed by Maria. Gmail review did not locate a Maria-specific Zoom summary, and the unrelated Chantale/Virginia meeting-assets summary is not treated as evidence of Maria's decisions.
