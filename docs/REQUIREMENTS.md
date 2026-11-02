# Systems Mapping — requirements

Updated: 2026-10-28

The [October 28 Micro/Meso workflow](MICRO_MESO_WORKFLOW_2026-10-28.md) governs current classroom behavior. Micro identifies nodes; Meso adds directional relationships between the same nodes and retains their positions. This decision supersedes earlier descriptions of Micro arrows and a separate Meso region.

## Product contract

Systems Mapping develops one durable, revisable systems map from student-authored memos. Students remain responsible for every node and connection. The application may offer a bounded, memo-grounded review, but it must not score the student, silently rewrite the memo, change the graph, or add a suggestion without an explicit student decision.

The interface is phone-primary and progressively disclosed. It uses descriptive stage names, modest editorial typography, black/white/gray as the dominant palette, and restrained level accents repeated through plain labels and outlined swatches in the Map key.

## Five-stage learning cycle

- add your memo asks students to frame the focal person or group, inquiry question, time period, and map boundary, then upload one memo or paste its text and optionally name the map
- review your memo begins a new empty map with an explicit request for bounded, level-appropriate model guidance after a transfer disclosure; a valid response is required before initial manual additions, and no instructor-submission field is included
- choose map elements asks students to choose supported elements; Micro includes discrete nodes, while Meso includes relationships between those carried Micro nodes
- build map asks students to arrange and annotate selected elements; Micro arranges nodes, while Meso adds one-way or two-way arrows between those same nodes
- revise and export asks students to reconsider the current level, record what changed, and decide what can be shared; its current-level projection must not leak records from another level

These stages repeat around one persistent map. A new empty project requires a valid initial guidance response before map-building and Field Notes become available; that response may contain zero suggestions. Existing maps remain available for manual revision. Completing revise and export automatically advances Micro to Meso, Meso to Exosphere, and Exosphere to Macrosphere. Completing Macrosphere ends level progression at **Project complete**; it does not start another level cycle or wrap to Micro. Students may continue reviewing, revising, and exporting completed work. After the initial review, a student may add supported elements manually, revisit a memo, revise or remove suggestions, and navigate released levels. Part 1 groups Micro and Meso; Part 2 groups Exosphere and Macrosphere. The student response must contain no criterion identifiers, scores, thresholds, outcome labels, prompt text, guardrails, fingerprints, credentials, or provider-only fields.

The four student-facing analytical levels are **Micro-level**, **Meso-level**, **Exo-level**, and **Macro-level**; the stable internal IDs remain `micro`, `meso`, `exosphere`, and `macrosphere`. Placement is relational to the focal person or group and the pathway of effect, never determined by entity kind, organizational size, or fame. Micro-level identifies discrete people, groups, objects, resources, and immediate settings in which the focal person participates directly. A named organization, institution, agency, or service therefore remains at Micro-level when it is one of those immediate settings. Every Micro-level node label names one relevant element as a noun phrase; a whole clause or proposition must not become a node. Meso-level starts with the existing Micro-level nodes, preserving their IDs and positions, and adds relationships between them. A relationship names what happens between two nodes and records its direction and evidence. Exo-level identifies a concrete outside decision setting in which the focal person does not participate when a supported pathway from that setting changes an immediate Micro-level setting. Macro-level identifies broader laws, public policies, economic conditions, histories, structures, and cultural beliefs that pattern multiple parts of the map. A concrete institution must not be duplicated as a Macro-level condition.

Each graph record carries its analytical level. New level work appends to the same graph rather than replacing it. In the current-level revise-and-export projection, Micro displays its nodes; Meso adds relationships between those same nodes. A full project export remains cumulative and preserves the graph for recovery and reuse. Meso uses the same map space as Micro. Its arrows join carried Micro nodes, and students choose one-way or two-way direction. Exosphere and Macrosphere use visibly different concentric regions. Once more than one level is released, the map defaults to **All levels** so prior work remains visible. Students may then isolate one level. Filtering hides records without deleting or changing them. Positions, complete labels, evidence, annotations, and state persist when a level is hidden, when another level becomes current, and across export/import. Editing a memo marks guidance as ready to refresh; it does not remove candidates or existing map work.

