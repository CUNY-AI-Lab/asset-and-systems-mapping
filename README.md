> **Active beta.** Systems Mapping is under active classroom development.

# Systems Mapping

Systems Mapping supports place-based ethnographic inquiry through one persistent asset and systems map. Students revisit five stages across four scales: Part 1 groups Micro and Meso; Part 2 groups Macro and Integration. Teacher Console lets instructors adapt guidance and course material for each stage and part. When a language model is enabled, it can suggest connections, but students decide what to edit, accept, or reject.

Implementation is local-first. Project state stays in browser storage. Submitted evaluations and review snapshots, teacher accounts, and shared course configuration live on classroom server in SQLite locally or PostgreSQL when hosted.

## Student workflow

- add your memo asks students to choose a scale, upload a memo or paste its text, and optionally name the map
- review your memo calls the model as soon as the student arrives: it reads the memo, surfaces grounded guidance, proposes the nodes and connections already evident in the text, walks through one worked example, and signals in its own words when the memo is ready to map
- choose nodes and describe connections seeds the model's proposals as editable candidates; students keep, edit, or remove each one, then ask for further connection suggestions — in their own words or straight from the memo
- build map asks students to arrange, connect, and annotate selected elements while linking each claim to evidence
- revise and export asks students to reconsider their claims, record what changed, and decide what can be shared

The five stages are repeatable, and every stage and the map are directly available in every cycle. Part 1 contains Micro and Meso; Part 2 contains Macro and Integration. These parts organize course work without adding stages or map layers. Nodes and relationships keep their scale tags, positions, evidence, and annotations as the map accumulates. The map opens with every active scale layer visible; students may combine or hide layers to compare levels of analysis.

The memo stays available as a collapsed, editable drawer on every later stage. Editing it never removes candidates or map work; it only marks the current guidance as refreshable so the student can ask the model to reread on their own schedule. After choosing nodes, the student may describe how they connect — or leave the description empty, in which case the model reads the memo directly. It proposes relationships without adding them automatically. The student can change both endpoints and the wording, accept or reject each suggestion, and open the map with only accepted connections.

Generating guidance does not edit the memo or map, and nothing the model writes is filtered or scored before the student sees it — no criterion IDs, rubric outcomes, or hidden reviews. Every stage and the map remain open regardless of what the model says.

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

Fresh databases seed unclaimed identities for Maria Mavrides Calderon and Zach Muhlbauer, never default passphrases. To claim one account, start the server with a temporary, server-only `SYSTEMS_MAPPING_TEACHER_BOOTSTRAP_TOKEN` of 16–256 characters. A token authorizes one claim for that server process; claim the second account with a fresh token on a later restart. An operator can create an account-bound, 30-minute password-reset link with `node server/create-password-reset.js <teacher-account-id>` from the deployed service. Reset links work once and revoke the account's existing teacher sessions. Passphrases are scrypt-derived, and teacher sessions use random `HttpOnly`, `SameSite=Strict` cookies.

The Teacher Console opens on **Review submissions**. The student workflow no longer sends review snapshots — the queue serves submissions from earlier releases and the retained API — so new class work reaches instructors through the classroom itself rather than an in-app note. Its queue loads before course settings. Selecting one submission reveals the memo and student note. A collapsed **Review details** section groups evidence excerpts, possible follow-up, and open questions without presenting a model score as the instructor's judgment. The instructor writes one focus for the student, then chooses **Add feedback**, **Add feedback and a question**, or **Recommend another pass**. These actions record asynchronous feedback without changing student work or controlling stage and map access. Optimistic revisions prevent stale decisions, and accepted updates append an immutable review event.

**Course settings** follows the same five stages students revisit. A teacher opens one stage at a time and writes how the model should guide it, then may paste course material the model can draw on. Only the current stage's guidance and material enter that model request. This keeps each intervention focused and lets an instructor revise one part of the cycle across successive class sessions without building a cumulative prompt. Course material enters as reference content rather than a competing instruction source.

