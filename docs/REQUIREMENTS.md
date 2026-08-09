# Systems Mapping — requirements

## Product contract

Systems Mapping turns a source-backed memo into one durable, revisable concept-and-resource graph. Students remain responsible for every claim and relationship. The system may point to evidence, identify uncertainty, propose a next action, and propose graph candidates; it must not silently rewrite the memo, change the graph, or promote an inference into confirmed state.

The interface is phone-primary and progressively disclosed. It uses descriptive stage names, modest editorial typography, black/white/gray as the dominant palette, and restrained tertiary accents whose meanings are repeated through labels, shapes, outlines, and line patterns.

## Seven-stage workflow

1. **Select scale** — select the current micro, meso, macro, or integration release. Releases operate on one graph and follow micro → meso → macro → integration.
2. **Source intake** — import DOCX/TXT/MD/HTML/JSON, record a PDF for separate OCR/text extraction, or paste memo text; record source ownership, location, rights, sensitivity, and consent information.
3. **Suggestion review** — request a server-authoritative evaluation; read the response under What the memo establishes, What the model suggests, and What remains uncertain; add an optional student annotation.
4. **Instructor response** — submit the already generated snapshot, wait for review, and explicitly refresh its status.
5. **Candidate review** — only after approval, generate and decide source-grounded node and relationship candidates.
6. **Map studio** — inspect, position, filter, and annotate the graph while preserving stable records and evidence.
7. **Revision and export** — record a reflection and export canonical JSON or human-readable CSV/Markdown.

No separate student-facing checklist or repair-lab stage is permitted. Internal criteria remain evaluator semantics, but student guidance must not lead with H/C identifiers, scores, `pass`, `8/8`, or `readiness checks`.

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

The machine contract requires every criterion to include its ID, `met`/`unmet` status, evidence, rationale, missing variable or `null`, next action, confidence, and hard-block state. All four hard criteria must be met. The scored threshold is six of eight. These fields support validation, instructor inspection, and provenance; the student surface reorganizes them as annotations.

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

The server, not the browser, chooses the current shared teacher configuration, executes the configured suggestion runtime, validates the exact H1–H4/C1–C8 schema, replaces timestamps/configuration metadata with authoritative values, and persists the record. The response contains `{evaluation}` with a random 192-bit ID, validated suggestion, sanitized configuration snapshot, runtime metadata, creation time, and expiry.

The submitted project overlay contains bounded configuration metadata and up to 16,000 characters of custom instructions. The server separates custom instructions before persistence. Fixed prompts, shared teacher prompt content, project custom-instruction text, and provider credentials must not be stored in or returned with the evaluation snapshot. The snapshot carries fingerprints, revisions, and module versions sufficient to identify what governed the run.

An unsubmitted evaluation expires after 1 day. It is bound to the student session that created it and may be consumed once.

## Instructor review gate

The browser submits only:

`POST /api/preflight/submissions`

```json
{
  "evaluationId": "<one-time capability>",
  "studentAnnotation": "..."
}
```

Within one transaction, the server must verify that the evaluation belongs to the current student session, is unexpired and unused, mark it consumed, and copy its authoritative project/source material, suggestion, configuration snapshot, and runtime metadata into a pending review snapshot. A student may not submit an alternative suggestion or configuration body.

The student status endpoint is `GET /api/preflight/submissions/:id`. The ID is a random bearer capability and a valid student class session is also required. The response must be limited to project ID, status, decision, revision/times, instructor annotation, and optional revised suggestion. It must not reveal memo/source content, prompt/configuration content, runtime internals beyond the student's stored run, or teacher identity. Every JSON/CSV/Markdown export must redact evaluation and review capabilities.

Pending review blocks candidate generation. Teacher decisions are:

- **Approve** — requires an instructor annotation and unlocks Candidate review.
- **Revise and approve** — requires both an instructor annotation and revised suggestion text, then unlocks Candidate review.
- **Reject** — requires an instructor annotation and returns the student to Source intake.

No decision may modify the student's memo, structured suggestion, candidates, or graph. Instructor prose is guidance. Decisions require an expected revision; stale or duplicate writes return a conflict. Each accepted decision appends an immutable event with teacher attribution and from/to revision.

