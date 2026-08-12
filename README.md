> **Active beta.** Systems Mapping is under active classroom development.

# Systems Mapping

Systems Mapping is a resource mapping application for place-based methods of ethnographic inquiry and conceptualization. The tool spans a seven-stage student learning process with a Teacher Console for instructors to customize situated applications of an open-weight language model to support asset and systems mapping among undergraduate learners.

The implementation is local-first. Student work remains in the browser while user records and shared prompt configurations live on the classroom server in SQLite locally or PostgreSQL if hosted on the cloud.

## Student workflow

1. **Choose a scale** — choose the current micro, meso, macro, or integration release.
2. **Add a source** — import or paste a memo and complete its source record.
3. **Review suggestions** — read at most three short prompts that return you to source evidence, then add a note for the instructor.
4. **Check your instructor's response** — wait for and explicitly refresh the instructor decision.
5. **Choose what to map** — after approval, accept, edit, defer, or reject proposed nodes and relationships.
6. **Build the map** — move and annotate nodes and relationships, pan or zoom the canvas, and inspect the legend.
7. **Revise and export** — record a reflection and export JSON, CSV, or Markdown with provenance.

Generating suggestions does not edit the memo or graph. The pedagogical guidance exposed to the student contains only the short source prompts—never criterion IDs, scores, outcomes, or the full model review. Sending for review consumes a one-time server evaluation and creates a pending snapshot. The student cannot choose what to map until a teacher selects **Approve** or **Approve with a question**. **Reject** returns the student to **Add a source** without silently changing local work.

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

The Teacher Console opens on **Review submissions**. Its queue loads before course settings. Selecting one submission reveals the memo and student note. Full criteria and scores remain teacher-only and closed by default behind **Model review details**. The instructor writes one focus for the student, then chooses **Approve**, **Approve with a question**, or **Reject**. The middle choice also requires one question. Optimistic revisions prevent stale decisions, and accepted decisions append an immutable review event.

**Course settings** follows the same seven stages students see. A teacher opens one stage at a time and writes how the model should guide that stage, then may paste course material the model can draw on. The prompt includes the current stage and the stages already completed in their original order. Later stages stay out of the request. Course material enters the prompt as reference content rather than a competing instruction source.

One published version governs new model requests. A teacher creates a draft from the published or an earlier version, saves changes with a note, previews the saved prompt by stage and scale, and publishes it. Publishing retires the earlier version without erasing its history. Cloning an earlier version provides rollback without editing a published record in place.

Fixed grounding, privacy, schema, and student-confirmation rules remain code-owned. The server still composes those rules from smaller internal parts, but it exposes no internal configuration matrix to the Teacher Console or its retired module endpoints. Deterministic STEM Splitter records the published version and active stage as provenance without changing its fixed score. Ollama Cloud receives the published guidance and course material for the relevant stretch of the progression.

## Suggestion runtime

With Ollama disabled, the classroom server runs the deterministic **STEM Splitter** evaluator. It applies fixed H1–H4 and C1–C8 rules with a six-of-eight threshold. Those criteria and scores are available only to the teacher inside the collapsed model-review details. The server projects no more than three short, source-directed prompts to the student. Teacher prompt edits and project instructions are recorded as configuration provenance but do not change deterministic scoring. This mode is reproducible and has no model-provider egress; it is not proof that a language model ran.

Ollama Cloud is explicit opt-in:

```dotenv
OLLAMA_ENABLED=true
OLLAMA_API_KEY=<fresh-rotated-server-only-key>
OLLAMA_CLOUD_URL=https://ollama.com
OLLAMA_MODEL=gpt-oss:20b
```

When enabled, the server sends the published guidance and course material through the student's current stage, bounded project instructions, inquiry, scale, source metadata, and memo text to Ollama Cloud. Source text is limited to 131,072 UTF-8 bytes and the inquiry to 8,192 UTF-8 bytes. Provider output must satisfy the exact H1–H4/C1–C8 JSON schema; malformed, oversized, or unavailable provider responses fail with a generic error and do not silently fall back to deterministic scoring.