One published version governs new model requests. A teacher creates a draft from the published or an earlier version, saves changes with a note, previews the saved prompt by stage and scale, and publishes it. Publishing retires the earlier version without erasing its history. Cloning an earlier version provides rollback without editing a published record in place.

Fixed evidence, privacy, output, and student-confirmation rules remain code-owned. The server still composes those rules from smaller internal parts, but it exposes no internal configuration matrix to the Teacher Console or its retired module endpoints. Ollama Cloud receives the published guidance and course material for the current section.

## Suggestion runtime

With Ollama enabled, the model reads the memo under the memo review contract and returns grounded guidance, proposed nodes and connections, one worked example, and a readiness signal — passed to the student without filtering or scoring, bounded only by size and shape limits. With Ollama disabled, the classroom server runs an offline reader that recognizes only direct connection phrases such as "X provides Y"; it says so plainly in its guidance, proposes whatever nodes and connections it can find, and never judges the memo. This offline mode is reproducible and sends nothing to an outside model provider; it is not proof that a language model ran. Connection suggestions require Ollama and do not fall back to offline rules.

Ollama Cloud is the primary model runtime and OpenRouter is an optional backup; both are explicit opt-in:

```dotenv
OLLAMA_ENABLED=true
OLLAMA_API_KEY=<fresh-rotated-server-only-key>
OLLAMA_CLOUD_URL=https://ollama.com
OLLAMA_MODEL=deepseek-v4-flash:0731
OLLAMA_TIMEOUT_MS=90000
OLLAMA_MAX_OUTPUT_TOKENS=8192

OPENROUTER_ENABLED=true
OPENROUTER_API_KEY=<fresh-rotated-server-only-key>
OPENROUTER_URL=https://openrouter.ai
OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731
OPENROUTER_TIMEOUT_MS=90000
OPENROUTER_MAX_OUTPUT_TOKENS=8192
```

When both runtimes are enabled, every request goes to Ollama Cloud first; provider-side failures (timeouts, HTTP errors, malformed envelopes) retry once through OpenRouter, while input-shaped failures never retry. The stored runtime metadata records which provider actually served each evaluation. With only OpenRouter enabled it serves as the primary runtime. Thinking models such as DeepSeek V4 Flash spend output tokens on reasoning before the JSON answer, so the token and timeout headroom above is required — the 2,048-token default truncates real memo reviews.

The server sends the published guidance and course material for the current section, bounded project instructions, inquiry, scale, memo details, and memo text to the configured provider. Memo text is limited to 131,072 UTF-8 bytes and the inquiry to 8,192 UTF-8 bytes. Provider output must satisfy the memo review JSON contract; malformed, oversized, or unavailable provider responses fail with a generic error and do not silently fall back to deterministic output.

Any credential pasted into chat or shell history must be treated as exposed: revoke it and configure a newly rotated key. Never prefix `OLLAMA_API_KEY` or `OPENROUTER_API_KEY` with `VITE_` or otherwise expose them to client code.

## Persistence and retention

- Browser `localStorage` holds the current student project, stage, graph records, node positions, viewport, node/relationship/map annotations, and the private capability needed to refresh an instructor response. Save failures preserve the in-memory project and offer recovery export.
- The classroom database holds teacher identities and sessions, course profiles and append-only profile events, code-owned base configuration, bounded prototype events, authoritative evaluations, review snapshots, and append-only decision events.
- Unsubmitted evaluations expire after 1 day. Pending review snapshots are retained for 30 days; decided snapshots for 180 days. Retention deletes snapshots that contain memo text and their decision rows, then keeps only a hashed, append-only purge receipt.
- Review and evaluation IDs are random bearer capabilities. Every portable export redacts both IDs. Student status responses are deliberately minimal and never return memo text, prompt content, configuration, or teacher identity.
- Canonical JSON preserves stable graph IDs, layout, viewport, annotations, and redaction manifests. CSV cells are neutralized against spreadsheet formulas.

## Hosted and Railway contract

