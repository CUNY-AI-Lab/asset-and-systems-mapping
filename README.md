> **Active beta.** Systems Mapping is under active classroom development.

# Systems Mapping

Systems Mapping supports place-based ethnographic inquiry through one persistent asset and systems map. Students revisit five stages across four scales: Part 1 groups Micro and Meso; Part 2 groups Macro and Integration. Teacher Console lets instructors adapt guidance and course material for each stage and part. When a language model is enabled, it can suggest connections, but students decide what to edit, accept, or reject.

Implementation is local-first. Project state stays in browser storage. Submitted evaluations and review snapshots, teacher accounts, and shared course configuration live on classroom server in SQLite locally or PostgreSQL when hosted.

## Student workflow

- choose a scale and add a source asks students to set the current scale, add a source, and record the details needed to use it in the map
- review source with your instructor asks students to identify what the evidence supports, what remains uncertain, and what they want to ask their instructor
- choose nodes and describe connections asks students to choose supported elements, describe how they connect, and decide which model suggestions to keep
- build map asks students to arrange, connect, and annotate selected elements while linking each claim to evidence
- revise and export asks students to reconsider their claims, record what changed, and decide what can be shared

The five stages are repeatable, and every stage and the map are directly available in every cycle. Part 1 contains Micro and Meso; Part 2 contains Macro and Integration. These parts organize course work without adding stages or map layers. Nodes and relationships keep their scale tags, positions, evidence, and annotations as the map accumulates. The map opens with every active scale layer visible; students may combine or hide layers to compare levels of analysis.

After choosing nodes, the student describes how they connect. The language model receives that description, the chosen nodes, and current Teacher Console guidance. It proposes relationships without adding them automatically. The student can change both endpoints and the wording, accept or reject each suggestion, and open the map with only accepted connections.

Generating guidance does not edit the source or map. The student sees only a few short prompts tied to the source—never criterion IDs, scores, outcomes, or the full model review. Sending a note to the instructor creates a review snapshot. Instructor feedback is advisory: pending, approved, or returned work never prevents the student from opening another stage, choosing nodes, or using the map.

## Run locally

Requirements: Node 22.5 or newer and pnpm 11.

```bash
pnpm install
pnpm build
pnpm server
```

Open `http://127.0.0.1:4177`. Local mode binds only to `127.0.0.1`, creates `data/systems-mapping.sqlite`, and accepts the initial class code `101`. That code is held by the server and is not compiled into the browser bundle. It opens the class workspace; it is not student identity or strong authentication.

For live frontend development, run the API and Vite separately:

```bash
pnpm server:dev
pnpm dev
```

Current automated gates:

```bash
pnpm test
pnpm test:server
pnpm build
```

## Teacher accounts and review

Fresh databases seed unclaimed identities for Maria Mavrides Calderon and Zach Muhlbauer, never default passphrases. To claim one account, start the server with a temporary, server-only `SYSTEMS_MAPPING_TEACHER_BOOTSTRAP_TOKEN` of 16–256 characters. A token authorizes one claim for that server process; claim the second account with a fresh token on a later restart. Passphrases are scrypt-derived, and teacher sessions use random `HttpOnly`, `SameSite=Strict` cookies.

The Teacher Console opens on **Review submissions**. Its queue loads before course settings. Selecting one submission reveals the source and student note. A collapsed **Review details** section groups evidence excerpts, possible follow-up, and open questions without presenting a model score as the instructor's judgment. The instructor writes one focus for the student, then chooses **Add feedback**, **Add feedback and a question**, or **Recommend another pass**. These actions record asynchronous feedback without changing student work or controlling stage and map access. Optimistic revisions prevent stale decisions, and accepted updates append an immutable review event.

**Course settings** follows the same five stages students revisit. A teacher opens one stage at a time and writes how the model should guide it, then may paste course material the model can draw on. Only the current stage's guidance and material enter that model request. This keeps each intervention focused and lets an instructor revise one part of the cycle across successive class sessions without building a cumulative prompt. Course material enters as reference content rather than a competing instruction source.

One published version governs new model requests. A teacher creates a draft from the published or an earlier version, saves changes with a note, previews the saved prompt by stage and scale, and publishes it. Publishing retires the earlier version without erasing its history. Cloning an earlier version provides rollback without editing a published record in place.

Fixed evidence, privacy, output, and student-confirmation rules remain code-owned. The server still composes those rules from smaller internal parts, but it exposes no internal configuration matrix to the Teacher Console or its retired module endpoints. The deterministic evaluator records the published version and current section without changing its fixed score. Ollama Cloud receives the published guidance and course material for the current section.

## Suggestion runtime

With Ollama disabled, the classroom server runs its deterministic evaluator. It applies fixed H1–H4 and C1–C8 rules internally to validate the server response. The Teacher Console turns that result into evidence excerpts, possible follow-up, and open questions while leaving the instructional judgment to the teacher. The server shows the student no more than three short questions tied to passages in the source. Changes to teacher and project instructions are recorded but do not change deterministic scoring. This mode is reproducible and sends nothing to an outside model provider; it is not proof that a language model ran. Connection suggestions require Ollama and do not fall back to deterministic rules.

Ollama Cloud is explicit opt-in:

```dotenv
OLLAMA_ENABLED=true
OLLAMA_API_KEY=<fresh-rotated-server-only-key>
OLLAMA_CLOUD_URL=https://ollama.com
OLLAMA_MODEL=gpt-oss:20b
```

When enabled, the server sends the published guidance and course material for the current section, bounded project instructions, inquiry, scale, source details, and source text to Ollama Cloud. Source text is limited to 131,072 UTF-8 bytes and the inquiry to 8,192 UTF-8 bytes. Provider output must satisfy the exact H1–H4/C1–C8 JSON schema; malformed, oversized, or unavailable provider responses fail with a generic error and do not silently fall back to deterministic scoring.