Projects save first in the current browser. The Projects screen and link dialog must say plainly that device-only work can remain visible to another person who uses the same browser profile. A project link is optional and may include an optional student or group name; the name helps distinguish work but is not identity, authentication, or a progression requirement.

Creating a project link stores the complete serialized project on the class server, including its memo, map framing, accepted and set-aside suggestions, graph, evidence, annotations, revision history, and optional student or group name. The interface must disclose that full scope before creation. The unguessable link token is a bearer capability used together with current class access. Every link response carries an optimistic revision, last-sync time, and expiry. A client update must supply the revision it last read; a stale update returns a conflict and must never overwrite either copy silently. The student may reload the linked copy, keep the device copy and create a separate link, revoke future access, or delete the server copy. New links expire after the configured retention period; legacy links without an expiry remain explicitly identifiable as such until revoked, deleted, or migrated.

## Memo review contract

The runtime returns one bounded object with exactly `guidance`, `nodes`, `connections`, `example`, and `readiness`. Guidance points stay grounded in the memo and may include a short supporting excerpt. The response is descriptive rather than scored. Its validity satisfies the initial-review requirement; readiness is advisory and does not score the student.

Suggestions remain off the graph until the student makes an explicit decision. Candidate review and connection review display at most four suggestions at once, with controls for moving among groups. **Add to map** confirms a suggestion as student interpretation, **Set aside — needs evidence** preserves it as a research lead, and **Remove** leaves it off the live graph while preserving the review decision.

Level rules are strict:

- Micro returns discrete node suggestions and an empty connections array.
- Meso returns an empty nodes array and relationship candidates with two distinct exact carried Micro node IDs, a verb, and an evidence rationale. Accepted relationships use `scale: "meso"`. Student-facing prose uses readable node labels.
- Exosphere may return named outside decision settings only when each has a supported pathway to a carried Micro setting. Macrosphere returns broader-condition nodes with scopes and exactly zero connections.

The server fails closed on unsupported fields, invalid endpoints, duplicate records, over-limit text, and level-incompatible output. After the existing bounded correction attempts, if a completed review still fails on a specific map item, the server may return a feedback-only review: it independently validates the complete nonempty guidance array, omits all map suggestions and the model's readiness and example, and sets readiness to false. It records `runtime.feedbackOnly: true` and the interface explains that suggestions were not returned and can be requested again. Invalid guidance, unsupported quotations, malformed review envelopes, provider failures, timeouts, and cancellations do not qualify for this fallback. The feedback-only result supports manual work and must preserve existing map and candidate decisions; it is not a grade or a guarantee that the feedback's interpretation is correct. A student must still edit, add, set aside, or remove each valid suggestion before it changes the graph.

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

`sourceRecord` and `sourceMaterial` are compatibility API identifiers for memo details and memo text; they are not student-facing labels. The server, not the browser, chooses the current shared teacher configuration, executes the configured suggestion runtime, validates the level-specific output, replaces timestamps/configuration metadata with authoritative values, and persists the bounded evaluation for its configured lifetime. A Meso request provides the current Micro nodes with stable IDs so the model can connect existing items. The student response contains `{evaluation}` with exactly `id`, `review`, `configSnapshot`, `runtime`, `createdAt`, and `expiresAt`. `review` contains exactly `guidance`, `nodes`, `connections`, `example`, and `readiness`, bounded by the server contract. It must not contain criteria, scores, thresholds, outcome labels, provider output outside that allowlist, prompt text, credentials, or teacher-only fields.

The submitted project overlay contains bounded configuration metadata and up to 16,000 characters of custom instructions. The server separates custom instructions before persistence. Fixed prompts, shared teacher prompt content, project custom-instruction text, and provider credentials must not be stored in or returned with the evaluation snapshot. The snapshot carries fingerprints, revisions, and module versions sufficient to identify what governed the run.

An unsubmitted evaluation expires after 1 day. It is bound to the student session that created it and may be consumed once. The server must not enforce a course-wide maximum number of active evaluations. Request throttles and provider-concurrency limits remain. Per-session supersession behavior and retention purges are unchanged in this pass; redesigning either is deferred.

## Retained instructor-review API

The current student interface does not submit work to the Instructor Console and does not show a note, question, or review-status field. The following compatibility API remains for review records created by earlier releases and for bounded server-side review workflows; it is not a claim about the current student journey.

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

