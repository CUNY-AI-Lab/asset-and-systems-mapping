# Systems Mapping — requirements

Updated: 2026-08-13

## Product contract

Systems Mapping develops one durable, revisable concept-and-resource map from assigned, published, institutional, public, and scholarly sources. Student interpretation remains visibly secondary to the source evidence. Students remain responsible for every claim and relationship. They may receive at most three short questions that return them to specific passages in the source. The system must not show the student its criterion taxonomy, scores, outcome, or full model review; silently rewrite the source; change the graph; or promote an inference into confirmed state.

The interface is phone-primary and progressively disclosed. It uses descriptive stage names, modest editorial typography, black/white/gray as the dominant palette, and restrained tertiary accents whose meanings are repeated through labels, shapes, outlines, and line patterns.

## Five-stage learning cycle

- choose a scale and add a source asks students to set the current scale, add a source, and record the details needed to use it in the map
- review source with your instructor asks students to identify what the evidence supports, what remains uncertain, and what they want to ask their instructor
- choose nodes and describe connections asks students to choose supported elements, describe how they connect, and decide which model suggestions to keep
- build map asks students to arrange, connect, and annotate selected elements while linking each claim to evidence
- revise and export asks students to reconsider their claims, record what changed, and decide what can be shared

These stages form a repeatable cycle around one persistent map, not a one-way sequence. Every stage and the map remain available throughout the project. A student may open an empty map, add supported elements manually, revisit a source, request or ignore guidance, check an instructor response, or begin another scale without waiting for approval. Part 1 groups Micro and Meso; Part 2 groups Macro and Integration. These parts organize course work without adding stages or replacing scale-specific map layers. Internal criteria remain evaluator and teacher-review semantics only. The student response must contain no H/C identifiers, criterion labels or statuses, scores, thresholds, outcome labels, rationales, missing-variable fields, full evaluation codification, or synthesized model-review groups.

Each node and relationship carries its analytical scale. New cycles append to the same graph rather than replacing it. The map opens with all active scale layers visible and supports combined or individual micro, meso, macro, and integration views. Positions, evidence, annotations, and claim state persist when layers are hidden, when another scale becomes current, and across export/import. Editing a source retires only graph records tied to that source fingerprint and current scale; earlier scale layers remain intact.

## Internal suggestion semantics

The suggestion evaluator returns four hard criteria and eight scored criteria:

- H1 source integrity
- H2 sensitivity and consent
- H3 evidence ownership
- H4 minimum relational content
- C1 bounded inquiry
- C2 actor specificity
- C3 relational statements
- C4 scale fit
- C5 interpretive warrant
- C6 tension or contradiction
- C7 assets and capacity
- C8 uncertainty

The machine contract requires every criterion to include its ID, `met`/`unmet` status, evidence, rationale, missing variable or `null`, next action, confidence, and hard-block state. All four hard criteria must be met. The scored threshold is six of eight. These fields support server validation and record keeping. The Teacher Console must not present the model score, threshold, outcome, or criterion IDs as an instructional judgment. Its collapsed **Review details** groups evidence excerpts, possible follow-up, and open questions so the instructor performs the pedagogical interpretation.

The server derives the student projection from the authoritative result. It contains zero to three records with exactly:

```json
{
  "action": "Return to a specific source question.",
  "evidenceExcerpt": "Optional short passage from the source."
}
```

`action` is required and limited to 500 characters. `evidenceExcerpt` is optional and limited to 280 characters. Any extra field or fourth prompt is invalid. The projection may direct attention or ask for clarification, but it must not supply a conclusion, score, model rationale, or model taxonomy.

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

The server, not the browser, chooses the current shared teacher configuration, executes the configured suggestion runtime, validates the exact H1–H4/C1–C8 schema, replaces timestamps/configuration metadata with authoritative values, persists the full result for teacher review, and derives the bounded student prompts. The student response contains `{evaluation}` with exactly `id`, `redirects`, `configSnapshot`, `runtime`, `createdAt`, and `expiresAt`. It must not contain the full suggestion, criteria, score, threshold, or outcome.

The submitted project overlay contains bounded configuration metadata and up to 16,000 characters of custom instructions. The server separates custom instructions before persistence. Fixed prompts, shared teacher prompt content, project custom-instruction text, and provider credentials must not be stored in or returned with the evaluation snapshot. The snapshot carries fingerprints, revisions, and module versions sufficient to identify what governed the run.

