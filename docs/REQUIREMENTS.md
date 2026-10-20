# Systems Mapping — requirements

Updated: 2026-08-28

## Product contract

Systems Mapping develops one durable, revisable systems map from student-authored memos. Students remain responsible for every node and connection. The application may offer a bounded, memo-grounded review, but it must not score the student, silently rewrite the memo, change the graph, or add a suggestion without an explicit student decision.

The interface is phone-primary and progressively disclosed. It uses descriptive stage names, modest editorial typography, black/white/gray as the dominant palette, and restrained level accents repeated through plain labels and outlined swatches in the Map key.

## Five-stage learning cycle

- add your memo asks students to frame the focal person or group, inquiry question, time period, and map boundary, then upload one memo or paste its text and optionally name the map
- review your memo lets students request bounded, level-appropriate model guidance after a transfer disclosure or continue without model guidance; it never requests the model automatically and does not include an instructor-submission field
- choose map elements asks students to choose supported elements; Micro includes discrete elements and their direct relationships, while Meso includes named linkages among carried Micro settings
- build map asks students to arrange and annotate selected elements; Micro keeps its direct relationship verbs, while Meso uses noun-labeled setting linkages without generic relationship edges
- revise and export asks students to reconsider the current level, record what changed, and decide what can be shared; its current-level projection must not leak records from another level

These stages repeat around one persistent map, not as a gated one-way sequence. Every stage and the map remain available throughout the project. Completing revise and export automatically advances Micro to Meso, Meso to Exosphere, and Exosphere to Macrosphere. Completing Macrosphere ends level progression at **Project complete**; it does not start another level cycle or wrap to Micro. Students may continue reviewing, revising, and exporting completed work. A student may open an empty map, add supported elements manually, revisit a memo, request or ignore guidance, or begin another released level without waiting for approval. Part 1 groups Micro and Meso; Part 2 groups Exosphere and Macrosphere. The student response must contain no criterion identifiers, scores, thresholds, outcome labels, prompt text, guardrails, fingerprints, credentials, or provider-only fields.

The four student-facing analytical levels are **Micro-level**, **Meso-level**, **Exo-level**, and **Macro-level**; the stable internal IDs remain `micro`, `meso`, `exosphere`, and `macrosphere`. Placement is relational to the focal person or group and the pathway of effect, never determined by entity kind, organizational size, or fame. Micro-level identifies discrete people, groups, objects, resources, and immediate settings in which the focal person participates directly. A named organization, institution, agency, or service therefore remains at Micro-level when it is one of those immediate settings. Every Micro-level node label names one relevant element as a noun phrase; a whole clause or proposition must not become a node. Micro-level also records direct relationships among those elements, and the connection wording remains there. Meso-level starts with eligible Micro-level settings, preserving their stable IDs, and names linkages across at least two of those settings. A Meso-level linkage is a noun phrase with a setting scope, not a generic relationship edge or verb. It must not duplicate a carried setting merely because that setting appears in another memo or cycle. Exo-level identifies a concrete outside decision setting in which the focal person does not participate when a supported pathway from that setting changes an immediate Micro-level setting. Macro-level identifies broader laws, public policies, economic conditions, histories, structures, and cultural beliefs that pattern multiple parts of the map. A concrete institution must not be duplicated as a Macro-level condition.

Each graph record carries its analytical level. New level work appends to the same graph rather than replacing it. In the current-level revise-and-export projection, Micro contains its nodes and direct relationships but excludes records assigned to later levels. A full project export remains cumulative and preserves the graph for recovery and reuse. Each Meso linkage occupies the Meso region and references at least two carried Micro settings without moving or duplicating them. Unlabeled connector lines may show which settings belong to the linkage, but no relationship verb moves into Meso. Exosphere and Macrosphere use visibly different concentric regions. Once more than one level is released, the map defaults to **All levels** so prior work remains visible. Students may then isolate one level. Filtering hides records without deleting or changing them. Positions, complete labels, evidence, annotations, and state persist when a level is hidden, when another level becomes current, and across export/import. Editing a memo marks guidance as ready to refresh; it does not remove candidates or existing map work.