## Teacher dashboard and configuration

The dashboard must default to **Review submissions**. Queue rows are minimal; only the selected submission loads its full detail. The review surface shows the memo, source context, student note, annotated suggestion groups, optional internal criterion detail, three decision controls, and compact decision history.

**Model guidance** is a secondary tab and must not load until selected. It exposes one module editor at a time over:

- preflight evaluator and graph builder;
- global, micro, meso, macro, and integration scopes;
- purpose, evidence, privacy, scale/readiness rubric, interaction, and output modules.

The database therefore retains 60 independently revisioned modules, but the interface must not present them simultaneously. An effective prompt composes immutable fixed guardrails, global modules, and active-scale modules. Every save requires a change note and expected revision; stale saves preserve the teacher's local draft until the current server revision is explicitly loaded.

Fresh databases seed separate unclaimed identities for Maria Mavrides Calderon and Zach Muhlbauer without credentials. Claiming requires an operator-controlled, one-time bootstrap token and an explicit account ID. Each server-process token may claim exactly one account. Passphrases must be salted and scrypt-derived; teacher sessions must be random, expiring, `HttpOnly`, and `SameSite=Strict`.

## Suggestion runtime modes

### Deterministic STEM Splitter

When Ollama is disabled, the server uses fixed, inspectable STEM Splitter rules. No memo content leaves the classroom server for a model provider. Teacher module changes and project instruction changes are preserved as provenance, but the deterministic evaluator does not interpret those prompts and they do not alter scoring. This is a bounded fallback and testing baseline, not a claim of live model execution.

### Ollama Cloud

Ollama Cloud must be enabled explicitly with `OLLAMA_ENABLED=true` and a fresh server-only `OLLAMA_API_KEY`. The only production base URL is `https://ollama.com`; model name, timeout, output-token count, request/response size, and response fields are bounded. The server sends:

- current effective teacher prompt;
- project custom instructions;
- active scale and inquiry;
- source metadata;
- memo/source text.

The source limit is 131,072 UTF-8 bytes and the inquiry limit is 8,192 UTF-8 bytes. The UI must disclose this egress before generation and name the runtime/model returned by the classroom server. A provider timeout, network/HTTP error, oversized response, malformed JSON, extra field, invalid criterion, or inconsistent outcome must fail closed with a generic 502 response. There is no silent deterministic fallback.

The key previously pasted into chat is exposed and must be revoked. Neither local nor Railway configuration is complete until a newly rotated key is set server-side and a separate live-provider acceptance run succeeds.

## Persistence and retention

### Browser project

The browser project is versioned and validated. It persists the current stage, source record, graph and candidate records, evidence, configuration metadata, local events, sharing tier, map positions, viewport, and node/relationship/map annotations. It does not create student identity or cross-device synchronization. Storage failure must keep the in-memory project usable and offer recovery export.

Pointer movement may use transient state, but only completed moves are committed. Annotation and viewport writes are debounced/batched. Legacy projects receive deterministic positions, a bounded default viewport, and stable annotation IDs.

### Classroom database

SQLite is the local persistence adapter; PostgreSQL is the hosted adapter. Both must implement the same accounts, sessions, prompt modules/history, bounded prototype events, preflight evaluations, review submissions, append-only review events, and retention-purge receipts.

- unsubmitted evaluation: 1 day;
- pending review snapshot: 30 days;
- approved/rejected snapshot: 180 days.

Retention deletes source-bearing review rows and their review events only through the guarded retention path. It retains an append-only receipt containing a one-way hash of the deleted submission ID, status/decision, purge time, and retention reason. Raw expired evaluations may be deleted without a separate audit row.

Prototype events may contain only approved event names, canonical stage numbers, and bounded numeric/boolean metadata. They must not contain memo text, labels, annotations, prompts, capabilities, or identity.

## Graph and export contract

Projects, sources, nodes, relationships, annotations, configurations, evaluations, review states, and events use stable IDs. Supported graph operations remain add, revise, merge, contest, retire, and create research lead. Unknown IDs, invalid references, unapproved relationship verbs, malformed geometry, excess collections, unknown schema fields, and credential-shaped data fail closed.

