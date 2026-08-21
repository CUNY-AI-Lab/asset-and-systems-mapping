> **Active beta.** Systems Mapping is under active classroom development.

# Systems Mapping

Systems Mapping supports place-based inquiry through one persistent map. Students revisit five workflow stages across four analytical levels: Part 1 groups Micro and Meso; Part 2 groups Exosphere and Macrosphere. Teacher Console lets instructors adapt guidance and course material for each Part and section. A language model can suggest Micro nodes, connections among carried Micro nodes at Meso, and ecological elements at Exosphere and Macrosphere. Students decide what to edit, accept, or reject.

Implementation is local-first. Project state stays in browser storage. Bounded evaluations, retained review records, teacher accounts, and shared course configuration live on classroom server in SQLite locally or PostgreSQL when hosted.

## Student workflow

- add your memo asks students to choose a level, upload a memo or paste its text, and optionally name the map
- review your memo calls the model when the student arrives: at Micro it proposes only nodes grounded in the memo; at Meso it receives the existing Micro node IDs and may propose connections among them
- choose nodes and describe connections lets students keep, edit, or remove suggestions; Micro shows node choices only, while Meso is the first level that asks students to describe and review connections
- build map asks students to arrange and annotate selected elements; Micro remains node-only, while Meso and later levels also let students work with reviewed connections
- revise and export asks students to reconsider their claims, record what changed, and decide what can be shared

The five stages are repeatable, and every stage and the map are directly available in every cycle. Part 1 contains Micro and Meso; Part 2 contains Exosphere and Macrosphere. Meso carries the same Micro nodes forward by stable ID, so adding connections does not duplicate them. Exosphere replaces the former Macro level; Macrosphere replaces the former Integration level. Those later levels use concentric ecological spheres that contain nodes and connections. Students may show all available spheres or isolate one without changing hidden graph records.

The memo stays available as a collapsed, editable drawer on every later stage. Editing it never removes candidates or map work; it marks the current guidance as ready to refresh. From Meso onward, students may describe how nodes connect or ask the model to work from the memo. The model never adds a connection automatically. Students can change both endpoints and the wording, then accept or reject each suggestion.

Generating guidance does not edit the memo or map. Every stage, level, and the map remain open regardless of a model response, instructor review, or outstanding evaluation. There is no course-wide ceiling on active preflight evaluations; expiration, rate limits, and provider-concurrency safeguards still apply. Per-session supersession and retention purges are unchanged in this pass.

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

**Course settings** follows the same five sections students revisit. Its compact controls show one Part and one section at a time. A saved guidance-and-material pair is shared by both levels in that Part: Micro and Meso share Part 1 settings, while Exosphere and Macrosphere share Part 2 settings. Level-specific runtime rules still apply, so Micro cannot produce connections and Meso cannot add nodes.

One published version governs new model requests. A teacher creates a draft from the published or an earlier version, saves changes with a note, previews the saved settings, and publishes it. **Preview level** supplies context for that preview; it does not select a separate saved configuration. The preview shows only the saved instructor guidance and course material, never the full effective prompt, code-owned guardrails, internal modules, or configuration fingerprints. Publishing retires the earlier version without erasing its history. Cloning an earlier version provides rollback without editing a published record in place.

Fixed evidence, privacy, output, and student-confirmation rules remain code-owned. The server still composes those rules from smaller internal parts, but it exposes no internal configuration matrix to the Teacher Console or its retired module endpoints. Ollama Cloud receives the published guidance and course material for the current section.

## Suggestion runtime

With a model enabled, it reads the memo under a level-specific contract. Micro returns grounded guidance and node proposals with zero connections. Meso receives the carried Micro node IDs, returns no new nodes, and may propose editable connections only among those IDs. Exosphere and Macrosphere may propose nodes, connections, and sphere placement within their defined scope. Without a model provider, the classroom server uses a built-in text review. It follows the same Micro and Meso boundaries, is reproducible, and sends nothing to an outside provider; it is not proof that a language model ran. Additional connection suggestions require a model provider and do not fall back to built-in rules.

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

- Browser `localStorage` holds the current student project, optional student/group name, stage, graph records, node positions, viewport, and node/relationship/map annotations. A retained compatibility review capability may be present in an older project, but the current student interface does not create a submission. The optional name appears with a project link so an instructor can identify the work; leaving it blank never blocks progress. Save failures preserve the in-memory project and offer recovery export.
- The classroom database holds teacher identities and sessions, course profiles and append-only profile events, code-owned base configuration, bounded prototype events, authoritative evaluations, review snapshots, and append-only decision events.
- Unsubmitted evaluations expire after 1 day. Pending review snapshots are retained for 30 days; decided snapshots for 180 days. Retention deletes snapshots that contain memo text and their decision rows, then keeps only a hashed, append-only purge receipt.
- Review and evaluation IDs are random bearer capabilities. Every portable export redacts both IDs. Student status responses are deliberately minimal and never return memo text, prompt content, configuration, or teacher identity.
- Canonical JSON preserves stable graph IDs, layout, viewport, annotations, and redaction manifests. CSV cells are neutralized against spreadsheet formulas.