The PostgreSQL-backed Railway service is live at [web-production-08455.up.railway.app](https://web-production-08455.up.railway.app). Deployment `39d38543-20ca-4626-95e6-237ef9213881`, built from clean `main` commit `abddbd0a2640aa0e4db0dcf0a1c47d65e9983597`, reached `SUCCESS`. Migration reported ready; root and `/api/health` returned 200 with expected security headers; class code `101` created a course-server session; public configuration returned Part 1 and Part 2 scale groupings; and logout removed that session. Local and live application bundles matched by exact hash, requested copy was present, banned copy was absent, and deployment logs showed no 5xx responses during verification. Earlier dirty-working-tree deployment `3ea599f4-7fb5-4dd3-998d-c55134a69f15` remains historical evidence rather than current provenance. A complete live Teacher Console transaction, rendered reload/export restoration, and live Ollama execution remain follow-up. Ollama remains disabled and no provider key is installed. Hosted mode requires these server variables together:

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

Black, white, and gray remain dominant. Restrained teal, amber, plum, and black outlines identify Micro, Meso, Macro, and Integration in the Map key, while map cards keep labels separate from icons and render every character. The UI uses modest editorial typography rather than oversized display copy. Map layout, viewport, and annotations persist locally, round-trip through canonical JSON, and support pointer and keyboard movement.

## Evidence and authority

The current active-beta tree passed 171 tests with 3 PostgreSQL integration tests skipped in the ordinary local run. It produced a successful production build, and the production dependency audit reported no known vulnerabilities. Source and application-bundle scans found no credential values; the application bundle contains no local class code, source maps, dangerous HTML sink, teacher identity, review capability, or server prompt. Numeric `101` values found in a library bundle belong only to unrelated glyph tables.

GitHub readback confirmed that PR [#3](https://github.com/CUNY-AI-Lab/systems-mapping/pull/3) merged an earlier production-aligned tree into `main` at commit `a4bdc0d`. PR [#5](https://github.com/CUNY-AI-Lab/systems-mapping/pull/5) merged the reconciled five-stage implementation into `main` at `abddbd0a2640aa0e4db0dcf0a1c47d65e9983597`; local `main`, `origin/main`, and GitHub `main` were synchronized at that commit before this documentation-only release receipt. This receipt changes no runtime behavior. Tracked publication excludes environment files, databases, local state, screenshots, and test fixtures.

Existing disposable browser journeys and screenshot archives document earlier workflows. One earlier five-stage journey exercised a then-current instructor pause; that receipt is historical and does not verify current advisory, non-blocking review behavior. Current workflow has five stages, with node selection and connection prompting combined, Part 1 grouping Micro and Meso, and Part 2 grouping Macro and Integration. Current annotated package is `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ui-qa-2026-08-12.zip`; it contains five paired desktop/mobile views, including a populated multi-scale map, and passes archive and visual inspection. Railway deployment `39d38543-20ca-4626-95e6-237ef9213881` verified the clean implementation merge from PR #5; this documentation-only receipt does not alter that runtime. Design specification image is at `docs/concepts/semester-map-cycle-spec-v1.png`.

A complete live Teacher Console transaction, rendered reload/export restoration, and live Ollama execution remain active-beta follow-up rather than claims of this deterministic release.

- [Source ledger](./docs/SOURCE_LEDGER.md)
- [Requirements](./docs/REQUIREMENTS.md)
- [QA report](./docs/QA.md)
- [Security review](./docs/SECURITY_REVIEW.md)
- [Teacher control across both applications](./docs/EDUCATOR_RESOURCE_FRAMEWORK.md)
- [Release evidence ledger](./TODO.md)
- [August 13 reconciliation record](./docs/RECONCILIATION_2026-08-13.md)

The source ledger remains authoritative about provenance: the fuller Drive specification governs behavior; the supplied HTML/DOCX guide interaction; CALI materials provide context; Zach's August 5 notes remain unconfirmed minutes; and STEM Splitter is an architecture precedent. No Maria-specific Zoom summary was found, so none is represented as a confirmed design decision.
