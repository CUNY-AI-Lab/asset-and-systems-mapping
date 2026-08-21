# Systems Mapping — requirements

Updated: 2026-08-21

## Product contract

Systems Mapping develops one durable, revisable systems map from student-authored memos. Students remain responsible for every node and connection. The application may offer a bounded, memo-grounded review, but it must not score the student, silently rewrite the memo, change the graph, or add a suggestion without an explicit student decision.

The interface is phone-primary and progressively disclosed. It uses descriptive stage names, modest editorial typography, black/white/gray as the dominant palette, and restrained level accents repeated through plain labels and outlined swatches in the Map key.

## Five-stage learning cycle

- add your memo asks students to choose a level, upload a memo or paste its text, and optionally name the map
- review your memo reads the current memo and presents bounded guidance plus level-appropriate suggestions; it does not include an instructor-submission field
- choose nodes and describe connections asks students to choose supported elements; Micro shows node choices only, while Meso is the first level that asks students to describe and review connections
- build map asks students to arrange and annotate selected elements; Micro remains node-only, while Meso and later levels also let students work with reviewed connections
- revise and export asks students to reconsider their claims, record what changed, and decide what can be shared

These stages form a repeatable cycle around one persistent map, not a one-way sequence. Every stage and the map remain available throughout the project. A student may open an empty map, add supported elements manually, revisit a memo, request or ignore guidance, or begin another level without waiting for approval. Part 1 groups Micro and Meso; Part 2 groups Exosphere and Macrosphere. The student response must contain no criterion identifiers, scores, thresholds, outcome labels, prompt text, guardrails, fingerprints, credentials, or provider-only fields.

The four analytical levels are Micro, Meso, Exosphere, and Macrosphere. Micro generates nodes only and must return zero relationships. Meso starts with the existing Micro nodes, preserving their stable IDs, and first introduces connections among them. It must not duplicate a carried node merely because the node appears in another memo or cycle. Exosphere replaces the former Macro level. Macrosphere replaces the former Integration level.

Each graph record carries its analytical level. New cycles append to the same graph rather than replacing it. Exosphere and Macrosphere use visibly different concentric regions that contain nodes and connections. The map supports all available regions together or one level at a time. Filtering hides records without deleting or changing them. Positions, complete labels, evidence, annotations, and state persist when a level is hidden, when another level becomes current, and across export/import. Editing a memo marks guidance as ready to refresh; it does not remove candidates or existing map work.

Project links may include an optional student or group name. The name helps an instructor identify work but is not identity, authentication, or a progression requirement.

## Memo review contract

The runtime returns one bounded object with exactly `guidance`, `nodes`, `connections`, `example`, and `readiness`. Guidance points stay grounded in the memo and may include a short supporting excerpt. The response is descriptive rather than scored and never gates progress.

Level rules are strict:

- Micro returns node suggestions and exactly zero connections; its example is `null`.
- Meso returns no new nodes. It receives the exact carried Micro node IDs and may return connections only between those IDs. Student-facing prose uses the readable node labels rather than exposing IDs.
- Exosphere and Macrosphere may return nodes and connections for their ecological regions.

The server rejects or removes unsupported fields, invalid endpoints, duplicate records, over-limit text, and level-incompatible output. A student must still edit, accept, or reject each suggestion before it changes the graph.

## Server-authoritative evaluation

An authenticated student requests an evaluation with:

`POST /api/preflight/evaluations`

```json
{
  "projectMetadata": {},
  "activeScale": "micro",
  "inquiry": "...",
  "sourceRecord": {},
  "sourceMaterial": "...",
  "projectOverlay": {}
}
```

`sourceRecord` and `sourceMaterial` are compatibility API identifiers for memo details and memo text; they are not student-facing labels. The server, not the browser, chooses the current shared teacher configuration, executes the configured suggestion runtime, validates the level-specific output, replaces timestamps/configuration metadata with authoritative values, and persists the bounded evaluation for its configured lifetime. A Meso request must also provide the current Micro nodes with stable IDs so the model connects existing records instead of inventing copies. The student response contains `{evaluation}` with exactly `id`, `review`, `configSnapshot`, `runtime`, `createdAt`, and `expiresAt`. `review` contains exactly `guidance`, `nodes`, `connections`, `example`, and `readiness`, bounded by the server contract. It must not contain criteria, scores, thresholds, outcome labels, provider output outside that allowlist, prompt text, credentials, or teacher-only fields.