## Hosted and Railway contract

The PostgreSQL-backed Railway service is reachable at [web-production-08455.up.railway.app](https://web-production-08455.up.railway.app). Deployment `39d38543-20ca-4626-95e6-237ef9213881`, built from clean `main` commit `abddbd0a2640aa0e4db0dcf0a1c47d65e9983597`, is historical evidence for the preceding four-level implementation. It does not verify this Micro/Meso/Exosphere/Macrosphere candidate. The current candidate still requires a fresh deployment and live verification. Hosted mode requires these server variables together:

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

Black, white, and gray remain dominant. Restrained accents identify Micro, Meso, Exosphere, and Macrosphere. Micro presents nodes without relationship lines. Meso adds readable connections among the carried nodes. Exosphere and Macrosphere use distinct concentric regions that hold graph elements and can be filtered without mutating the graph. Cards keep labels separate from icons and render every character. The UI uses modest editorial typography rather than oversized display copy.

## Evidence and authority

The 2026-08-17 baseline passed 171 tests with 3 PostgreSQL integration tests skipped, produced a successful build, and passed its recorded dependency and leakage scans. Those results predate the 2026-08-21 ecological-layer reversion and are not evidence for this candidate.

The 2026-08-21 candidate now has current local receipts. The ordinary suite passed 227 tests, with 4 PostgreSQL tests skipped behind their explicit environment guard. A fresh loopback PostgreSQL 17.5 run passed all 4 PostgreSQL tests, including migration of a populated v8 database to v9. `pnpm build` produced `index-DKxOo_cS.js`, `TeacherDashboard-CO55RhLk.js`, and `index-CisvqIv_.css`; `pnpm audit --prod` reported no known vulnerabilities; `git diff --check` passed; and gitleaks found no secret in the dirty diff or the three intended untracked documentation/concept files.

GitHub readback previously confirmed that PR [#3](https://github.com/CUNY-AI-Lab/systems-mapping/pull/3) merged an earlier production-aligned tree into `main` at commit `a4bdc0d` and PR [#5](https://github.com/CUNY-AI-Lab/systems-mapping/pull/5) merged the preceding five-stage implementation at `abddbd0a2640aa0e4db0dcf0a1c47d65e9983597`. Those receipts are historical. They do not show that the 2026-08-21 candidate is committed, pushed, or deployed.

Existing browser journeys and screenshot archives still document earlier workflows only. The current rendered evidence is `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ecological-cycle-qa-2026-08-21/systems-mapping-ecological-cycle-qa-2026-08-21.zip` (SHA-256 `89f959144d0257a0a21d6440f7be3a37e50925f60adc7dd1687caeb246277c11`). It contains 40 true PNGs, 4 fabricated memo files, and 4 metadata/assertion files: all 15 states at 1440×1000 and 390×844, plus five map/Teacher states each at 320×812 and 430×932. Strict inspection found no truncation, overlap, overflow, console errors, or captured success toasts; recorded graph assertions include Micro at 6 nodes/0 connections, Meso reusing exact Micro IDs, a cumulative 21-node/19-connection map, and the post-authentication Teacher Console. No credentials are packaged. The current design references remain `docs/concepts/ecological-layers-desktop-concept-2026-08-21.png` and `docs/concepts/ecological-layers-mobile-concept-2026-08-21.png`; they are concepts rather than substitutes for this rendered evidence.

Local automated, PostgreSQL, build, audit, leakage, and rendered screenshot gates are complete for the current working tree. The changed tree still must be committed and pushed to GitHub `main`, deployed to Railway, and read back live. A live provider run also remains separate and pending unless an authorized rotated server-only key is enabled. No local result should be presented as proof of those external gates.

- [Source ledger](./docs/SOURCE_LEDGER.md)
- [Requirements](./docs/REQUIREMENTS.md)
- [QA report](./docs/QA.md)
- [Security review](./docs/SECURITY_REVIEW.md)
- [Teacher control across both applications](./docs/EDUCATOR_RESOURCE_FRAMEWORK.md)
- [Release evidence ledger](./TODO.md)
- [August 13 reconciliation record](./docs/RECONCILIATION_2026-08-13.md)

The source ledger remains authoritative about provenance. The Maria and Zach Zoom material supplied on 2026-08-21 governs the current analytical progression and ecological-layer design. The fuller Drive specification governs compatible general behavior; the supplied HTML/DOCX guides interaction; CALI materials provide context; Zach's August 5 notes remain unconfirmed minutes; and STEM Splitter is an architecture precedent.
