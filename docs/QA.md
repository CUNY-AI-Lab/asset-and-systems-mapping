# Systems Mapping — QA and visual-fidelity report

Updated: 2026-08-09

## Current status

The evaluation/review overhaul is automated-test green, production-build green, GitHub-published, and Railway-deployed. It is **not yet fully rendered-browser accepted or live-Ollama verified**.

A current 390 CSS-pixel in-app-browser smoke verified the access screen at 390 px document width, a 44 px primary button, 16 px input text, no horizontal overflow, and rejected-code messaging. The full student/teacher/map journey and 320/430 px passes remain pending, so this report does not promote the smoke into complete rendered acceptance.

## Completed automated runs

| Gate | Current result | Scope |
| --- | --- | --- |
| Focused App/domain run | 67/67 passed | Seven stages, server evaluation envelope, review gate, runtime/retention disclosures, capability redaction, map persistence, exports, migrations, and validation. |
| `pnpm test:server` | 53 passed; 3 PostgreSQL-gated skipped | SQLite API/auth/config/evaluation/review/retention, hosted-mode contracts, Ollama adapter, and startup validation. |
| Fresh PostgreSQL 17 integration | 3/3 passed | Migration, teacher claim/auth, Secure student access, authoritative evaluation/one-time submission, decision, retention, and database close behavior. |
| Full `pnpm test` | 129 passed; 3 PostgreSQL-gated skipped | 9 passing files and 1 skipped file in the ordinary non-PostgreSQL run. |
| `pnpm build` | Passed | Production Vite build. |

The PostgreSQL skips in the ordinary suites are environment gates, not hidden failures; the same integration group passed separately against a fresh disposable PostgreSQL 17 database.

Final `pnpm audit` and `pnpm audit --prod` both reported no known vulnerabilities. A redacted full-tree Gitleaks scan examined about 3.97 MB and reported no leaks; the pasted Ollama credential fragments were also absent from the tree.

## Published release evidence

- Private GitHub repository: `CUNY-AI-Lab/systems-mapping`, `main` through commit `62a546e`.
- Railway project: `systems-mapping` (`ed729bd9-403b-46a6-a97c-99ad9a0294c8`) with web and PostgreSQL services.
- Railway deployment `f23a2cf0-6f4b-462f-b1e2-8a1c5e2bc7de` reached `SUCCESS` after a hosted-readiness regression was fixed and covered by 23 focused server tests.
- Public health readback: `https://web-production-08455.up.railway.app/api/health` returned `{"status":"ok"}`.
- The preserved local SQLite handoff store passed `PRAGMA integrity_check`; it contains no student sessions, evaluations, review submissions/events, or prototype events. One previously claimed teacher account and its existing session were retained as user-owned state.

## Automated behavior verified

### Student access and resume

- Class access is an asynchronous server exchange; rejected codes are not persisted.
- A valid student cookie restores the saved local stage and project summary.
- Invalid, throttled, expired, and unavailable-server states retain the local project.
- A prototype-logging 401 triggers a session recheck; it cannot expire a newer valid grant solely because an older request failed.
- Hosted runtime disclosure identifies course-server persistence, 1/30/180-day retention, and deterministic or Ollama provider behavior.

### Suggestion and instructor-review workflow

- The UI exposes exactly seven descriptive stages: Select scale → Source intake → Suggestion review → Instructor response → Candidate review → Map studio → Revision and export.
- The student suggestion surface displays What the memo establishes, What the model suggests, and What remains uncertain without showing H/C identifiers, pass labels, `8/8`, or readiness-check copy.
- Suggestion generation posts exact source/project input to the authoritative evaluation endpoint and accepts only the returned `{evaluation}` envelope.
- The request includes bounded project custom instructions but excludes the local fixed prompt. The returned configuration snapshot contains revisions/fingerprints/module versions, not teacher prompt text or custom-instruction text.
- Review submission sends exactly `{evaluationId, studentAnnotation}`; it cannot replace suggestion/configuration data.
- Pending review blocks candidate generation. Approve and revise-and-approve unlock it. Reject returns to Source intake without changing memo or graph records.
- A pending review resumes after class-session renewal using the locally held review capability. Portable copies cannot poll because capabilities are redacted.
- Ollama Cloud source/inquiry byte limits are checked in the client and server. Provider failures remain errors rather than deterministic fallbacks.