The submitted project overlay contains bounded configuration metadata and up to 16,000 characters of custom instructions. The server separates custom instructions before persistence. Fixed prompts, shared teacher prompt content, project custom-instruction text, and provider credentials must not be stored in or returned with the evaluation snapshot. The snapshot carries fingerprints, revisions, and module versions sufficient to identify what governed the run.

An unsubmitted evaluation expires after 1 day. It is bound to the student session that created it and may be consumed once. The server must not enforce a course-wide maximum number of active evaluations. Request throttles and provider-concurrency limits remain. Per-session supersession behavior and retention purges are unchanged in this pass; redesigning either is deferred.

## Retained instructor-review API

The current student interface does not submit work to the Teacher Console and does not show a note, question, or review-status field. The following compatibility API remains for review records created by earlier releases and for bounded server-side review workflows; it is not a claim about the current student journey.

When the retained submission API is used, the browser submits only:

`POST /api/preflight/submissions`

```json
{
  "evaluationId": "<one-time capability>",
  "studentAnnotation": "..."
}
```

Within one transaction, the server must verify that the evaluation belongs to the current student session, is unexpired and unused, mark it consumed, and copy its authoritative project details, memo, suggestion, configuration snapshot, and runtime metadata into a pending review snapshot. A student may not submit an alternative suggestion or configuration body.

The student status endpoint is `GET /api/preflight/submissions/:id`. The ID is a random bearer capability and a valid student class session is also required. The response must be limited to project ID, status, decision, revision/times, the instructor's focus, and an optional focused question. It must not reveal memo content, full criteria or scores, prompt/configuration content, teacher identity, or teacher-only model-review detail. Every JSON/CSV/Markdown export must redact evaluation and review capabilities.

Teacher feedback communicates direction asynchronously for retained review records. A pending review, outstanding evaluation, or recorded decision must never prevent candidate generation, stage navigation, level changes, or map access. Teacher Console uses accessible action labels while the database and API retain stable internal decision IDs:

- **Add feedback** — records one instructor focus with internal decision ID `approve`.
- **Add feedback and a question** — records one instructor focus and one focused question with internal decision ID `revise_and_approve`.
- **Recommend another pass** — records one instructor focus with internal decision ID `reject`, without redirecting or rewriting the student's current stage.

No decision may modify the student's memo, guidance, candidates, current stage, or graph. The instructor writes one focus; a question is present only for **Add feedback and a question**. Decisions require an expected revision; stale or duplicate writes return a conflict. Each accepted decision appends an immutable event with teacher attribution, the internal decision ID, and from/to revision.

## Teacher Console and course settings

The Teacher Console must default to **Review submissions** so retained records remain accessible. Queue rows are minimal; only the selected submission loads its full detail. The instructor form exposes one **Focus for the student** and the compatible review actions. This retained queue must not be described as the destination of new work from the current student interface.

**Course settings** must not load until selected. Settings are shared by Part and section: one saved guidance/material pair applies to both levels in that Part. Compact controls show one Part and one section at a time instead of rendering every choice and field together. Course settings are not stored separately for Micro versus Meso or for Exosphere versus Macrosphere.

At Micro, the model and interface propose nodes only. Neither default guidance nor teacher guidance may ask for or return a relationship. At Meso, the same Micro node IDs carry forward and the language model may suggest relationships only among supplied nodes. Every suggestion remains editable and requires an explicit student decision before it is added to the map. Exosphere and Macrosphere guidance may shape sphere membership, cross-sphere relationships, policies, beliefs, and structural interpretation without adding anything automatically.

- **What guidance should students receive in this section?** accepts up to 2,500 characters of instructor guidance.
- **What course material should support this section?** accepts up to 4,000 characters of pasted course material. The prompt must mark this field as reference content and must state that it cannot override fixed rules.