An unsubmitted evaluation expires after 1 day. It is bound to the student session that created it and may be consumed once.

## Asynchronous instructor review

The browser submits only:

`POST /api/preflight/submissions`

```json
{
  "evaluationId": "<one-time capability>",
  "studentAnnotation": "..."
}
```

Within one transaction, the server must verify that the evaluation belongs to the current student session, is unexpired and unused, mark it consumed, and copy its authoritative project details, source, suggestion, configuration snapshot, and runtime metadata into a pending review snapshot. A student may not submit an alternative suggestion or configuration body.

The student status endpoint is `GET /api/preflight/submissions/:id`. The ID is a random bearer capability and a valid student class session is also required. The response must be limited to project ID, status, decision, revision/times, the instructor's focus, and an optional focused question. It must not reveal source content, full criteria or scores, prompt/configuration content, teacher identity, or teacher-only model-review detail. Every JSON/CSV/Markdown export must redact evaluation and review capabilities.

Teacher feedback communicates direction asynchronously. A pending review or recorded decision must never prevent candidate generation, stage navigation, scale changes, or map access. Teacher Console uses accessible action labels while the database and API retain stable internal decision IDs:

- **Add feedback** — records one instructor focus with internal decision ID `approve`.
- **Add feedback and a question** — records one instructor focus and one focused question with internal decision ID `revise_and_approve`.
- **Recommend another pass** — records one instructor focus with internal decision ID `reject`, without redirecting or rewriting the student's current stage.

No decision may modify the student's source, guidance, candidates, current stage, or graph. The instructor writes one focus; a question is present only for **Add feedback and a question**. Decisions require an expected revision; stale or duplicate writes return a conflict. Each accepted decision appends an immutable event with teacher attribution, the internal decision ID, and from/to revision.

## Teacher Console and course settings

The Teacher Console must default to **Review submissions**. Queue rows are minimal; only the selected submission loads its full detail. The review surface shows the source, its identifying details, and the student note. **Review details** is collapsed by default and groups evidence excerpts, possible follow-up, and open questions without model scores, thresholds, outcomes, or criterion identifiers. The instructor form exposes one **Focus for the student**, the actions **Add feedback**, **Add feedback and a question**, and **Recommend another pass**, and one **Question for the student** only after **Add feedback and a question** is selected. Decision history records the same focus and optional question and renders the user-facing label while persistence retains the internal decision ID.

**Course settings** must not load until selected. It must present the same five stages as the student cycle and let the teacher open one stage at a time.

Within the node-selection stage, the student must describe how the chosen nodes relate. A language model may suggest relationships only among the supplied nodes. Every suggestion must remain editable and must require an explicit student decision before it is added to the map. Current Teacher Console guidance for that stage must shape the request without applying a connection automatically.

- **What guidance should students receive in this section?** accepts up to 2,500 characters of instructor guidance.
- **What course material should support this section?** accepts up to 4,000 characters of pasted course material. The prompt must mark this field as reference content and must state that it cannot override fixed rules.

The effective prompt must include only the current stage's instructor guidance and supporting material. It must not accumulate earlier or later stage prose. The student evaluation request must name the canonical stage ID, and the server must reject unknown IDs while migrating the former instructor-response ID into the combined source-review stage.

One published version governs new evaluations. A teacher may clone the published or an earlier version into a draft, edit stages, save a revision with a change note, preview the saved prompt by stage and scale, and publish it. Published and earlier versions are read-only. Publishing retires the former version and records append-only events for both records. Expected revisions prevent stale writes and preserve unsaved text until the teacher explicitly loads the server revision.

The internal preflight and graph-builder rules remain code-owned. The Teacher Console and its API must not expose the internal configuration matrix as instructor-editable records. The deterministic evaluator records the published fingerprint, revision, and stage but does not interpret instructor prose or change its fixed scoring. Ollama Cloud composes the current stage guidance and course material into the provider prompt. The Console must state the active runtime effect before a teacher edits or publishes a draft.

Fresh databases seed separate unclaimed identities for Maria Mavrides Calderon and Zach Muhlbauer without credentials. Claiming requires an operator-controlled, one-time bootstrap token and an explicit account ID. Each server-process token may claim exactly one account. Passphrases must be salted and scrypt-derived; teacher sessions must be random, expiring, `HttpOnly`, and `SameSite=Strict`.