Projects save first in the current browser. The Projects screen and link dialog must say plainly that device-only work can remain visible to another person who uses the same browser profile. A project link is optional and may include an optional student or group name; the name helps distinguish work but is not identity, authentication, or a progression requirement.

Creating a project link stores the complete serialized project on the class server, including its memo, map framing, accepted and set-aside suggestions, graph, evidence, annotations, revision history, and optional student or group name. The interface must disclose that full scope before creation. The unguessable link token is a bearer capability used together with current class access. Every link response carries an optimistic revision, last-sync time, and expiry. A client update must supply the revision it last read; a stale update returns a conflict and must never overwrite either copy silently. The student may reload the linked copy, keep the device copy and create a separate link, revoke future access, or delete the server copy. New links expire after the configured retention period; legacy links without an expiry remain explicitly identifiable as such until revoked, deleted, or migrated.

## Memo review contract

The runtime returns one bounded object with exactly `guidance`, `nodes`, `connections`, `example`, and `readiness`. Guidance points stay grounded in the memo and may include a short supporting excerpt. The response is descriptive rather than scored and never gates progress.

Suggestions remain off the graph until the student makes an explicit decision. Candidate review and connection review display at most four suggestions at once, with controls for moving among groups. **Add to map** confirms a suggestion as student interpretation, **Set aside — needs evidence** preserves it as a research lead, and **Remove** leaves it off the live graph while preserving the review decision.

Level rules are strict:

- Micro may return discrete node suggestions and direct relationship suggestions. Its relationships use clear verbs, valid Micro endpoints, evidence, and `scale: "micro"`.
- Meso returns noun-labeled linkage candidates with `type: "mesosystem"`, `scale: "meso"`, and `scope` containing at least two eligible carried Micro setting IDs. The accepted candidate is stored with those IDs in `scopeNodeIds`. Meso returns exactly zero connections. Student-facing prose uses readable setting labels rather than exposing IDs.
- Exosphere may return named outside decision settings only when each has a supported pathway to a carried Micro setting. Macrosphere returns broader-condition nodes with scopes and exactly zero connections.

The server fails closed on unsupported fields, invalid endpoints, duplicate records, over-limit text, and level-incompatible output. A student must still edit, add, set aside, or remove each valid suggestion before it changes the graph.

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

`sourceRecord` and `sourceMaterial` are compatibility API identifiers for memo details and memo text; they are not student-facing labels. The server, not the browser, chooses the current shared teacher configuration, executes the configured suggestion runtime, validates the level-specific output, replaces timestamps/configuration metadata with authoritative values, and persists the bounded evaluation for its configured lifetime. A Meso request must also provide the current eligible Micro settings with stable IDs so the model can scope linkages without inventing copies. The student response contains `{evaluation}` with exactly `id`, `review`, `configSnapshot`, `runtime`, `createdAt`, and `expiresAt`. `review` contains exactly `guidance`, `nodes`, `connections`, `example`, and `readiness`, bounded by the server contract. It must not contain criteria, scores, thresholds, outcome labels, provider output outside that allowlist, prompt text, credentials, or teacher-only fields.

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

At Micro, the model and interface may propose discrete elements and direct relationships among them. Micro guidance may address those relationships, including their verbs, without turning a whole clause into a node. At Meso, eligible Micro setting IDs carry forward and the model may suggest only noun-labeled mesosystems scoped to at least two of those settings. Meso guidance may address the supported interrelation among immediate settings, but it may not request generic verb edges. Every model suggestion begins as **Suggested** and remains off the graph until the student explicitly chooses **Add to map**. **Set aside — needs evidence** preserves a suggestion as a research lead, and **Remove** leaves it out of the live map without erasing its review record. Editing a model suggestion does not convert its origin into student interpretation; explicit acceptance does. Course settings may require evidence before acceptance but may never auto-confirm suggestions. Exosphere and Macrosphere guidance may shape sphere membership, outside decision pathways, policies, beliefs, and structural interpretation under their level-specific contracts.