The effective prompt must include only the current Part-and-section guidance and supporting material. It must not accumulate prose from another section. The student evaluation request must name the canonical stage ID, and the server must reject unknown IDs while migrating the former instructor-response ID into the combined **review your memo** stage.

One published version governs new evaluations. A teacher may clone the published or an earlier version into a draft, edit Part-and-section settings, save a revision with a change note, preview the saved settings, and publish it. **Preview level** supplies runtime context for the preview only; changing it does not create or select a separate saved configuration. The preview response and Teacher Console show only the saved instructor guidance and course material plus their Part, section, contextual level, and revision. They must never expose the full effective prompt, code-owned guardrails, configuration fingerprints, or internal modules. Published and earlier versions are read-only. Publishing retires the former version and records append-only events for both records. Expected revisions prevent stale writes and preserve unsaved text until the teacher explicitly loads the server revision.

The internal preflight and graph-builder rules remain code-owned. The Teacher Console and its API must not expose the internal configuration matrix as instructor-editable records. The deterministic runtime records the published configuration as provenance but does not interpret instructor prose. Ollama Cloud composes the current Part-and-section guidance and course material into the provider prompt. The Console must state the active runtime effect before a teacher edits or publishes a draft.

Fresh databases seed separate unclaimed identities for Maria Mavrides Calderon and Zach Muhlbauer without credentials. Claiming requires an operator-controlled, one-time bootstrap token and an explicit account ID. Each server-process token may claim exactly one account. Passphrases must be salted and scrypt-derived; teacher sessions must be random, expiring, `HttpOnly`, and `SameSite=Strict`.

## Suggestion runtime modes

### Deterministic evaluator

When Ollama is disabled, the server uses fixed, inspectable evaluation rules. No memo content leaves the classroom server for a model provider. Changes to teacher and project instructions are recorded, but the deterministic evaluator does not interpret them. At Micro, deterministic output contains nodes and zero connections. At Meso and later levels, it may recognize only direct relationships in the memo. The student receives the same bounded memo-review shape described above; internal configuration and persistence fields remain server-side. This is a bounded fallback and testing baseline, not a claim of live model execution.

### Ollama Cloud

Ollama Cloud must be enabled explicitly with `OLLAMA_ENABLED=true` and a fresh server-only `OLLAMA_API_KEY`. The only production base URL is `https://ollama.com`; model name, timeout, output-token count, request/response size, and response fields are bounded. The server sends:

- current effective teacher prompt;
- project custom instructions;
- active level and inquiry;
- existing Micro node IDs and labels when Meso needs connection suggestions;
- memo details;
- memo text.

Memo text is limited to 131,072 UTF-8 bytes and the inquiry to 8,192 UTF-8 bytes. The UI must disclose this transfer before generation and name the runtime/model returned by the classroom server. A provider timeout, network/HTTP error, oversized response, malformed JSON, extra field, or level-incompatible result must fail closed with a generic 502 response. There is no silent deterministic fallback.

The key previously pasted into chat is exposed and must be revoked. Neither local nor Railway configuration is complete until a newly rotated key is set server-side and a separate live-provider acceptance run succeeds.

## Persistence and retention

### Browser project

The browser project is versioned and validated. It persists the optional student/group name, current stage, memo text and privacy choices, graph and candidate records, active and completed levels, sphere membership, evidence, configuration details, local events, sharing tier, map positions, viewport, and node, relationship, and map annotations. It must not persist Teacher Console-only review data as current student project state. The optional name does not create verified identity or cross-device synchronization. Storage failure must keep the in-memory project usable and offer recovery export.

Pointer movement may use transient state, but only completed moves are committed. Annotation and viewport writes are debounced/batched. Legacy projects receive deterministic positions, a bounded default viewport, and stable annotation IDs.

### Classroom database

SQLite is the local persistence adapter; PostgreSQL is the hosted adapter. Both must implement the same accounts, sessions, course profiles, append-only profile events, bounded prototype events, preflight evaluations, review submissions, append-only review events, and retention-purge receipts. Code-owned base configuration may remain internally normalized for prompt composition, but it is not an instructor customization surface.