## Suggestion runtime modes

### Deterministic evaluator

When Ollama is disabled, the server uses fixed, inspectable evaluation rules. No source content leaves the classroom server for a model provider. Changes to teacher and project instructions are recorded, but the deterministic evaluator does not interpret them and they do not alter scoring. The student still receives only a bounded set of questions tied to the source; full deterministic codification remains teacher-only. This is a bounded fallback and testing baseline, not a claim of live model execution.

### Ollama Cloud

Ollama Cloud must be enabled explicitly with `OLLAMA_ENABLED=true` and a fresh server-only `OLLAMA_API_KEY`. The only production base URL is `https://ollama.com`; model name, timeout, output-token count, request/response size, and response fields are bounded. The server sends:

- current effective teacher prompt;
- project custom instructions;
- active scale and inquiry;
- source details;
- source text.

The source limit is 131,072 UTF-8 bytes and the inquiry limit is 8,192 UTF-8 bytes. The UI must disclose this egress before generation and name the runtime/model returned by the classroom server. A provider timeout, network/HTTP error, oversized response, malformed JSON, extra field, invalid criterion, or inconsistent outcome must fail closed with a generic 502 response. There is no silent deterministic fallback.

The key previously pasted into chat is exposed and must be revoked. Neither local nor Railway configuration is complete until a newly rotated key is set server-side and a separate live-provider acceptance run succeeds.

## Persistence and retention

### Browser project

The browser project is versioned and validated. It persists the current stage, source details, zero to three questions, graph and candidate records, active and completed scales, evidence, configuration details, local events, sharing tier, map positions, viewport, and node, relationship, and map annotations. It must not persist the teacher-only criteria or score as student project state. It does not create student identity or cross-device synchronization. Storage failure must keep the in-memory project usable and offer recovery export.

Pointer movement may use transient state, but only completed moves are committed. Annotation and viewport writes are debounced/batched. Legacy projects receive deterministic positions, a bounded default viewport, and stable annotation IDs.

### Classroom database

SQLite is the local persistence adapter; PostgreSQL is the hosted adapter. Both must implement the same accounts, sessions, course profiles, append-only profile events, bounded prototype events, preflight evaluations, review submissions, append-only review events, and retention-purge receipts. Code-owned base configuration may remain internally normalized for prompt composition, but it is not an instructor customization surface.

- unsubmitted evaluation: 1 day;
- pending review snapshot: 30 days;
- approved/rejected snapshot: 180 days.

Retention deletes review rows that contain source text and their review events only through the guarded retention path. It retains an append-only receipt containing a one-way hash of the deleted submission ID, status or decision, purge time, and retention reason. Raw expired evaluations may be deleted without a separate audit row.

Prototype events may contain only approved event names, canonical stage numbers, and bounded numeric/boolean metadata. They must not contain source text, labels, annotations, prompts, capabilities, or identity.

## Graph and export contract

Projects, sources, nodes, relationships, annotations, configurations, evaluations, review states, and events use stable IDs. Supported graph operations remain add, revise, merge, contest, retire, and create research lead. Unknown IDs, invalid references, unapproved relationship verbs, malformed geometry, excess collections, unknown schema fields, and credential-shaped data fail closed.

No candidate becomes confirmed without explicit student action unless the instructor configuration deliberately disables confirmation. Public/restricted exports preserve IDs and redaction manifests while removing protected source/derived text. All portable tiers remove review capabilities. CSV output must neutralize leading formula markers, control characters, and leading whitespace before spreadsheet consumption.

## Access, hosted mode, and Railway

Local mode binds only to `127.0.0.1`. Its initial server-side class code is `101`; the code opens a local class workspace and is not identity or strong authentication. Class access issues a separate 12-hour student cookie. Failed attempts are throttled, and a rare activity-log 401 must be confirmed against the current session before the client declares an otherwise valid grant expired.

Hosted mode requires all of the following:

- PostgreSQL `DATABASE_URL` and an HTTPS `PUBLIC_ORIGIN` configured together;
- explicit `HOST=0.0.0.0` or `HOST=::`;
- explicit bounded `TRUST_PROXY_HOPS`;
- either a server-only 10–32 character private-course code with at least six distinct characters or the explicit public-demo pair `SYSTEMS_MAPPING_PUBLIC_DEMO=true` and `SYSTEMS_MAPPING_CLASS_CODE=101`;
- Secure teacher and student cookies;
- exact Host/Origin/fetch-site validation;
- bounded login, session issuance, evaluation, submission, queue, and concurrency limits.

