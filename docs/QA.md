# Systems Mapping — QA and visual-fidelity report

Updated: 2026-08-10

## Current status

The deterministic active-beta release is automated-test green, production-build green, security-scanned, published to private GitHub, and deployed to Railway. The current student journey limits guidance to at most three source-directed prompts, keeps all criteria/scores behind collapsed teacher-only details, and records one instructor focus plus an optional question. A disposable current browser journey verified **Approve with a question** through candidate choice, map entry, and the revision stage. Live Ollama remains disabled and unverified.

The current image set covers 11 student and teacher states at configured 320, 390, 430, and 1440 px viewports, including class entry and the changed source-prompt and teacher-review views. Inspection found no document-level horizontal overflow. The deployed class-entry page produced zero console warnings and rejected the local-only class code `101`. Simple **Approve**, **Reject**, reload restoration, and export/import restoration were not part of this rendered journey and remain active-beta follow-up.

## Completed automated runs

| Gate | Current result | Scope |
| --- | --- | --- |
| Published release baseline | 130 passed; 3 PostgreSQL-gated skipped | Pre-pedagogy GitHub/Railway tree; retained as historical release evidence, not the new total. |
| Current `pnpm test:server` | 53 passed; 3 PostgreSQL-gated skipped | Source-prompt projection, teacher-only full detail, focus/question decisions, SQLite API/auth/config/evaluation/review/retention, hosted mode, and Ollama adapter. |
| Current fresh PostgreSQL 17 integration | 3/3 passed | Teacher-only full result, minimized student projection/status, decision persistence, and database parity. |
| Current focused App/domain contract | Green; no separate subtotal recorded | Covered by the integrated frozen-tree run without inventing a focused-test count. |
| Current full `pnpm test` | 132 passed; 3 PostgreSQL-gated skipped | Integrated frozen client, domain, server, and persistence tree. |
| Current `pnpm build` | Passed | Production Vite bundle rebuilt after the frozen pedagogy changes. |
| Current production dependency audit | No known vulnerabilities | Production dependency set only. |
| Current source/application-bundle scans | Clean | No credential values; no application-bundle class code, source maps, dangerous HTML sink, teacher identity, review capability, or server prompt. |

The PostgreSQL skips in the ordinary server suite are environment gates, not hidden failures; the same integration group passed separately against a fresh disposable PostgreSQL 17 database.

The current production audit reported no known vulnerabilities. Source and application-bundle credential scans were clean. The application bundle excludes the local class code `101`; unrelated numeric `101` values occur only in a library bundle's glyph tables. No source map, dangerous HTML sink, teacher identity, review capability, or server prompt content was found in the application bundle.

## Published release evidence

- Private GitHub repository: `CUNY-AI-Lab/systems-mapping`. GitHub readback confirmed application-contract commit `cb2a959` and **Active beta** notice commit `23aa134`.
- The tracked publication excludes environment files, databases, local state, screenshots, and test fixtures.
- Railway project: `systems-mapping` (`ed729bd9-403b-46a6-a97c-99ad9a0294c8`) with web and PostgreSQL services.
- Railway deployment `68e0a3af-33d7-4cc9-9c4e-f95393d83963` reached `SUCCESS` for the current active-beta tree.
- Public health readback: `https://web-production-08455.up.railway.app/api/health` returned `{"status":"ok"}`.
- The deployed service returned the expected hardening headers. Its browser entry loaded with zero console warnings and correctly rejected `101`.
- The preserved local SQLite handoff store passed `PRAGMA integrity_check`; it contains no student sessions, evaluations, review submissions/events, or prototype events. One previously claimed teacher account and its existing session were retained as user-owned state.

## Automated behavior verified

### Student access and resume

- Class access is an asynchronous server exchange; rejected codes are not persisted.
- A valid student cookie restores the saved local stage and project summary.
- Invalid, throttled, expired, and unavailable-server states retain the local project.
- A prototype-logging 401 triggers a session recheck; it cannot expire a newer valid grant solely because an older request failed.
- Hosted runtime disclosure identifies course-server persistence, 1/30/180-day retention, and deterministic or Ollama provider behavior.

### Suggestion and instructor-review workflow