- **What guidance should students receive in this section?** accepts up to 2,500 characters of instructor guidance.
- **What course material should support this section?** accepts up to 4,000 characters of pasted course material. The prompt must mark this field as reference content and must state that it cannot override fixed rules.

The effective prompt must include only the current Part-and-section guidance and supporting material. It must not accumulate prose from another section. The student evaluation request must name the canonical stage ID, and the server must reject unknown IDs while migrating the former instructor-response ID into the combined **review your memo** stage.

One published version governs new evaluations. A teacher may clone the published or an earlier version into a draft, edit Part-and-section settings, save a revision with a change note, preview the saved settings, and publish it. **Preview level** supplies runtime context for the preview only; changing it does not create or select a separate saved configuration. The preview response and Instructor Console show only the saved instructor guidance and course material plus their Part, section, contextual level, and revision. They must never expose the full effective prompt, code-owned guardrails, configuration fingerprints, or internal modules. Published and earlier versions are read-only. Publishing retires the former version and records append-only events for both records. Expected revisions prevent stale writes and preserve unsaved text until the teacher explicitly loads the server revision.

The internal preflight and graph-builder rules remain code-owned. The Instructor Console and its API must not expose the internal configuration matrix as instructor-editable records. The deterministic runtime records the published configuration as provenance but does not interpret instructor prose. Ollama Cloud composes the current Part-and-section guidance and course material into the provider prompt. The Console must state the active runtime effect before a teacher edits or publishes a draft.

Fresh databases seed separate unclaimed identities for Maria Mavrides Calderon and Zach Muhlbauer without credentials. Claiming requires an operator-controlled, one-time bootstrap token and an explicit account ID. Each server-process token may claim exactly one account. Passphrases must be salted and scrypt-derived; teacher sessions must be random, expiring, `HttpOnly`, and `SameSite=Strict`.

## Suggestion runtime modes

### Deterministic evaluator

When Ollama is disabled, the server uses fixed, inspectable evaluation rules. No memo content leaves the classroom server for a model provider. Changes to teacher and project instructions are recorded, but the deterministic evaluator does not interpret them. At Micro, deterministic output may contain discrete nodes and direct relationships. At Meso, it may propose only noun-labeled linkages scoped to at least two eligible carried Micro settings and must return zero connections. The student receives the same bounded memo-review shape described above; internal configuration and persistence fields remain server-side. This is a bounded fallback and testing baseline, not a claim of live model execution.

### Ollama Cloud

Ollama Cloud must be enabled explicitly with `OLLAMA_ENABLED=true` and a fresh server-only `OLLAMA_API_KEY`. The only production base URL is `https://ollama.com`; model name, timeout, output-token count, request/response size, and response fields are bounded. The server sends:

- current effective teacher prompt;
- project custom instructions;
- active level and inquiry;
- eligible Micro setting IDs and labels when Meso needs linkage suggestions;
- memo details;
- memo text.

Memo text is limited to 131,072 UTF-8 bytes and the inquiry to 8,192 UTF-8 bytes. The UI must disclose this transfer before generation and name the runtime/model returned by the classroom server. A provider timeout, network/HTTP error, oversized response, malformed JSON, extra field, or level-incompatible result must fail closed with a generic 502 response. There is no silent deterministic fallback.

The key previously pasted into chat is exposed and must be revoked. Neither local nor Railway configuration is complete until a newly rotated key is set server-side and a separate live-provider acceptance run succeeds.

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

Browser project schema v7 validates projects, memos, nodes, relationships, spheres, annotations, configurations, evaluations, review states, and events with stable IDs. Supported v1–v6 projects migrate to v7 without dropping graph data. A Meso linkage is stored as a `mesosystem` node with at least two valid Micro setting IDs in `scopeNodeIds`; Meso relationship edges are invalid. Previously stored Meso verb edges never remain at Meso or become invented Meso scopes: valid direct relationships become Micro research leads, valid institutional pathways become Exosphere research leads, and records that cannot satisfy either contract are retired with their earlier content preserved for review. Existing `macro` records migrate deterministically to `exosphere`; existing `integration` records migrate to `macrosphere`, except named institutions incorrectly stored there, which move to Exosphere. The migration covers nodes, relationships, current and completed levels, configuration, and export/import without dropping graph data. Supported graph operations remain add, revise, merge, contest, retire, and create research lead. Unknown IDs, invalid references, unapproved relationship verbs, malformed geometry, excess collections, unknown schema fields, and credential-shaped data fail closed.