Public-demo mode changes only the shared student entry code. It does not grant Teacher Console access, identify students, relax origin/cookie controls, remove rate and queue limits, or change retention.

Current working-directory snapshot deployment `3ea599f4-7fb5-4dd3-998d-c55134a69f15` reached `SUCCESS` at `https://web-production-08455.up.railway.app`. Live checks verified health, the application root, public-demo code `101`, session and configuration readback, logout, requested interface text, and no 5xx responses. This verifies current Railway behavior, but the snapshot was deployed before its exact tree was committed. GitHub `main` therefore remains behind the current Railway snapshot until a reconciliation branch captures the tested tree, incorporates current `origin/main`, passes release checks, and supplies a commit-backed redeployment. A complete live Teacher Console review remains follow-up, and Ollama remains disabled.

## Privacy and security boundaries

- State-changing routes require exact same-origin requests; untrusted Host and proxy chains are rejected.
- Student class access never authorizes `/api/teacher/*`; teacher authentication does not disclose the seeded account roster publicly.
- Auth, session, teacher, evaluation, review, and other API responses are `no-store` and receive restrictive CSP, framing, referrer, permissions, nosniff, opener, and resource-policy headers.
- Request bodies, text fields, JSON depth/work, collections, rate windows, database pools, provider output, and retention work are bounded.
- SQL operations use prepared parameters and guarded transactions.
- Browser rendering uses React text/value paths; no HTML-injection sink is part of the intended UI contract.
- Sharing tiers are private, course, CUNY, and public; private is the default.
- The classroom database necessarily stores submitted source excerpts for instructor review during the disclosed retention period. Any hosted deployment therefore needs an institutional data-handling decision, not merely a passing technical test.

## Visual and accessibility constraints

- Use restrained serif headings, humanist sans controls, and monospace provenance; no oversized bold marketing copy.
- Keep black, white, and gray dominant. Use teal for micro/selection, amber for meso, plum for macro, and black for integration only in the legend and selected singular elements.
- Repeat scale hue with circle/square/diamond/double-circle shape. Repeat claim state with text plus solid/dash/dash-dot/open/faded line or outline patterns.
- Keep primary controls usable at 320–430 px widths, with no document-level horizontal overflow or occluded action.
- Use at least 44 px touch targets and at least 16 px editable text on phones where practical.
- Preserve visible focus, logical focus return, keyboard graph movement, roving tabs, Escape dismissal, reduced-motion behavior, forced-colors support, and live status for saves/movement.

## Acceptance gates

Automated acceptance requires the full UI/domain/server suite, the SQLite server suite, fresh PostgreSQL integration, production build, dependency audit, and static leakage scan. Rendered acceptance requires direct map access from every stage, pending-review continuation, empty-map entry, multi-scale layer combination, scale-specific source retirement, the student/teacher review loop, and map persistence at desktop, 320, 390, and 430 px with inspected screenshots and no relevant console errors. Delivery acceptance additionally requires private GitHub readback, a Railway deployment of the changed tree, live database/health/auth/review verification, and—if enabled—a separate Ollama Cloud run using a rotated key.

Passing deterministic tests, local PostgreSQL integration, or a production build must never be reported as proof of browser acceptance, Railway deployment, or live Ollama Cloud execution.

Current evidence as of 2026-08-13 is 160 passing tests with 3 PostgreSQL integration tests skipped, a passing production build, current desktop/mobile rendered captures, and the verified Railway snapshot described above. Delivery provenance remains incomplete until GitHub contains the reconciled tree and Railway is redeployed from that commit. This evidence does not claim a complete live Teacher Console review or a live Ollama Cloud request.

## Source authority

`docs/SOURCE_LEDGER.md` remains the authority record. The fuller Drive specification governs behavior; supplied local wireframes govern compatible presentation; CALI materials provide context; and Zach's August 5 notes remain unconfirmed minutes. Direct user decisions supersede earlier naming and visual details, including the current Systems Mapping name, descriptive stages, editorial typography, and restrained tertiary accents within an otherwise monochrome system.