- The interface names seven actions directly: Choose a scale → Add a source → Review suggestions → Check your instructor's response → Choose what to map → Build the map → Revise and export.
- The student surface displays only **Return to the source** with zero to three short prompts. Each prompt contains one action and may include one short evidence excerpt.
- The student adds a separate note for the instructor. No criterion ID, status, score, threshold, outcome, taxonomy, rationale, missing-variable field, or synthesized model-review group is exposed.
- Suggestion generation posts exact source/project input to the authoritative evaluation endpoint and accepts only `{evaluation:{id,redirects,configSnapshot,runtime,createdAt,expiresAt}}`.
- The request includes bounded project custom instructions but excludes the local fixed prompt. The returned configuration snapshot contains revisions/fingerprints/module versions, not teacher prompt text or custom-instruction text.
- Review submission sends exactly `{evaluationId, studentAnnotation}`; it cannot replace suggestion/configuration data.
- Pending review prevents the student from choosing what to map. **Approve** and **Approve with a question** open that step. **Reject** returns the student to **Add a source** without changing memo, prompt, or graph records.
- A pending review resumes after class-session renewal using the locally held review capability. Portable copies cannot poll because capabilities are redacted.
- Ollama Cloud source/inquiry byte limits are checked in the client and server. Provider failures remain errors rather than deterministic fallbacks.

### Teacher dashboard

- The dashboard opens on a pending queue and does not load model modules/history until Model guidance is selected.
- One selected submission shows source text, inquiry, and the student's note. Full criteria, scores, outcome, evidence, possible redirects, open questions, and criterion records remain closed by default behind **Model review details**.
- Exactly three decisions are available. Every decision requires one **Focus for the student**. **Approve with a question** alone reveals and requires one **Question for the student**; no revised-model-suggestion field is accepted.
- A recorded decision leaves the pending queue and displays returned append-only history.
- Expected-revision conflicts preserve the unsent teacher draft and require an explicit reload before retry.
- Model guidance keeps one module editor visible, supports keyboard-roving tabs, requires change notes, and preserves modular stale-write recovery.
- Manual teacher claim requires account ID, passphrase confirmation, and a server bootstrap token; the unauthenticated surface does not enumerate Maria or Zach.

### Server authority, persistence, and security

- An evaluation ID is random, same-session, one-use, and time-limited. Consumption and pending-snapshot creation are transactional.
- Student status responses are minimal. Teacher queue/detail/decision routes are teacher-authenticated.
- SQLite and PostgreSQL implement equivalent tables, constraints, indexes, append-only protections, retention locks, and prepared-query behavior.
- Evaluations expire after 1 day. Pending review snapshots expire after 30 days; decided snapshots after 180 days. Only a hashed purge receipt survives submission retention.
- Hosted mode requires HTTPS, explicit host/proxy configuration, a strong non-`101` class code, Secure cookies, and bounded session/evaluation/submission capacity.
- Exact-origin and trusted-Host checks, restrictive security headers, no-store API responses, body/content-type limits, throttles, and generic internal/provider failures are tested.
- Ollama adapter tests cover fixed production endpoint, non-enumerable key handling, authorization header, JSON-only input treatment, cancellation/timeout, HTTP failure, bounded streaming/body size, malformed/extra fields, and runtime metadata.

### Project, graph, and export

- Legacy projects migrate to deterministic node positions, a bounded viewport, and stable node/relationship/map annotation IDs.
- Layout, viewport, and every annotation surface round-trip through canonical JSON.
- Pointer movement commits one completed node move; keyboard movement supports fine and coarse steps; pan/zoom/fit persist bounded viewport state.
- Annotation saves report queued, saved, and failure states without discarding in-memory work.
- Import validation rejects unknown fields, credential-shaped values, invalid references, malformed geometry, oversized collections, and policy escalation.
- Every sharing tier redacts evaluation and review capability IDs. Restricted/sensitive projections also redact source and derived prose according to tier while preserving IDs and a manifest.
- CSV output neutralizes formula markers, tabs/carriage returns, and leading-whitespace variants at the byte boundary.

## Visual-fidelity reconciliation