Teacher feedback communicates direction asynchronously for retained review records. A pending review, outstanding evaluation, or recorded decision must never prevent candidate generation, stage navigation, level changes, or map access. Instructor Console uses accessible action labels while the database and API retain stable internal decision IDs:

- **Add feedback** — records one instructor focus with internal decision ID `approve`.
- **Add feedback and a question** — records one instructor focus and one focused question with internal decision ID `revise_and_approve`.
- **Recommend another pass** — records one instructor focus with internal decision ID `reject`, without redirecting or rewriting the student's current stage.

No decision may modify the student's memo, guidance, candidates, current stage, or graph. The instructor writes one focus; a question is present only for **Add feedback and a question**. Decisions require an expected revision; stale or duplicate writes return a conflict. Each accepted decision appends an immutable event with teacher attribution, the internal decision ID, and from/to revision.

## Instructor Console and course settings

The Instructor Console must default to **Review submissions** so retained records remain accessible. Queue rows are minimal; only the selected submission loads its full detail. The instructor form exposes one **Focus for the student** and the compatible review actions. This retained queue must not be described as the destination of new work from the current student interface.

**Course settings** must not load until selected. Settings are shared by Part and section: one saved guidance/material pair applies to both levels in that Part. Compact controls show one Part and one section at a time instead of rendering every choice and field together. Course settings are not stored separately for Micro versus Meso or for Exosphere versus Macrosphere.

At Micro, the model and interface propose discrete nodes with supporting evidence. At Meso, those Micro node IDs carry forward and the model may suggest relationships between them. Students can also select two nodes to add their own supported connection and direction. Every model suggestion begins as **Suggested** and remains off the graph until the student explicitly chooses **Add to map**. **Set aside — needs evidence** preserves a suggestion as a research lead, and **Remove** leaves it out of the live map without erasing its review record. Editing a model suggestion does not convert its origin into student interpretation; explicit acceptance does. Course settings may require evidence before acceptance but may never auto-confirm suggestions. Exosphere and Macrosphere guidance may shape sphere membership, outside decision pathways, policies, beliefs, and structural interpretation under their level-specific contracts.

- **What guidance should students receive in this section?** accepts up to 2,500 characters of instructor guidance.
- **What course material should support this section?** accepts up to 4,000 characters of pasted course material. The prompt must mark this field as reference content and must state that it cannot override fixed rules.

The effective prompt must include only the current Part-and-section guidance and supporting material. It must not accumulate prose from another section. The student evaluation request must name the canonical stage ID, and the server must reject unknown IDs while migrating the former instructor-response ID into the combined **review your memo** stage.

One published version governs new evaluations. A teacher may clone the published or an earlier version into a draft, edit Part-and-section settings, save a revision with a change note, preview the saved settings, and publish it. **Preview level** supplies runtime context for the preview only; changing it does not create or select a separate saved configuration. The preview response and Instructor Console show only the saved instructor guidance and course material plus their Part, section, contextual level, and revision. They must never expose the full effective prompt, code-owned guardrails, configuration fingerprints, or internal modules. Published and earlier versions are read-only. Publishing retires the former version and records append-only events for both records. Expected revisions prevent stale writes and preserve unsaved text until the teacher explicitly loads the server revision.

The internal preflight and graph-builder rules remain code-owned. The Instructor Console and its API must not expose the internal configuration matrix as instructor-editable records. The deterministic runtime records the published configuration as provenance but does not interpret instructor prose. Ollama Cloud composes the current Part-and-section guidance and course material into the provider prompt. The Console must state the active runtime effect before a teacher edits or publishes a draft.

Fresh databases seed separate unclaimed identities for Maria Mavrides Calderon and Zach Muhlbauer without credentials. Claiming requires an operator-controlled, one-time bootstrap token and an explicit account ID. Each server-process token may claim exactly one account. Passphrases must be salted and scrypt-derived; teacher sessions must be random, expiring, `HttpOnly`, and `SameSite=Strict`.

## Suggestion runtime modes

### Deterministic evaluator

