> **Active beta.** Systems Mapping is under active classroom development.

# Systems Mapping

Systems Mapping supports place-based inquiry through one persistent map. Students revisit five workflow stages across four analytical levels: Part 1 groups Micro and Meso; Part 2 groups Exosphere and Macrosphere. Teacher Console lets instructors adapt guidance and course material for each Part and section. A language model can suggest discrete Micro elements and their direct relationships, mesosystems formed by carried Micro settings, outside Exo-level decision settings and pathways into carried Micro settings, and scoped Macro-level conditions. Students review and edit each suggestion, then choose Add to map, Set aside — needs evidence, or Remove.

Implementation is local-first. Project state stays in browser storage. Bounded evaluations, retained review records, teacher accounts, and shared course configuration live on classroom server in SQLite locally or PostgreSQL when hosted.

## Student workflow

- add your memo asks students to choose a level, upload a memo or paste its text, and optionally name the map
- review your memo lets the student request model guidance after reviewing the transfer disclosure or continue without it: Micro proposals name discrete people, roles, activities, objects, and immediate settings, with direct relationships stored separately; Meso receives eligible Micro setting IDs and may propose noun-labeled mesosystems scoped to at least two settings
- choose nodes and describe relationships lets students revise each suggestion; suggestions begin off the map, appear in groups of four, and only items explicitly added are committed to the cumulative map
- build map asks students to arrange and annotate selected elements; Micro retains its direct relationship verbs, Meso shows named mesosystems and their included settings without verb edges, Exo-level shows outside decision pathways into carried Micro settings, and Macro-level conditions identify the map items they affect
- revise and export asks students to reconsider the current level, record what changed, and decide what can be shared; the current-level view preserves the correct records for that level, while a full export preserves the complete cumulative graph

The five stages are repeatable, and every stage and the map are directly available in every level. Completing revise and export advances the active level in order: Micro to Meso, Meso to Exosphere, and Exosphere to Macrosphere. Completing Macrosphere ends progression at **Project complete**; students may continue to review, revise, and export the project without starting another level cycle. Part 1 contains Micro and Meso; Part 2 contains Exosphere and Macrosphere. Meso carries eligible Micro settings forward by stable ID, so identifying a mesosystem does not duplicate or move those settings. Exosphere replaces the former Macro level; Macrosphere replaces the former Integration level. Those later levels use distinct concentric regions. Once more than one level is available, the map opens on **All levels** so prior work remains visible; students may isolate one level without changing hidden graph records.

The memo stays available as a collapsed, editable drawer on every later stage. Editing it never removes candidates or map work; it marks the current guidance as ready to refresh. At Micro and Exosphere, students may ask the model for additional relationships and can change both endpoints and the wording. Meso and Macrosphere do not use graph relationship edges: a Meso item identifies its included Micro settings, and a Macrosphere item identifies the inner mapped elements it affects.

Micro records distinguish direct, indirect, unclear, and not-applicable participation by the focal person or group. A non-setting Micro item may also reference the immediate setting or settings in which it appears. Those memberships are separate from Meso scope: Meso reuses eligible Micro setting IDs to describe interrelations across settings.

Nodes and connections support additive evidence records that keep a memo passage, student interpretation, reasoning, uncertainty, counterevidence, and missing perspective distinct. Micro and Exo-level connections may also record frequency, duration, direction, conditions, and change over time. Removing a node or changing a Micro setting type is blocked while another map item, setting membership, scope, or connection still depends on it; the interface names the dependent work so the student can repair or remove it explicitly.

Each level stores its own stage and reflection. Moving among released levels restores that level's saved work, while the cumulative graph and prior decisions remain intact. Browser project schema v7 validates these records, migrates supported v1–v6 projects, and preserves them through canonical export and import.

Generating guidance does not edit the memo or map. Every stage, level, and the map remain open regardless of a model response, instructor review, or outstanding evaluation. There is no course-wide ceiling on active preflight evaluations; expiration, rate limits, and provider-concurrency safeguards still apply. Per-session supersession and retention purges are unchanged in this pass.

Optional student-workflow evaluation uses the closed `workflow_observed` event. It records only task code, completion outcome, classification explanation, revision quality, and recovery outcome from fixed categories. Reports expose aggregate counts, not memo text, map labels, annotations, prompts, capabilities, identity, row-level observations, sessions, or timestamps.

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

The Teacher Console opens on **Review submissions**. The current student workflow does not send a note or review snapshot to this queue. It remains available for records from earlier releases and the retained review API. Review actions record asynchronous feedback without changing student work or controlling stage and map access.

**Course settings** follows the same five sections students revisit. Its compact controls show one Part and one section at a time. A saved guidance-and-material pair is shared by both levels in that Part: Micro and Meso share Part 1 settings, while Exosphere and Macrosphere share Part 2 settings. Level-specific runtime rules still apply: Micro may produce direct relationships, Meso produces only scoped `mesosystem` nodes, Exosphere may produce institutional relationships, and Macrosphere produces only scoped conditions.