Each level has independent `stage` and `reflection` values in `levelProgress`. Switching among released levels saves the current values and restores the target level's values. Completing a level records stage 4 for that level; completing Macro-level leaves the project at stage 4 with **Project complete** disabled as a terminal action. Cumulative graph records and prior decisions remain available throughout.

Each node and connection has additive `claimEvidence` records. Every record keeps memo passage or evidence, student interpretation, reasoning, uncertainty, counterevidence, and missing perspective separate, while retaining available evidence IDs and locators. Micro and Exo-level connections also support `relationshipProcess` with frequency, duration, direction, conditions, and change over time. Canonical export/import preserves these records, subject to the selected sharing tier's redactions.

Micro nodes record `focalParticipation` as direct, indirect, unclear, or not applicable. A non-setting Micro item may list one or more immediate Micro setting IDs in `settingNodeIds`; a setting cannot list itself or another membership. Setting membership remains distinct from Meso `scopeNodeIds`. Changing a Micro setting to a non-setting type or removing a node is blocked while active scopes, memberships, or relationships depend on it. The interface must name the dependent work and require explicit repair or removal; it must not cascade, filter, delete, or reclassify dependent records silently.

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
- Identify levels with plain labels and simple swatches. Micro displays its nodes and direct relationship lines, including during revise and export. Meso displays noun-labeled linkages in its own region and the carried Micro settings needed to understand each linkage. Any lines between a Meso linkage and those settings indicate scope only; they carry no relationship verbs. Exosphere and Macrosphere use distinct concentric regions that contain graph elements and remain filterable.
- Keep node and connection labels above lines and separate from icons. Never truncate them or reduce them to illegible auto-fit sizes. Hidden levels must not mutate stored records.
- Give the map materially more screen area. Keep pointer panning available after opening a record, add arrow-key panning when the canvas is focused, expose a reversible CSS full-screen mode, and permit zoom down to `0.15` without silently imposing a larger floor.
- Keep primary controls usable at 320–430 px widths, with no document-level horizontal overflow or occluded action.
- Use at least 44 px touch targets and at least 16 px editable text on phones where practical.
- Preserve visible focus, logical focus return, keyboard graph movement, roving tabs, Escape dismissal, reduced-motion behavior, forced-colors support, and live status for saves/movement.

## Acceptance gates

Automated acceptance requires the full UI/domain/server suite, SQLite server suite, fresh PostgreSQL integration, production build, dependency audit, and static leakage scan. It must prove that Micro can return, commit, revise, filter, and export direct relationships with their verbs; a whole clause never becomes a Micro node; Meso receives and reuses eligible Micro setting IDs; every Meso linkage has a noun label and at least two valid setting IDs; Meso returns and stores no relationship edges or verbs; completion advances Micro to Meso to Exosphere to Macrosphere and then ends at **Project complete**; schema v7 round-trips evidence, relationship process, participation, setting membership, and per-level progress; dependency repair blocks silent cascades; bounded suggestion groups remain navigable; progressed maps default to **All levels**; privacy-bounded workflow observations aggregate without exposing content or identity; full-screen, persistent pointer pan, keyboard pan, and `0.15` zoom remain available; old Macro and Integration data migrate without loss; an optional student/group name round-trips; level filtering does not mutate the graph; compact Instructor Console controls use the four current names; and multiple outstanding evaluations do not hit a course-wide maximum. Per-session supersession and retention tests should remain unchanged in this pass.

Rendered acceptance requires direct map access from every stage; the ordered level transition; Micro nodes with their direct relationship verbs; Meso linkage labels in the Meso region with no verb callouts; Exosphere and Macrosphere concentric regions; reversible full-screen; pointer and keyboard panning; extended zoom-out; filterable levels; complete readable labels; the compact Instructor Console; and map persistence at desktop, 320, 390, and 430 px with source-built browser screenshots and no relevant console errors. Delivery acceptance additionally requires private GitHub readback, a Railway deployment of the changed tree, live database/health/auth/review verification, and—if enabled—a separate Ollama Cloud run using a rotated key.