- unsubmitted evaluation: 1 day;
- pending review snapshot: 30 days;
- approved/rejected snapshot: 180 days.

Retention deletes review rows that contain memo text and their review events only through the guarded retention path. It retains an append-only receipt containing a one-way hash of the deleted submission ID, status or decision, purge time, and retention reason. Raw expired evaluations may be deleted without a separate audit row. This reversion does not change retention purges or per-session supersession behavior.

Prototype events may contain only approved event names, canonical stage numbers, and bounded numeric/boolean metadata. They must not contain memo text, labels, annotations, prompts, capabilities, or identity.

## Graph and export contract

Projects, memos, nodes, relationships, spheres, annotations, configurations, evaluations, review states, and events use stable IDs. Existing `macro` records migrate deterministically to `exosphere`; existing `integration` records migrate to `macrosphere`. The migration covers nodes, relationships, current and completed levels, configuration, and export/import without dropping graph data. Supported graph operations remain add, revise, merge, contest, retire, and create research lead. Unknown IDs, invalid references, unapproved relationship verbs, malformed geometry, excess collections, unknown schema fields, and credential-shaped data fail closed.

No candidate becomes confirmed without explicit student action. Public/restricted exports preserve IDs and redaction manifests while removing protected memo and derived text. All portable tiers remove review capabilities. CSV output must neutralize leading formula markers, control characters, and leading whitespace before spreadsheet consumption.

## Access, hosted mode, and Railway

Local mode binds only to `127.0.0.1`. Its initial server-side class code is `101`; the code opens a local class workspace and is not identity or strong authentication. Class access issues a separate 12-hour student cookie. Failed attempts are throttled, and a rare activity-log 401 must be confirmed against the current session before the client declares an otherwise valid grant expired.

Hosted mode requires all of the following:

- PostgreSQL `DATABASE_URL` and an HTTPS `PUBLIC_ORIGIN` configured together;
- explicit `HOST=0.0.0.0` or `HOST=::`;
- explicit bounded `TRUST_PROXY_HOPS`;
- either a server-only 10–32 character private-course code with at least six distinct characters or the explicit public-demo pair `SYSTEMS_MAPPING_PUBLIC_DEMO=true` and `SYSTEMS_MAPPING_CLASS_CODE=101`;
- Secure teacher and student cookies;
- exact Host/Origin/fetch-site validation;
- bounded login and session issuance, request rates, provider concurrency, and submission queues, without a course-wide ceiling on outstanding evaluations.

Public-demo mode changes only the shared student entry code. It does not grant Teacher Console access, identify students, relax origin/cookie controls, remove rate and queue limits, or change retention.