When Ollama is disabled, the server uses fixed, inspectable evaluation rules. No memo content leaves the classroom server for a model provider. Changes to teacher and project instructions are recorded, but the deterministic evaluator does not interpret them. At Micro, deterministic output contains discrete nodes and an empty connections array. At Meso, it may propose relationships using exact carried Micro node IDs and returns an empty nodes array. The student receives the same bounded memo-review shape described above; internal configuration and persistence fields remain server-side. This is a bounded fallback and testing baseline, not a claim of live model execution.

### Ollama Cloud

Ollama Cloud must be enabled explicitly with `OLLAMA_ENABLED=true` and a fresh server-only `OLLAMA_API_KEY`. The only production base URL is `https://ollama.com`; model name, timeout, output-token count, request/response size, and response fields are bounded. The server sends:

- current effective teacher prompt;
- project custom instructions;
- active level and inquiry;
- existing Micro node IDs and labels when Meso needs relationship suggestions;
- memo details;
- complete saved memo text, including inline citations and bibliography; provider reading copies omit confidently recognized reference lists, retain uncertain content and later narrative, and disclose the omission in context;
- bounded reading context that identifies likely reference sections without rewriting the memo.

Memo text is limited to 131,072 UTF-8 bytes and the inquiry to 8,192 UTF-8 bytes. The UI must disclose this transfer before generation and name the runtime/model returned by the classroom server. Completed invalid model output may receive the bounded corrections described in `CITATION_GUIDANCE_RECOVERY_2026-10-28.md`; a complete review must pass atomic validation, and an eligible feedback-only review must separately pass the same guidance checks. The direct Ollama adapter returns a generic generation failure after unsuccessful correction when no feedback-only result qualifies. Hosted Gateway responses preserve safe distinctions for timeout, quota, and explicitly retryable availability refusals. Timeout, cancellation, and ambiguous transport failures require a deliberate new request. Deterministic mode remains an explicitly configured runtime.

The historical direct-Ollama setup required replacing a key pasted into chat and a separate live-provider acceptance run. That receipt is separate from the current owning-Gateway helper and temporary credential procedure; current acceptance must identify the tested model, source snapshot, and runtime boundary.

## Persistence and retention

### Browser project

The browser project is versioned and validated. It persists the optional student/group name, current stage, memo text and privacy choices, graph and candidate records, active and completed levels, sphere membership, evidence, configuration details, local events, sharing tier, map positions, viewport, and node, relationship, and map annotations. It must not persist Instructor Console-only review data as current student project state. The optional name does not create verified identity or cross-device synchronization. Storage failure must keep the in-memory project usable and offer recovery export.

Pointer movement may use transient state, but only completed moves are committed. Annotation and viewport writes are debounced/batched. Legacy projects receive deterministic positions, a bounded default viewport, and stable annotation IDs.

### Classroom database

SQLite is the local persistence adapter; PostgreSQL is the hosted adapter. Both must implement the same accounts, sessions, course profiles, append-only profile events, bounded prototype events, preflight evaluations, review submissions, append-only review events, and retention-purge receipts. Code-owned base configuration may remain internally normalized for prompt composition, but it is not an instructor customization surface.

- unsubmitted evaluation: 1 day;
- pending review snapshot: 30 days;
- approved/rejected snapshot: 180 days.

Retention deletes review rows that contain memo text and their review events only through the guarded retention path. It retains an append-only receipt containing a one-way hash of the deleted submission ID, status or decision, purge time, and retention reason. Raw expired evaluations may be deleted without a separate audit row. This reversion does not change retention purges or per-session supersession behavior.

Prototype events may contain only approved event names, canonical stage numbers, and bounded numeric/boolean metadata. They must not contain memo text, labels, annotations, prompts, capabilities, or identity.

Student-workflow evaluation uses the closed `workflow_observed` event and exactly five categorical fields: task code, completion outcome, classification explanation, revision quality, and recovery outcome. SQLite and PostgreSQL must validate the same allowlists. Teacher reporting returns aggregate counts overall and by task, classification explanation, revision quality, and recovery outcome. It must not expose row-level observations, sessions, timestamps, memo text, map labels, annotations, prompts, capabilities, or identity.

## Graph and export contract