The credential previously pasted into chat must be treated as exposed. It has deliberately not been placed in the local `.env` or Railway. Revoke it and configure a newly rotated key before enabling Ollama Cloud. Never prefix `OLLAMA_API_KEY` with `VITE_` or otherwise expose it to client code.

## Persistence and retention

- Browser `localStorage` holds the current student project, stage, graph records, node positions, viewport, node/relationship/map annotations, and the private capability needed to refresh an instructor response. Save failures preserve the in-memory project and offer recovery export.
- The classroom database holds teacher identities and sessions, course profiles and append-only profile events, code-owned base configuration, bounded prototype events, authoritative evaluations, review snapshots, and append-only decision events.
- Unsubmitted evaluations expire after 1 day. Pending review snapshots are retained for 30 days; decided snapshots for 180 days. Retention deletes source-bearing snapshots and decision rows, then keeps only a hashed, append-only purge receipt.
- Review and evaluation IDs are random bearer capabilities. Every portable export redacts both IDs. Student status responses are deliberately minimal and never return source text, prompt content, configuration, or teacher identity.
- Canonical JSON preserves stable graph IDs, layout, viewport, annotations, and redaction manifests. CSV cells are neutralized against spreadsheet formulas.

## Hosted and Railway contract

The PostgreSQL-backed Railway service is live at [web-production-08455.up.railway.app](https://web-production-08455.up.railway.app). Public-demo deployment `3e7210a0-33a4-4a2e-8d26-b15508c8c5ab` reached `SUCCESS`; `/api/health` returned `{"status":"ok"}`, the expected hardening headers and Secure cookie attributes passed readback, and class code `101` created a course-server session that was then closed. Maria's teacher login also passed and its verification session was closed. Ollama remains disabled and no provider key is installed. Hosted mode requires these server variables together:

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

The current active-beta tree passed 146 tests with 3 PostgreSQL-gated skips; the server group passed 60 tests with the same 3 integration gates. It produced a successful production build, and the production dependency audit reported no known vulnerabilities. Source and application-bundle scans found no credential values; the application bundle contains no local class code, source maps, dangerous HTML sink, teacher identity, review capability, or server prompt. Numeric `101` values found in a library bundle belong only to unrelated glyph tables.

GitHub readback confirmed that PR [#3](https://github.com/CUNY-AI-Lab/systems-mapping/pull/3) merged the production-aligned tree into `main` at commit `a4bdc0d`. The tracked publication excludes environment files, databases, local state, screenshots, and test fixtures.

The disposable browser journeys verified the source-return prompts, collapsed **Model review details**, **Approve with a question**, the instructor focus and question, and the candidate → map → revision flow. A fresh progression-editor journey verified create → save → preview → publish, the current/completed-stage prompt boundary, and all seven stage controls. A separate four-viewport recapture verified the current Course settings editor at 320, 390, 430, and 1440 px with no document overflow or browser warnings/errors. The original 50-PNG archive remains at `/Users/milwright/.codex/visualizations/2026/08/08/019fe2ef-096c-7093-b898-9a6e64ef1b23/systems-mapping-app-all-views-2026-08-11.zip`; the current Course settings recapture is archived at `/Users/milwright/.codex/visualizations/2026/08/11/019ff16f-b119-7963-9090-525be49b8d8a/systems-mapping-course-settings-2026-08-11.zip`. Both pass `unzip -t`.

Simple **Approve**, **Reject**, reload/export restoration, and live Ollama execution remain active-beta follow-up rather than claims of this deterministic release.

- [Source ledger](./docs/SOURCE_LEDGER.md)
- [Requirements](./docs/REQUIREMENTS.md)
- [QA report](./docs/QA.md)
- [Security review](./docs/SECURITY_REVIEW.md)
- [Teacher control across both applications](./docs/EDUCATOR_RESOURCE_FRAMEWORK.md)
- [Release evidence ledger](./TODO.md)

The source ledger remains authoritative about provenance: the fuller Drive specification governs behavior; the supplied HTML/DOCX guide interaction; CALI materials provide context; Zach's August 5 notes remain unconfirmed minutes; and STEM Splitter is an architecture precedent. No Maria-specific Zoom summary was found, so none is represented as a confirmed design decision.