PR [#5](https://github.com/CUNY-AI-Lab/systems-mapping/pull/5) and Railway deployment `39d38543-20ca-4626-95e6-237ef9213881` are historical evidence for the preceding Macro/Integration implementation. They do not verify this Micro/Meso/Exosphere/Macrosphere candidate. A fresh deployment and live readback are required before any current-runtime claim.

## Privacy and security boundaries

- State-changing routes require exact same-origin requests; untrusted Host and proxy chains are rejected.
- Student class access never authorizes `/api/teacher/*`; teacher authentication does not disclose the seeded account roster publicly.
- Auth, session, teacher, evaluation, review, and other API responses are `no-store` and receive restrictive CSP, framing, referrer, permissions, nosniff, opener, and resource-policy headers.
- Request bodies, text fields, JSON depth/work, collections, rate windows, database pools, provider output, and retention work are bounded.
- SQL operations use prepared parameters and guarded transactions.
- Browser rendering uses React text/value paths; no HTML-injection sink is part of the intended UI contract.
- Sharing tiers are private, course, CUNY, and public; private is the default.
- The retained instructor-review API stores submitted memo excerpts for its disclosed retention period when that API is used. The current student interface does not create those submissions. Any hosted use of the retained review path therefore needs an institutional data-handling decision, not merely a passing technical test.

## Visual and accessibility constraints

- Use restrained serif headings, humanist sans controls, and monospace provenance; no oversized bold marketing copy.
- Keep black, white, and gray dominant. Use restrained accents to distinguish Micro, Meso, Exosphere, and Macrosphere only where the distinction is useful.
- Identify levels with plain labels and simple swatches. Micro displays nodes without relationship lines. Meso displays the carried nodes and their first connections. Exosphere and Macrosphere use distinct concentric regions that contain graph elements and remain filterable.
- Keep node and connection labels above lines and separate from icons. Never truncate them or reduce them to illegible auto-fit sizes. Hidden levels must not mutate stored records.
- Keep primary controls usable at 320–430 px widths, with no document-level horizontal overflow or occluded action.
- Use at least 44 px touch targets and at least 16 px editable text on phones where practical.
- Preserve visible focus, logical focus return, keyboard graph movement, roving tabs, Escape dismissal, reduced-motion behavior, forced-colors support, and live status for saves/movement.

## Acceptance gates

Automated acceptance requires the full UI/domain/server suite, SQLite server suite, fresh PostgreSQL integration, production build, dependency audit, and static leakage scan. It must prove that Micro returns zero relationships; Meso receives and reuses Micro node IDs; old Macro and Integration data migrate without loss; an optional student/group name round-trips; level filtering does not mutate the graph; compact Teacher Console controls use the four current names; and multiple outstanding evaluations do not hit a course-wide maximum. Per-session supersession and retention tests should remain unchanged in this pass.

Rendered acceptance requires direct map access from every stage, Micro node-only output, Meso connections among carried nodes, Exosphere and Macrosphere concentric regions, filterable levels, complete readable labels, the compact Teacher Console, and map persistence at desktop, 320, 390, and 430 px with inspected screenshots and no relevant console errors. Delivery acceptance additionally requires private GitHub readback, a Railway deployment of the changed tree, live database/health/auth/review verification, and—if enabled—a separate Ollama Cloud run using a rotated key.

Passing deterministic tests, local PostgreSQL integration, or a production build must never be reported as proof of browser acceptance, Railway deployment, or live Ollama Cloud execution.

The 171-test run, build, browser captures, PR #5 receipt, and Railway deployment recorded on or before 2026-08-17 remain historical baselines. Current local acceptance for the 2026-08-21 candidate is now recorded separately: 227 ordinary tests passed with 4 explicitly guarded PostgreSQL skips; a fresh native PostgreSQL 17.5 loopback run passed 4/4 tests including populated v8→v9 migration; the production build emitted `index-DKxOo_cS.js`, `TeacherDashboard-CO55RhLk.js`, and `index-CisvqIv_.css`; the production dependency audit reported no known vulnerabilities; gitleaks found no secret in the dirty diff or three intended untracked documentation/concept files; and `git diff --check` passed.

Rendered acceptance is recorded in `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ecological-cycle-qa-2026-08-21/systems-mapping-ecological-cycle-qa-2026-08-21.zip` (SHA-256 `89f959144d0257a0a21d6440f7be3a37e50925f60adc7dd1687caeb246277c11`). Its 40 true PNGs cover all 15 states at desktop and 390 px plus five map/Teacher states each at 320 and 430 px; 4 fabricated memos and 4 metadata/assertion files accompany them. Strict checks found no truncation, overlap, overflow, console errors, or captured success toasts and recorded Micro 6/0, exact-ID Meso carry-forward, cumulative 21/19, and Teacher Console after authentication. No credentials are packaged.

Delivery acceptance remains pending: the changed tree must be committed and pushed to GitHub `main`, deployed to Railway, and read back through the live database, health, access, Teacher Console, configuration, logout, header, bundle, and log checks. Live-provider acceptance remains separate and pending unless an authorized rotated key is enabled.

## Source authority

`docs/SOURCE_LEDGER.md` remains the authority record. The Maria and Zach Zoom material supplied on 2026-08-21 governs the current analytical progression and ecological-layer design. The fuller Drive specification governs compatible general behavior; local wireframes govern compatible presentation; CALI materials provide context; and Zach's August 5 notes remain unconfirmed minutes.