| Decision | Current implementation | Verification state |
| --- | --- | --- |
| Direct stage names | Seven verb-led labels are used throughout. | Automated DOM and current rendered-browser verified. |
| Return to source evidence | At most three short prompts plus the student's note; no student-facing model codification or synthesized groups. | Integrated automation and current rendered journey verified. |
| Teacher review details | Full criteria/scores are teacher-only and collapsed; the instructor writes one focus and optionally one question. | Integrated automation and current rendered **Approve with a question** journey verified. |
| Progressive teacher dashboard | Review queue first; Model guidance secondary/lazy; one module editor. | Automated DOM and rendered-browser verified. |
| Editorial typography | Modest serif headings, humanist controls, monospace provenance; no oversized display copy. | Source and rendered-browser verified. |
| Monochrome-dominant palette | White/black/gray surfaces with restrained teal, amber, and plum accents. | Source and rendered-browser verified; dedicated contrast audit remains separate. |
| Redundant legend | Micro/teal/circle; meso/amber/square; macro/plum/diamond; integration/black/double-circle; claim states repeated through text and line pattern. | DOM/source and rendered-browser verified. |
| Phone-primary map | Safe-area chrome, internal canvas containment, phone inspector, 44/48 px controls, durable layout/viewport/annotations. | Automated behavior plus current 320/390/430 rendered geometry verified. |

## Screenshots and browser evidence

The current screenshot set is `/Users/milwright/.codex/visualizations/2026/08/08/019fe2ef-096c-7093-b898-9a6e64ef1b23/systems-mapping-final/`. It contains 44 inspected PNGs: 11 app states at configured 320, 390, 430, and 1440 px viewports. It includes class entry and the changed source-prompt, instructor-response, teacher-review, candidate, map, and revision views. The companion `/Users/milwright/.codex/visualizations/2026/08/08/019fe2ef-096c-7093-b898-9a6e64ef1b23/systems-mapping-app-all-views.zip` passed `unzip -t` without errors. All displayed classroom content is synthetic.

The current visual concept is `docs/concepts/preflight-teacher-review-spec-v1.png`. It is a design reference, not evidence that the running application matches it.

## Verified rendered journey

Use a disposable database and temporary teacher claim values, never the real handoff database:

1. Open the production build and enter class access.
2. Start or resume a project, add a source, and generate suggestions.
3. Confirm that **Review suggestions** shows no more than three short source prompts, no full model codification, and the runtime/retention disclosure; add a student note.
4. Submit a student note and confirm that the instructor has not responded yet.
5. Sign into the teacher dashboard, confirm **Model review details** starts collapsed, inspect the teacher-only criteria/scores, write one focus and one question, and select **Approve with a question**.
6. Return as the student, refresh the response, and verify the instructor focus/question without a memo or map rewrite.
7. Generate and decide candidates, enter the map, and continue to the revision stage.
8. Capture class entry and changed views at 320, 390, 430, and 1440 px and inspect for horizontal overflow.

This disposable journey passed. The deployed class-entry check separately passed with zero console warnings and correct rejection of `101`.

## Active-beta follow-up

- Exercise simple **Approve** and **Reject** in separate current rendered fixtures. Their automated contracts pass, but this browser journey used **Approve with a question**.
- Verify current reload restoration and export/import restoration in the rendered application.
- Extend current rendered receipts for map drag, keyboard movement, zoom/pan/fit, every annotation surface, and full focus traversal. Automated coverage remains green.
- The final loopback listener and real SQLite handoff database are healthy; the one pre-existing claimed teacher account/session was intentionally preserved rather than treated as QA residue.
- The current Railway release, health response, hardening headers, browser entry, and hosted `101` rejection are verified. A full teacher-review journey against deployed Railway/PostgreSQL remains useful beta coverage, not a blocker to the deterministic release.
- Local `.env` contains no Ollama key. The previously pasted key is exposed and must be revoked; no live provider run has occurred.
- Deterministic STEM Splitter does not interpret teacher prompt or project-instruction text. Its configuration snapshots are provenance only; prompt customization affects actual generation only when an accepted provider adapter is enabled.
- Hosted review stores memo/source material for the disclosed retention period. Institutional approval and operating policy remain separate from code correctness.

These follow-ups do not invalidate the published deterministic active beta. They limit the scope of rendered and optional-provider claims.

## Provenance caveat

The source authority remains as recorded in `docs/SOURCE_LEDGER.md`. The governing Drive specification, supplied wireframes, CALI materials, and direct user decisions inform the implementation. Zach's August 5 notes remain unconfirmed by Maria. Gmail review did not locate a Maria-specific Zoom summary, and the unrelated Chantale/Virginia meeting-assets summary is not treated as evidence of Maria's decisions.