One published version governs new model requests. A teacher creates a draft from the published or an earlier version, saves changes with a note, previews the saved settings, and publishes it. **Preview level** supplies context for that preview; it does not select a separate saved configuration. The preview shows only the saved instructor guidance and course material, never the full effective prompt, code-owned guardrails, internal modules, or configuration fingerprints. Publishing retires the earlier version without erasing its history. Cloning an earlier version provides rollback without editing a published record in place.

Fixed evidence, privacy, output, and student-confirmation rules remain code-owned. The server still composes those rules from smaller internal parts, but it exposes no internal configuration matrix to the Teacher Console or its retired module endpoints. Ollama Cloud receives the published guidance and course material for the current section.

## Suggestion runtime

With a model enabled, it reads the memo under a level-specific contract. Micro returns grounded proposals for discrete elements and direct relationships. Each Micro node label names one relevant person, role, activity, object, or immediate setting as a noun phrase; a sentence, clause, proposition, finding, or explanation is not a node label. Meso receives carried Micro settings and returns only noun-labeled `mesosystem` nodes scoped to at least two of them, with zero relationship edges. Exosphere returns institutions and registered institutional relationships. Macrosphere returns broader laws, policies, economic conditions, histories, beliefs, and structures with scopes of at least two mapped elements and zero relationship edges. A named institution such as CUNY belongs at Exosphere, not Macrosphere. Without a model provider, the classroom server uses a reproducible built-in text review and sends nothing to an outside provider; it is not proof that a language model ran. Additional relationship suggestions require a model provider and do not fall back to built-in rules.

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

The server sends the published guidance and course material for the current section, bounded project instructions, inquiry, level, memo details, and memo text to the configured provider. Memo text is limited to 131,072 UTF-8 bytes and the inquiry to 8,192 UTF-8 bytes. Provider output must satisfy the memo review JSON contract; malformed, oversized, or unavailable provider responses fail with a generic error and do not silently fall back to deterministic output.

Any credential pasted into chat or shell history must be treated as exposed: revoke it and configure a newly rotated key. Never prefix `OLLAMA_API_KEY` or `OPENROUTER_API_KEY` with `VITE_` or otherwise expose them to client code.

## Persistence and retention

- Browser `localStorage` holds schema-v7 student projects, the active project-library pointer, optional student/group name, per-level stages and reflections, memo, candidates, graph records, participation and setting memberships, evidence and relationship-process records, node positions, viewport, and node/relationship/map annotations. A retained compatibility review capability may be present in an older project, but the current student interface does not create a submission. The optional name appears with a project link so an instructor can identify the work; leaving it blank never blocks progress. Save failures preserve the in-memory project and offer recovery export.
- The classroom database holds teacher identities and sessions, course profiles and append-only profile events, code-owned base configuration, bounded prototype events, authoritative evaluations, review snapshots, and append-only decision events.
- Unsubmitted evaluations expire after 1 day. Pending review snapshots are retained for 30 days; decided snapshots for 180 days. Retention deletes snapshots that contain memo text and their decision rows, then keeps only a hashed, append-only purge receipt.
- Review and evaluation IDs are random bearer capabilities. Every portable export redacts both IDs. Student status responses are deliberately minimal and never return memo text, prompt content, configuration, or teacher identity.
- Canonical JSON preserves stable graph IDs, layout, viewport, annotations, and redaction manifests. CSV cells are neutralized against spreadsheet formulas.

## Hosted and Railway contract