Passing deterministic tests, local PostgreSQL integration, or a production build must never be reported as proof of browser acceptance, Railway deployment, or live Ollama Cloud execution.

The 171-test run, build, browser captures, PR #5 receipt, and Railway deployment recorded on or before 2026-08-17 remain historical baselines. The 2026-08-22 map-interaction candidate recorded 242 passing tests with 4 explicitly guarded PostgreSQL skips; a build that emitted `index-BJBuN6w3.js`, `TeacherDashboard-DPrpmbM0.js`, and `index-BZOzcHy4.css`; and a passing `git diff --check`. Its browser run verified the now-superseded node-only Micro and generic-edge Meso behavior. Those receipts remain provenance only and do not establish the 2026-08-24 Micro/Meso contract. The fresh PostgreSQL, dependency-audit, leakage, publication, deployment, and provider receipts in the following paragraphs likewise apply to the 2026-08-21 ecological release.

An earlier isolated browser cycle showed that the clause “Adult Participants face delays when the Accessible Van Program is unavailable” produced the discrete nodes `Adult Participants` and `Accessible Van Program`. Its zero-relationship result belongs to the superseded Micro contract. The useful retained assertion is that the whole clause did not become a node.

Historical rendered acceptance is recorded in `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ecological-cycle-qa-2026-08-21/systems-mapping-ecological-cycle-qa-2026-08-21.zip` (SHA-256 `89f959144d0257a0a21d6440f7be3a37e50925f60adc7dd1687caeb246277c11`). Its 40 true PNGs cover all 15 states at desktop and 390 px plus five map/Teacher states each at 320 and 430 px; 4 fabricated memos and 4 metadata/assertion files accompany them. Strict checks found no truncation, overlap, overflow, console errors, or captured success toasts and recorded Micro 6/0, exact-ID Meso carry-forward, cumulative 21/19, and Instructor Console after authentication. No credentials are packaged. The archive does not establish the corrected Micro/Meso behavior.

Historical delivery acceptance is recorded: PR #9 is merged on GitHub `main`; Railway deployment `51a03b7e-6752-4681-8714-5bbf6106d843` reached `SUCCESS`; live migration, health, public access, student-to-teacher denial, Instructor Console route, configuration, logout, headers, exact bundle hashes, and zero HTTP 5xx passed. Fabricated East Harlem memos produced schema-valid live `ollama-cloud` reviews for the now-superseded Micro 7/0 and Meso 0/6 contract, plus Exosphere 11/5 and Macrosphere 8/1. No production teacher credential or provider secret was exposed. Provider-key rotation provenance remains an operator confirmation outside this historical acceptance.

## Source authority

`docs/SOURCE_LEDGER.md` remains the authority record. The direct correction supplied on 2026-08-24 and recorded in `docs/MICRO_MESO_CORRECTION_2026-08-24.md` governs the Micro/Meso boundary. The Maria and Zach Zoom material supplied on 2026-08-21 continues to govern the four level names, their order, and the compatible ecological-layer design. The fuller Drive specification governs compatible general behavior; local wireframes govern compatible presentation; CALI materials provide context; and Zach's August 5 notes remain unconfirmed minutes.

## Field Notes by scale — October 19, 2026

Notebook uses one Field Notes response for each of Micro, Meso, Exo, and Macro. A nonblank response is required before completing a scale; moving between Map and Notebook remains available. Questions address missing perspectives, actors, relationships or conditions, further observation, and the next scale’s mapping work. Micro distinguishes direct relationships from the links among everyday settings investigated at Meso.

The instructor publishes a question for each scale from Course settings. These questions are independent of the five internal mapping steps. Older profiles use the default scale questions; older student answers retain their exact text. Published question changes never replace student answers. The current autosave journal and per-scale storage remain in use. Historical draft recovery is a separate proposal in `field-notes-recovery-proposal.md`.