Browser project schema v8 validates projects, memos, nodes, relationships, spheres, annotations, configurations, evaluations, review states, and events with stable IDs. Supported v1–v7 projects migrate to v8 while retaining graph records, evidence, IDs, positions, annotations, and decisions. Meso relationships connect two distinct, live Micro nodes. Earlier Micro relationships move to Meso with their original fields and status preserved; Meso becomes available when needed to view them. The active work level remains unchanged. Legacy scoped Meso nodes remain available in List and private exports, while new Meso work uses relationship arrows over the existing Micro arrangement. Guidance generated under an incompatible earlier contract is refreshed separately from saved graph work. Existing `macro` records migrate deterministically to `exosphere`; existing `integration` records migrate to `macrosphere`, except named institutions incorrectly stored there, which move to Exosphere. Supported graph operations remain add, revise, merge, contest, retire, and create research lead. Invalid references, malformed geometry, excess collections, unknown schema fields, and credential-shaped data fail validation; the Exosphere and Macrosphere vocabulary restrictions remain in force.

Each level has independent `stage` and `reflection` values in `levelProgress`. Switching among released levels saves the current values and restores the target level's values. Completing a level records stage 4 for that level; completing Macro-level leaves the project at stage 4 with **Project complete** disabled as a terminal action. Cumulative graph records and prior decisions remain available throughout.

Each node and connection has additive `claimEvidence` records. Every record keeps memo passage or evidence, student interpretation, reasoning, uncertainty, counterevidence, and missing perspective separate, while retaining available evidence IDs and locators. Meso and Exo-level connections also support `relationshipProcess` with frequency, duration, direction, conditions, and change over time. Optional assignment details add strength, channel, connecting work, a nonnegative integer family count or null, and observed/missing/unknown connection status. Model details require narrative support; percentages and counts of children remain in prose. Exo pathways may connect named outside offices to each other as intermediate funding or decision steps. Canonical export/import preserves these records, subject to the selected sharing tier's redactions.

Micro nodes record `focalParticipation` as direct, indirect, unclear, or not applicable. A non-setting Micro item may list one or more immediate Micro setting IDs in `settingNodeIds`; a setting cannot list itself or another membership. Setting membership remains distinct from the `scopeNodeIds` retained on legacy Meso records. Changing a Micro setting to a non-setting type or removing a node is blocked while active scopes, memberships, or relationships depend on it. The interface must name the dependent work and require explicit repair or removal; it must not cascade, filter, delete, or reclassify dependent records silently.

Valid model candidates always begin pending with model-suggestion provenance. They become confirmed student interpretations only after the student chooses **Add to map**; no course or project setting may silently confirm, reclassify, delete, or move them. **Set aside — needs evidence** preserves model origin and the review decision without adding the item to the graph. Public/restricted exports preserve IDs and redaction manifests while removing protected memo and derived text. All portable tiers remove review capabilities. CSV output must neutralize leading formula markers, control characters, and leading whitespace before spreadsheet consumption and must preserve the IDs and readable labels in every Meso or Macrosphere scope.

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

Public-demo mode changes only the shared student entry code. It does not grant Instructor Console access, identify students, relax origin/cookie controls, remove rate and queue limits, or change retention.