### Teacher dashboard

- The dashboard opens on a pending queue and does not load model modules/history until Model guidance is selected.
- One selected submission shows source text, inquiry, student annotation, three suggestion groups, and optional detailed criteria.
- Exactly three decisions are available. Every decision requires an instructor annotation; revised suggestion appears only for revise-and-approve.
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
| Descriptive stage names | Seven canonical labels replace Preflight checklist and Repair gate. | Automated DOM verified; rendered browser pending. |
| Annotation-guided suggestion review | Three evidence/guidance/uncertainty groups plus note for instructor; no student scorecard. | Automated DOM verified; rendered browser pending. |
| Progressive teacher dashboard | Review queue first; Model guidance secondary/lazy; one module editor. | Automated DOM verified; rendered browser pending. |
| Editorial typography | Modest serif headings, humanist controls, monospace provenance; no oversized display copy. | Source verified; rendered browser pending. |
| Monochrome-dominant palette | White/black/gray surfaces with restrained teal, amber, and plum accents. | Source verified; contrast/render pending. |
| Redundant legend | Micro/teal/circle; meso/amber/square; macro/plum/diamond; integration/black/double-circle; claim states repeated through text and line pattern. | DOM/source verified; rendered browser pending. |
| Phone-primary map | Safe-area chrome, internal canvas containment, phone inspector, 44/48 px controls, durable layout/viewport/annotations. | Automated behavior/source verified; final 320/390/430 geometry pending. |

## Screenshots and browser evidence

The existing screenshots under `/Users/milwright/.codex/visualizations/2026/08/08/019fe2ef-096c-7093-b898-9a6e64ef1b23/systems-mapping/` verify an earlier map-hardening build only. They predate the current Suggestion review, Instructor response, authoritative evaluation, and teacher review queue. They may guide comparison but are not current acceptance artifacts.

The current visual concept is `docs/concepts/preflight-teacher-review-spec-v1.png`. It is a design reference, not evidence that the running application matches it.

## Required rendered journey

Use a disposable database and temporary teacher claim values, never the real handoff database:

1. Open the production build and enter class access.
2. Start/resume a project, complete Source intake, and generate suggestions.
3. Inspect the three annotation groups and runtime/retention disclosure.
4. Submit a student note and confirm Instructor response remains pending.
5. Sign into the teacher dashboard, open the queue, and exercise approve, revise-and-approve, and reject on separate fixtures.
6. Return as the student, refresh each response, and verify the correct gate/return behavior.
7. Generate/decide candidates after approval; move and annotate the map; reload; export/import; confirm exact restoration.
8. Repeat at desktop, 320, 390, and 430 CSS px; record geometry, focus, touch target, console, and screenshot evidence.

## Remaining acceptance risks

- No current rendered proof exists for the new student/teacher review loop, phone geometry, focus behavior, or console cleanliness.
- Full rendered review/map acceptance and a dedicated final `dist/` string inventory remain pending; dependency and repository leak scans are green.
- The final loopback listener and real SQLite handoff database are healthy; the one pre-existing claimed teacher account/session was intentionally preserved rather than treated as QA residue.
- Railway creation, PostgreSQL migration, deployment, domain, and health readback are verified. Live browser review, cookie, and retention acceptance against Railway remain pending.
- Local `.env` contains no Ollama key. The previously pasted key is exposed and must be revoked; no live provider run has occurred.
- Deterministic STEM Splitter does not interpret teacher prompt or project-instruction text. Its configuration snapshots are provenance only; prompt customization affects actual generation only when an accepted provider adapter is enabled.
- Hosted review stores memo/source material for the disclosed retention period. Institutional approval and operating policy remain separate from code correctness.

## Provenance caveat

The source authority remains as recorded in `docs/SOURCE_LEDGER.md`. The governing Drive specification, supplied wireframes, CALI materials, and direct user decisions inform the implementation. Zach's August 5 notes remain unconfirmed by Maria. Gmail review did not locate a Maria-specific Zoom summary, and the unrelated Chantale/Virginia meeting-assets summary is not treated as evidence of Maria's decisions.