The credential previously pasted into chat must be treated as exposed. It has deliberately not been placed in the local `.env` or Railway. Revoke it and configure a newly rotated key before enabling Ollama Cloud. Never prefix `OLLAMA_API_KEY` with `VITE_` or otherwise expose it to client code.

## Persistence and retention

- Browser `localStorage` holds the current student project, stage, graph records, node positions, viewport, node/relationship/map annotations, and the private capability needed to refresh an instructor response. Save failures preserve the in-memory project and offer recovery export.
- The classroom database holds teacher identities and sessions, course profiles and append-only profile events, code-owned base configuration, bounded prototype events, authoritative evaluations, review snapshots, and append-only decision events.
- Unsubmitted evaluations expire after 1 day. Pending review snapshots are retained for 30 days; decided snapshots for 180 days. Retention deletes snapshots that contain source text and their decision rows, then keeps only a hashed, append-only purge receipt.
- Review and evaluation IDs are random bearer capabilities. Every portable export redacts both IDs. Student status responses are deliberately minimal and never return source text, prompt content, configuration, or teacher identity.
- Canonical JSON preserves stable graph IDs, layout, viewport, annotations, and redaction manifests. CSV cells are neutralized against spreadsheet formulas.

## Hosted and Railway contract

The PostgreSQL-backed Railway service is live at [web-production-08455.up.railway.app](https://web-production-08455.up.railway.app). Five-stage snapshot deployment `3ea599f4-7fb5-4dd3-998d-c55134a69f15` reached `SUCCESS`; migration completed and `/api/health` returned `{"status":"ok"}`. Class code `101` created a course-server session, public configuration returned Part 1 and Part 2 scale groupings, and logout removed that session. Served bundles matched current five-stage and non-blocking review copy, and deployment logs showed no 5xx responses during verification. A full live Teacher Console review and current header readback remain follow-up. Ollama remains disabled and no provider key is installed. Hosted mode requires these server variables together:

```dotenv
DATABASE_URL=<postgres-connection-string>
PUBLIC_ORIGIN=https://<public-host>
HOST=0.0.0.0
TRUST_PROXY_HOPS=1
SYSTEMS_MAPPING_CLASS_CODE=<10-32-character-server-only-code>
```

Private hosted courses require a class code with at least six distinct characters; `101` remains rejected by default. A public teaching demo instead uses this exact pair:

```dotenv
SYSTEMS_MAPPING_PUBLIC_DEMO=true
SYSTEMS_MAPPING_CLASS_CODE=101
```

The shared demo code is low-assurance access, not student identity. Hosted cookies remain `Secure`; exact public origin, host, proxy depth, rate limits, retention, and bounded evaluation/submission capacity remain enforced. `DATABASE_SSL`, pool, connection, idle, statement, and transaction timeout variables are available for the target PostgreSQL environment.

## Design and map behavior

Black, white, and gray remain dominant. Restrained teal, amber, and plum accents identify micro, meso, and macro scales and a few selected states; shape, label, outline, and line pattern repeat every distinction. The UI uses modest editorial typography rather than oversized display copy. Map layout, viewport, and annotations persist locally, round-trip through canonical JSON, and support pointer and keyboard movement.

## Evidence and authority

The current active-beta tree passed 160 tests with 3 PostgreSQL integration tests skipped in the ordinary local run. It produced a successful production build, and the production dependency audit reported no known vulnerabilities. Source and application-bundle scans found no credential values; the application bundle contains no local class code, source maps, dangerous HTML sink, teacher identity, review capability, or server prompt. Numeric `101` values found in a library bundle belong only to unrelated glyph tables.

GitHub readback confirmed that PR [#3](https://github.com/CUNY-AI-Lab/systems-mapping/pull/3) merged an earlier production-aligned tree into `main` at commit `a4bdc0d`. Current five-stage implementation is checkpointed at `4bb915a` on local reconciliation branch `codex/reconcile-five-stage-release`; GitHub `main` does not contain it until branch review and merge. Tracked publication excludes environment files, databases, local state, screenshots, and test fixtures.

Existing disposable browser journeys and screenshot archives document earlier workflows. One earlier five-stage journey exercised a then-current instructor pause; that receipt is historical and does not verify current advisory, non-blocking review behavior. Current workflow has five stages, with node selection and connection prompting combined, Part 1 grouping Micro and Meso, and Part 2 grouping Macro and Integration. Current annotated package is `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ui-qa-2026-08-12.zip`; it contains five paired desktop/mobile views, including a populated multi-scale map, and passes archive and visual inspection. Railway serves this current working-tree snapshot, while GitHub still needs a reviewed, merged source commit. Design specification image is at `docs/concepts/semester-map-cycle-spec-v1.png`.

Full live Teacher Console review, rendered reload/export restoration, and live Ollama execution remain active-beta follow-up rather than claims of this deterministic release.

- [Source ledger](./docs/SOURCE_LEDGER.md)
- [Requirements](./docs/REQUIREMENTS.md)
- [QA report](./docs/QA.md)
- [Security review](./docs/SECURITY_REVIEW.md)
- [Teacher control across both applications](./docs/EDUCATOR_RESOURCE_FRAMEWORK.md)
- [Release evidence ledger](./TODO.md)
- [August 13 reconciliation record](./docs/RECONCILIATION_2026-08-13.md)

The source ledger remains authoritative about provenance: the fuller Drive specification governs behavior; the supplied HTML/DOCX guide interaction; CALI materials provide context; Zach's August 5 notes remain unconfirmed minutes; and STEM Splitter is an architecture precedent. No Maria-specific Zoom summary was found, so none is represented as a confirmed design decision.