PR [#9](https://github.com/CUNY-AI-Lab/systems-mapping/pull/9) merged the last deployed ecological implementation into `main` at `7f6444147d34a4c62203eb1a3943fcfd6c3f4491`. Railway deployment `51a03b7e-6752-4681-8714-5bbf6106d843` reached `SUCCESS` from that clean commit and passed migration, health, access, student-to-teacher API denial, configuration, logout, header, exact-bundle, provider, and no-5xx readback. It predates the 2026-08-24 Micro/Meso correction and is historical evidence for the superseded contract. PR #5 and deployment `39d38543-20ca-4626-95e6-237ef9213881` remain historical evidence for the preceding Macro/Integration implementation.

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
- Identify levels with plain labels and simple swatches. Micro displays its nodes. Meso displays directional relationships between those same nodes in the same map space, with complete relationship labels. Exosphere and Macrosphere use distinct concentric regions that contain graph elements and remain filterable.
- Keep node and connection labels above lines and separate from icons. Never truncate them or reduce them to illegible auto-fit sizes. Hidden levels must not mutate stored records.
- Give the map materially more screen area. Keep pointer panning available after opening a record, add arrow-key panning when the canvas is focused, expose a reversible CSS full-screen mode, and permit zoom down to `0.15` without silently imposing a larger floor.
- Keep primary controls usable at 320–430 px widths, with no document-level horizontal overflow or occluded action.
- Use at least 44 px touch targets and at least 16 px editable text on phones where practical.
- Preserve visible focus, logical focus return, keyboard graph movement, roving tabs, Escape dismissal, reduced-motion behavior, forced-colors support, and live status for saves/movement.

## Acceptance gates

Automated acceptance requires the full UI/domain/server suite, SQLite server suite, fresh PostgreSQL integration, production build, dependency audit, and static leakage scan. It must prove that Micro returns and displays nodes only; node labels identify discrete elements; Meso receives and reuses existing Micro node IDs; Meso relationships resolve two live endpoints and preserve their selected direction; completion advances Micro to Meso to Exosphere to Macrosphere and then ends at **Project complete**; schema v8 round-trips evidence, relationship process, participation, setting membership, and per-level progress; dependency repair blocks silent cascades; bounded suggestion groups remain navigable; progressed maps default to **All levels**; privacy-bounded workflow observations aggregate without exposing content or identity; full-screen, persistent pointer pan, keyboard pan, and `0.15` zoom remain available; old Macro and Integration data migrate without loss; an optional student/group name round-trips; level filtering does not mutate the graph; compact Instructor Console controls use the four current names; and multiple outstanding evaluations do not hit a course-wide maximum. Per-session supersession and retention tests should remain unchanged in this pass.

Rendered acceptance requires direct map access from every stage; the ordered level transition; Micro nodes; Meso relationship arrows and labels between those same nodes; Exosphere and Macrosphere concentric regions; reversible full-screen; pointer and keyboard panning; extended zoom-out; filterable levels; complete readable labels; the compact Instructor Console; and map persistence at desktop, 320, 390, and 430 px with source-built browser screenshots and no relevant console errors. Delivery acceptance additionally requires private GitHub readback, a Railway deployment of the changed tree, live database/health/auth/review verification, and—if enabled—a separate Ollama Cloud run using a rotated key.

Passing deterministic tests, local PostgreSQL integration, or a production build must never be reported as proof of browser acceptance, Railway deployment, or live Ollama Cloud execution.

The 171-test run, build, browser captures, PR #5 receipt, and Railway deployment recorded on or before 2026-08-17 remain historical baselines. The 2026-08-22 map-interaction candidate recorded 242 passing tests with 4 explicitly guarded PostgreSQL skips; a build that emitted `index-BJBuN6w3.js`, `TeacherDashboard-DPrpmbM0.js`, and `index-BZOzcHy4.css`; and a passing `git diff --check`. Its browser run verified the now-superseded node-only Micro and generic-edge Meso behavior. Those receipts remain provenance only and do not establish the current October 28 Micro/Meso contract. The fresh PostgreSQL, dependency-audit, leakage, publication, deployment, and provider receipts in the following paragraphs likewise apply to the 2026-08-21 ecological release.

An earlier isolated browser cycle showed that the clause “Adult Participants face delays when the Accessible Van Program is unavailable” produced the discrete nodes `Adult Participants` and `Accessible Van Program`. Its zero-relationship result belongs to the superseded Micro contract. The useful retained assertion is that the whole clause did not become a node.

Historical rendered acceptance is recorded in `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ecological-cycle-qa-2026-08-21/systems-mapping-ecological-cycle-qa-2026-08-21.zip` (SHA-256 `89f959144d0257a0a21d6440f7be3a37e50925f60adc7dd1687caeb246277c11`). Its 40 true PNGs cover all 15 states at desktop and 390 px plus five map/Teacher states each at 320 and 430 px; 4 fabricated memos and 4 metadata/assertion files accompany them. Strict checks found no truncation, overlap, overflow, console errors, or captured success toasts and recorded Micro 6/0, exact-ID Meso carry-forward, cumulative 21/19, and Instructor Console after authentication. No credentials are packaged. The archive does not establish the corrected Micro/Meso behavior.

Historical delivery acceptance is recorded: PR #9 is merged on GitHub `main`; Railway deployment `51a03b7e-6752-4681-8714-5bbf6106d843` reached `SUCCESS`; live migration, health, public access, student-to-teacher denial, Instructor Console route, configuration, logout, headers, exact bundle hashes, and zero HTTP 5xx passed. Fabricated East Harlem memos produced schema-valid live `ollama-cloud` reviews for the now-superseded Micro 7/0 and Meso 0/6 contract, plus Exosphere 11/5 and Macrosphere 8/1. No production teacher credential or provider secret was exposed. Provider-key rotation provenance remains an operator confirmation outside this historical acceptance.

## Source authority

`docs/SOURCE_LEDGER.md` remains the authority record. The October 28 request recorded in `docs/MICRO_MESO_WORKFLOW_2026-10-28.md` governs the Micro/Meso boundary. The August 24 correction is retained as historical migration context. The Maria and Zach Zoom material supplied on 2026-08-21 continues to govern the four level names, their order, and the compatible ecological-layer design. The fuller Drive specification governs compatible general behavior; local wireframes govern compatible presentation; CALI materials provide context; and Zach's August 5 notes remain unconfirmed minutes.

## Field Notes by scale — October 19, 2026

Notebook uses one Field Notes response for each of Micro, Meso, Exo, and Macro. A nonblank response is required before completing a scale; moving between Map and Notebook remains available. The selected default prompts ask what the student noticed while mapping the current scale and which nodes could help begin the next scale.

The instructor publishes a question for each scale from Course settings. These questions are independent of the five internal mapping steps. Older profiles use the default scale questions; older student answers retain their exact text. Published question changes never replace student answers. The current autosave journal and per-scale storage remain in use. Historical draft recovery is a separate proposal in `field-notes-recovery-proposal.md`.

At Micro, Meso, and Exo, the two default questions appear in one paragraph above the existing response field. The project and profile contracts currently store one note and one question string per scale; this change adds no answer fields and does not parse or split previously saved notes. Macro asks only what the student noticed and retains the existing final review/export step. Meso connects existing Micro nodes with directional relationships. Macro still scopes existing map items. Exact defaults from either earlier question set advance to the selected wording through the existing profile migration and cached-profile lookup. Instructor-authored replacements and historical profile events remain unchanged.

Completing a level saves its full Field Notes before the next level's existing memo review begins. That review receives the immediately preceding level's shared response to both prompts, separate from the unchanged source memo and evidence. Generation instructions distinguish student observations, open questions and planned investigations from sourced facts, and ask for a useful addition, clarification or evidence-gathering question under the next scale's existing rules. The memo-review panel shows this context in a disclosure. Earlier notes remain available under **Field Notes → Notes from other scales**. Writing notes, opening the archive, and moving between completed levels make no model request; the continuation uses the existing review call. Guidance reuse includes the submitted note excerpt and contract version, so edited context or revised instructions require a fresh response.

The saved note retains its existing 64,000-character limit. The context sent with guidance is at most 2,048 UTF-8 bytes including its JSON fields and escaping. Longer notes use an opening excerpt, explicitly identified in Field Notes and the memo-review panel. The provider's existing 16 KiB limit applies to all combined source metadata; an oversized request receives a clear rejection before using the guidance allowance. The excerpt does not replace the saved note or enter the source record or instructor review snapshot. Provider failure leaves the saved note and cumulative map available for an explicit retry.

Generated guidance's optional `evidenceExcerpt` must quote the supplied memo. `shared/memo-quote-match.js` grades each quotation: `exact` when the excerpt occurs after whitespace and Unicode NFC normalization only; `normalized` when it occurs once quote marks, dashes, ellipses, case and non-breaking spaces are canonicalized on both sides, as Word memos and model quoting habits require; `elided` when one or more retained fragments of at least four characters occur in memo order, separated or surrounded by `...` or `[...]` omission markers. Any other excerpt, including paraphrase, reordered fragments and a passage from Field Notes that is absent from the memo, rejects the entire response before a review is stored, and the Gateway failure names only the schema path `guidance[n].evidenceExcerpt`. The stored excerpt is always the model's wording; a `normalized` or `elided` grade is recorded as `evidenceMatch` on that guidance item for instructors and provenance, while an `exact` quotation carries no marker. Students are not asked to resolve matching: when a response fails the contract, the server issues one corrective retry to the model on every provider, including the CAIL Gateway, with the quotation rule in the feedback, records `correctiveRetries` in the successful evaluation's runtime metadata or the returned failure's safe details (also retained in durable job outcomes), and fails closed only when the retry also fails. Cancellation may prevent a result receipt; the count is not a provider billing ledger. This check verifies quotation provenance; it does not establish the truth of a model's interpretation or paraphrase. New automatic map suggestions remain pending inferences until the student reviews them.


## Memo import and progress repairs — October 25, 2026

A pending memo import is scoped to its project, source record, account/access generation and intake visit. A later file selection or memo edit invalidates it, even when an edit is subsequently reverted. Navigation or account change prevents a late reader from changing another project. Success is announced only after the corresponding import event is committed; empty/error results do not replace an existing memo.

The Instructor Console displays non-exact quotation grades beside unchanged excerpts. Matching tests the contiguous canonical passage before interpreting ellipses as omissions, including leading/trailing omissions; unsupported and reordered text still fails. Progress labels reflect explicit request status or say “Generating guidance”; elapsed time alone never claims quotation checking or a corrective attempt. The bar remains approximate and never completes before a result.

## Contextual wording edits — October 26, 2026

Selected-node labels and selected-edge relationships use explicit **Save** and **Cancel** controls in the existing contextual Notebook details. Candidate Details use the same draft controls. Save trims and validates wording; Enter saves and Escape cancels. Blur and selection changes never commit drafts.

Node labels retain the existing Micro, Meso, Exo, and Macro validation rules and 200-character limit. New relationships are Meso or Exo records, with a 100-character limit and the existing Exo decision-path vocabulary. Earlier Micro relationship records remain readable for compatibility and move to Meso during legacy migration. Wording edits synchronize corresponding graph and candidate records and refresh relationship endpoint labels without changing record IDs, endpoints, evidence, annotations, origin, review state, memo, Field Notes, or saved layout. Records match by identity, scale, and endpoints, with an unambiguous fallback for candidates whose IDs changed when added to the map. A graph-only manual or accepted Ask connection remains editable without creating a candidate copy.

Text Save does not request arrangement or camera fitting. Cards may resize to display their wording. Explicit Arrange, Fit, and node movement use current measurements. The workspace remains **Map / Notebook**.


## Citation-aware guidance and recovery — October 28, 2026

The complete submitted memo remains unchanged through storage and provider transport. Derived source boundaries identify likely reference lists and inline author-year citations. They are reading aids rather than a replacement memo. Citation-bearing prose remains eligible evidence. Bibliography-only authors, publishers, and titles do not become scene participants, and a reference entry alone does not support a mapped relationship. A cited person remains eligible when the narrative separately describes their role.

The model receives the original text and bounded section locations. Output validation applies the same distinction to pasted text and PDF-extracted text. A completed invalid response receives one ordinary corrective attempt. If that completed correction still fails source grounding, a distinct final repair receives at most six exact narrative passages selected across the memo, and every proposed node or connection in that repair requires a narrative quotation as evidence. Unsupported output is rejected atomically except for the independently validated feedback-only fallback described in the memo review contract. All calls share the original generation budget (25 seconds for ordinary requests or the existing 85 seconds for verified durable jobs) and normal provider admission; timeout, quota, cancellation, ambiguous transport failure, and repeated generic schema errors do not trigger evidence repair.

Runtime metadata records `correctiveRetries` and optional `evidenceRepairAttempts`. These counts remain available on successful guidance and safe failure details, including after reload. The original memo, graph, citations, and Field Notes remain intact. The current/alternate live model comparison is an explicit acceptance step; deterministic tests do not establish live reasoning quality. See `docs/CITATION_GUIDANCE_RECOVERY_2026-10-28.md`.


Existing relationship context sent to subsequent memo guidance, connection suggestions, and Map Check carries bounded process details, including reverse or two-way direction and explicitly missing status. Student-choice descriptions use the same direction-aware wording. Optional unknown model fields normalize to empty text or `unknown`, and explicit arrow synonyms normalize to the canonical directions; arbitrary values remain invalid. These transformations preserve complete source text and evidence passages.