The PostgreSQL-backed Railway service is reachable at [web-production-08455.up.railway.app](https://web-production-08455.up.railway.app). PR [#9](https://github.com/CUNY-AI-Lab/systems-mapping/pull/9) merged the ecological progression into clean `main` at `7f6444147d34a4c62203eb1a3943fcfd6c3f4491`. Railway deployment `51a03b7e-6752-4681-8714-5bbf6106d843` reached `SUCCESS` from that exact commit, ran the PostgreSQL migration, passed `/api/health`, and served byte-identical production bundles. Deployment `39d38543-20ca-4626-95e6-237ef9213881` remains historical evidence for the preceding Macro/Integration implementation. Hosted mode requires these server variables together:

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

The shared demo code is low-assurance access, not student identity. Hosted cookies remain `Secure`; exact public origin, host, proxy depth, rate limits, retention, provider concurrency, and submission-queue bounds remain enforced. Outstanding preflight evaluations do not share a course-wide maximum. `DATABASE_SSL`, pool, connection, idle, statement, and transaction timeout variables are available for the target PostgreSQL environment.

## Design and map behavior

Black, white, and gray remain dominant. Restrained accents identify Micro, Meso, Exosphere, and Macrosphere. Micro presents discrete elements with their direct relationship lines, including in revise and export. Each Meso item sits in the Meso region and uses unlabeled scope lines to identify its included Micro settings; no proposition or relationship verb appears in that layer. Exosphere and Macrosphere use distinct, filterable concentric regions. The larger map canvas supports persistent pointer or keyboard panning, zooming out to `0.15`, and a CSS full-screen view that can always be exited. Cards keep labels separate from icons and render every character. The UI uses modest editorial typography rather than oversized display copy.

## Evidence and authority

The 2026-08-17 baseline passed 171 tests with 3 PostgreSQL integration tests skipped, produced a successful build, and passed its recorded dependency and leakage scans. Those results predate the 2026-08-21 ecological-layer reversion and are not evidence for this candidate.

The 2026-08-22 map-interaction candidate has local receipts only. The ordinary suite passed 242 tests, with 4 PostgreSQL tests skipped behind their explicit environment guard. `pnpm build` produced `index-BJBuN6w3.js`, `TeacherDashboard-DPrpmbM0.js`, and `index-BZOzcHy4.css`; `git diff --check` passed. A real in-app browser run against that final built bundle at 1440×1000 and 390×844 confirmed the relationship-free Micro revision view, the Micro-to-Meso and Meso-to-Exosphere transitions, six complete non-overlapping Meso relationship callouts in the Meso annulus, computed Meso callout sizes of `24px` on desktop and `26px` on phone, full-screen without horizontal overflow, `0.25` zoom, keyboard panning, and zero browser warnings or errors. These checks do not establish GitHub, Railway, or live-provider acceptance for the changed working tree. The fresh PostgreSQL, dependency-audit, leakage, GitHub, Railway, and live-provider receipts below remain evidence for the 2026-08-21 ecological release rather than this local candidate.

A second real in-app browser run exercised the discrete-label regression directly. The memo sentence “Adult Participants face delays when the Accessible Van Program is unavailable” surfaced exactly `Adult Participants` and `Accessible Van Program` as Micro nodes, committed those two labels to the map, created zero relationships, and produced zero browser warnings or errors. This was a local deterministic run, not a hosted-provider or deployed receipt.

GitHub readback confirmed that PR [#9](https://github.com/CUNY-AI-Lab/systems-mapping/pull/9) merged feature commit `e17142b7c4974a8db4fe02bcded47f0ce5ecf497` into `main` at `7f6444147d34a4c62203eb1a3943fcfd6c3f4491`; local, `origin/main`, and GitHub `main` matched that merge before deployment. PR [#3](https://github.com/CUNY-AI-Lab/systems-mapping/pull/3) and PR [#5](https://github.com/CUNY-AI-Lab/systems-mapping/pull/5) remain historical receipts for earlier implementations.

Existing browser journeys and screenshot archives document earlier workflows only. The last inspected rendered package is `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ecological-cycle-qa-2026-08-21/systems-mapping-ecological-cycle-qa-2026-08-21.zip` (SHA-256 `89f959144d0257a0a21d6440f7be3a37e50925f60adc7dd1687caeb246277c11`). It contains 40 browser-capture PNGs, 4 fabricated memo files, and 4 metadata/assertion files: all 15 states at 1440×1000 and 390×844, plus five map/Teacher states each at 320×812 and 430×932. Strict inspection found no truncation, overlap, overflow, console errors, or captured success toasts; recorded graph assertions include Micro at 6 nodes/0 connections, Meso reusing exact Micro IDs, a cumulative 21-node/19-connection map, and the post-authentication Teacher Console. No credentials are packaged. This package predates the 2026-08-22 map-interaction changes and is not current rendered evidence for them.

For the 2026-08-22 working tree, the automated suite, production build, diff-integrity check, and local source-built browser run above are current. The clean GitHub-to-Railway release, live migration, health, security-header, public-demo access, session/configuration, student-to-teacher denial, logout, exact-bundle, no-5xx, and `ollama-cloud` receipts apply to the 2026-08-21 release. They do not establish deployment or live behavior for the current local changes. Credential rotation provenance was not inspected and remains an operator responsibility.

- [Source ledger](./docs/SOURCE_LEDGER.md)
- [Requirements](./docs/REQUIREMENTS.md)
- [QA report](./docs/QA.md)
- [Security review](./docs/SECURITY_REVIEW.md)
- [Teacher control across both applications](./docs/EDUCATOR_RESOURCE_FRAMEWORK.md)
- [Release evidence ledger](./TODO.md)
- [August 13 reconciliation record](./docs/RECONCILIATION_2026-08-13.md)

The source ledger remains authoritative about provenance. The Maria and Zach Zoom material supplied on 2026-08-21 governs the current analytical progression and ecological-layer design. The fuller Drive specification governs compatible general behavior; the supplied HTML/DOCX guides interaction; CALI materials provide context; Zach's August 5 notes remain unconfirmed minutes; and STEM Splitter is an architecture precedent.