No candidate becomes confirmed without explicit student action unless the instructor configuration deliberately disables confirmation. Public/restricted exports preserve IDs and redaction manifests while removing protected source/derived text. All portable tiers remove review capabilities. CSV output must neutralize leading formula markers, control characters, and leading whitespace before spreadsheet consumption.

## Access, hosted mode, and Railway

Local mode binds only to `127.0.0.1`. Its initial server-side class code is `101`; the code opens a local class workspace and is not identity or strong authentication. Class access issues a separate 12-hour student cookie. Failed attempts are throttled, and a rare activity-log 401 must be confirmed against the current session before the client declares an otherwise valid grant expired.

Hosted mode requires all of the following:

- PostgreSQL `DATABASE_URL` and an HTTPS `PUBLIC_ORIGIN` configured together;
- explicit `HOST=0.0.0.0` or `HOST=::`;
- explicit bounded `TRUST_PROXY_HOPS`;
- a server-only 10–32 character class code with at least six distinct characters, never `101`;
- Secure teacher and student cookies;
- exact Host/Origin/fetch-site validation;
- bounded login, session issuance, evaluation, submission, queue, and concurrency limits.

Railway is the intended hosted target. Code-level PostgreSQL parity and hosted-mode tests establish readiness, but the release must not claim Railway delivery until a project/service/database exist, variables are set, migration/deployment reaches terminal success, and live health/auth/review behavior is read back.

## Privacy and security boundaries

- State-changing routes require exact same-origin requests; untrusted Host and proxy chains are rejected.
- Student class access never authorizes `/api/teacher/*`; teacher authentication does not disclose the seeded account roster publicly.
- Auth, session, teacher, evaluation, review, and other API responses are `no-store` and receive restrictive CSP, framing, referrer, permissions, nosniff, opener, and resource-policy headers.
- Request bodies, text fields, JSON depth/work, collections, rate windows, database pools, provider output, and retention work are bounded.
- SQL operations use prepared parameters and guarded transactions.
- Browser rendering uses React text/value paths; no HTML-injection sink is part of the intended UI contract.
- Sharing tiers are private, course, CUNY, and public; private is the default.
- The classroom database necessarily stores submitted memo/source material for instructor review during the disclosed retention period. Any hosted deployment therefore needs an institutional data-handling decision, not merely a passing technical test.

## Visual and accessibility constraints

- Use restrained serif headings, humanist sans controls, and monospace provenance; no oversized bold marketing copy.
- Keep black, white, and gray dominant. Use teal for micro/selection, amber for meso, plum for macro, and black for integration only in the legend and selected singular elements.
- Repeat scale hue with circle/square/diamond/double-circle shape. Repeat claim state with text plus solid/dash/dash-dot/open/faded line or outline patterns.
- Keep primary controls usable at 320–430 px widths, with no document-level horizontal overflow or occluded action.
- Use at least 44 px touch targets and at least 16 px editable text on phones where practical.
- Preserve visible focus, logical focus return, keyboard graph movement, roving tabs, Escape dismissal, reduced-motion behavior, forced-colors support, and live status for saves/movement.

## Acceptance gates

Automated acceptance requires the full UI/domain/server suite, the SQLite server suite, fresh PostgreSQL integration, production build, dependency audit, and static leakage scan. Rendered acceptance requires the complete student/teacher review loop and map persistence at desktop, 320, 390, and 430 px with inspected screenshots and no relevant console errors. Delivery acceptance additionally requires a clean real local database, private GitHub readback, Railway terminal success, live database/health/auth verification, and—if enabled—a separate Ollama Cloud run using a rotated key.

Passing deterministic tests, local PostgreSQL integration, or a production build must never be reported as proof of browser acceptance, Railway deployment, or live Ollama Cloud execution.

## Source authority

`docs/SOURCE_LEDGER.md` remains the authority record. The fuller Drive specification governs behavior; supplied local wireframes govern compatible presentation; CALI materials provide context; Zach's August 5 notes remain unconfirmed minutes; and STEM Splitter informs architecture. Direct user decisions supersede earlier naming and visual details, including the current Systems Mapping name, descriptive stages, editorial typography, and restrained tertiary accents within an otherwise monochrome system.
