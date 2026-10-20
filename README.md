# Systems Mapping

> **Active beta.** Systems Mapping is under active classroom development.

Systems Mapping helps students turn a place-based inquiry into an evidence-informed account of people, settings, institutions, and broader conditions. Students build one cumulative map, revisit their interpretations, and explain how connections operate across four ecological levels. The map, supporting evidence, and revision notes form a record of their reasoning.

The prototype combines a guided student workspace with a Instructor Console for course guidance and materials. Model assistance is optional: students decide which suggestions belong on the map and can complete every stage through their own reading and analysis. Projects save in the current browser; a classroom server manages access, course settings, and bounded evaluation records.

A separate [Cloudflare version](./docs/cloudflare-deployment.md) adds CUNY Login,
private account maps, browser recovery copies, and CAIL Gateway model requests.
It shares the existing map and teaching workflows, with independent storage.
The Node/Railway version and its saved data remain in place. Source checks and
release acceptance are recorded [separately](./docs/CLOUDFLARE_ACCEPTANCE_2026-09-23.md).

## Learning model

The course develops one inquiry through two Parts. Each level adds a distinct form of analysis while retaining earlier work by stable reference.

| Part | Level | Analytical focus | Map representation |
| --- | --- | --- | --- |
| 1 | Micro | People, roles, activities, objects, and immediate settings relevant to the focal person or group. | Discrete elements with separately described direct relationships. Non-setting elements can identify the immediate settings in which they appear. |
| 1 | Meso | How two or more of the focal person's immediate settings interact. | Named mesosystems linked to at least two existing Micro settings. The settings remain in place and retain their original IDs. |
| 2 | Exo | Decisions made in outside settings that indirectly affect the focal person or group. | Outside decision settings with pathways into mapped Micro settings. |
| 2 | Macro | Laws, policies, economic conditions, histories, beliefs, and structures that shape the system. | Broader conditions scoped to at least two earlier map elements. |

The interface labels the later levels **Exo-level** and **Macro-level**; project records use `exosphere` and `macrosphere`. Meso and Macro scope links identify inclusion or influence without creating directional relationship edges. A named institution belongs at Exo-level; a policy or structural condition belongs at Macro-level.

Evidence remains distinct from interpretation. Students can record a source passage, their claim and reasoning, uncertainty, counterevidence, and missing perspectives. Micro and Exo relationships can also describe frequency, duration, direction, conditions, and change over time. The application checks references and required structure; students remain responsible for the strength of the explanation.

### Community assets and wider systems

Asset mapping gives this inquiry a practical starting point: residents' skills, local knowledge, associations, gathering places, and organizational resources. Students can examine how these capacities connect, who can access them, and what residents want to change. The Exo and Macro levels extend that inquiry to outside decisions and structural conditions. This framing draws on [“What is Asset Mapping?” (Social Design Notes, 2004)](https://backspace.com/notes/2004/06/what-is-asset-mapping.php), supplied as a copy reference. The prototype's ecological levels continue to govern how those observations enter the map.

## Student experience

The Cloudflare sign-in page shows the title, the four levels and **CUNY Login** a third of the way down, with a generative drawing after A. Michael Noll's *Gaussian Quadratic* (Bell Labs, 1965) filling the space below (`src/NollSketch.jsx`). The drawing is transparent against the page, takes the current ink colour in light and dark mode, and redraws every ten seconds or on click.

The workspace has two views: **Map** and **Notebook**. The five stage records (`add-source`, `review-suggestions`, `choose-what-to-map`, `build-map`, `revise-and-export`) remain per level for instructor aggregates, submitted revisions and exports. Switching views preserves map position and writing and makes no model request. Opening Notebook after building the map opens Field Notes directly.

| Surface | What it does |
| --- | --- |
| **Add memo** | Set the inquiry and paste or upload the memo. |
| **Work level** | One selector for Micro, Meso, Exo and Macro, with completed and locked states. |
| **Map** | Canvas, direct selection and a collapsed **Map tools** menu for search, layers, list, zoom, arrange, key and full screen. |
| **Notebook** | One current task: memo and suggestions, or Field Notes. A compact selector changes the writing task. Selecting a map item opens only that item’s interpretation; the memo appears only with suggestions. |
| **Field Notes** | One required response per scale about gaps in the current map, further observation, and the next scale. The Instructor Console publishes editable questions under Micro, Meso, Exo, and Macro. Existing answers remain intact; notes from other scales are collapsed for reference. |
| **Project** | Projects, progress, export/share and preferences. Automatic suggestion addition is a preference here. |

The notebook contains the current next action. The compact footer only switches **Map / Notebook**. Before the first memo read, only the reading action is shown; the continuation appears after a valid response. The first memo reading is explicit; completing a level starts the next level's reading in the same click. The existing automatic-add preference determines whether validated suggestions enter the map immediately or await individual decisions.

Field Notes are required to complete a scale; students can return to Map at any time. They use the existing immediate draft journal and per-scale project saves. A separate historical recovery cache is [proposed](docs/field-notes-recovery-proposal.md), not implemented.

Instructors customize the question from **Instructor Console → Course settings → Edit prompts**. Choose a scale, connect the prompt to the lesson's case or reading, optionally open Student preview, then Publish changes. Draft creation and saving are handled within that flow; version history and model settings remain collapsed. See [instructor settings](docs/instructor-settings.md).

### Map Check

Map Check asks the course model to reason over the map the student has built, not to reread the memo. Students can request **Check this item** or **Check this connection** inside its editing details. The general “Ask the map” panel has been removed. Each returns at most four short notes tied to map IDs, commits nothing, and runs as one attempt with the same course prompt appendix, limits and support IDs as memo guidance. Choosing an item in a note highlights it on the canvas.

## Working with the map

The canvas uses concentric ecological regions and restrained level colors. **All layers** shows cumulative work; the layer selector isolates one level without deleting hidden records. **List** provides an alternative way to inspect map items.

Selecting an element opens its inspector. On desktop the whole layer stays on the canvas: the selection and its one-hop neighbourhood stay bright, every incident relationship shows its label, and everything else dims until **Show full map**. Phones keep the compact detail view that shows one relationship at a time. **Connections across map** expands into recorded direct relationships, immediate-setting memberships, mesosystems, and broader conditions. Students can follow these connections in either direction. Following a connection into a hidden level reveals the full map; **Back** returns to the previous item and layer view. **Find** searches live elements across every level, including hidden layers.

The map fills the available browser height. On wide screens, the Notebook is a narrow resizable dock (260–360px). Drag its left edge or use the focused divider's arrow keys; Home restores the default width. Text and controls wrap as it changes. At 1100px and below, Notebook occupies the workspace while the mounted map is hidden. **Map** restores the canvas and its view.

Selecting an item opens its interpretation in Notebook. Only connected items and editing details follow the interpretation field. Repeated statistics, target tabs, generic instructions and the separate Map notes task are removed. Existing map notes remain editable under **Saved map note** in Field Notes; their draft recovery and persistence remain intact. **Done** returns focus to the selected canvas item or list control.

| Task | Control |
| --- | --- |
| Move around the map | Drag empty canvas, use a middle-button drag, or focus the canvas and hold Space while dragging. Arrow keys pan a focused canvas. |
| Zoom | Scroll at the pointer, pinch on a touch screen, or use the zoom buttons. `+` and `−` zoom a focused canvas. |
| Move an element | Drag the element. |
| Restore an overview | Choose **Fit map** or press `0` with focus in the canvas. |
| Reorganize the layout | Choose **Arrange map**. |
| Undo or redo a layout change | Use `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` with focus in the canvas. |
| Expand the workspace | Choose **Full screen map**; press `Escape` to exit. |

Layout history covers element moves and automatic arrangements during the current map visit. Undo restores positions and the recorded view while preserving evidence, labels, and notes edited afterward. It is not a general project-history rollback. Layout, viewport, and annotations save with the project; the undo stack is temporary.

The application prevents removal or reclassification of an element while another relationship, membership, or scope depends on it. It identifies the dependent work so students can resolve those references explicitly.

## Saving and sharing

Projects save to browser `localStorage`, including the memo, candidates, graph, evidence, annotations, per-level progress, layout, and viewport. This storage belongs to the current browser and device. A classroom server does not provide automatic synchronization of the student project. Export JSON to keep a portable backup or move work to another browser.

In the Cloudflare version, projects also save to the signed-in account using
optimistic revisions. An unsynced browser copy is preserved when a save fails
or another session changes the map. Explicit project links keep their existing
sharing, expiry, and revocation behavior and reopen after CUNY sign-in.

Exports live behind the **Project → Export & share** dialog, with the format options initially collapsed, grouped as *Show the map* (PNG, PDF, project link) and *Save or reuse* (JSON, CSV, Markdown, import). **Prepare copy for** selects an audience within the course's sharing limit. Export rules apply to all formats:

- **JSON** preserves a reopenable project with stable IDs and layout, subject to the selected audience's redactions. Import validates the file before replacing the open project.
- **CSV** supports spreadsheet analysis of graph records and neutralizes cells that could be interpreted as formulas.
- **Markdown** provides a readable account for review and discussion.

Exports include the cumulative graph across levels. Portable copies remove evaluation and review bearer capabilities and include redaction metadata. If browser storage fails, the current in-memory project remains available with a recovery export. Project schema v7 supports migration of v1–v6 projects.

## Run locally

Requirements: **Node.js 22.5 or newer** and **pnpm 11**. The repository pins pnpm in `package.json`.

Installation requires read access to the pinned `@cuny-ai-lab` packages on
GitHub Packages. Configure that scope and an installation token outside the
repository; never commit the token. CI uses its workflow token during installation.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm server
```

Open `http://127.0.0.1:4177` and enter class code `101`. Local mode binds to `127.0.0.1` and creates `data/systems-mapping.sqlite`. The class code opens the workspace; it does not identify an individual student.

For frontend development, run these commands in separate terminals:

```bash
pnpm server:dev
```

```bash
pnpm dev
```

The server loads optional settings from `.env`. Use [`.env.example`](./.env.example) as the configuration reference. Model providers are disabled by default, so the local workflow can be evaluated without external model access.

## Instructor Console

Teachers manage guidance and course material by **Part** and **stage**. Micro and Meso share Part 1 settings; Exo and Macro share Part 2 settings. The runtime still applies the distinct analytical rules for each level.

Course settings are versioned. A teacher creates a draft from an existing version, saves changes with a note, previews the saved guidance and material, and publishes it. One published version governs new model requests. Publishing preserves earlier versions, and cloning a previous version provides a rollback path. **Preview level** supplies analytical context for a preview; it does not create a separate saved configuration.

Evidence, privacy, output validation, and student-confirmation rules remain controlled by the application. The preview exposes instructor-authored guidance and materials without exposing internal prompts or configuration fingerprints.

The Console opens on **Review submissions**. The current student interface does not create submissions for this queue; it supports retained records and the compatibility review API. Review actions provide asynchronous feedback without editing the student's map or controlling access to stages.

Fresh databases seed unclaimed accounts for Maria Mavrides Calderon and Zach Muhlbauer. There are no default passphrases. An operator can set a temporary, server-only `SYSTEMS_MAPPING_TEACHER_BOOTSTRAP_TOKEN` of 16–256 characters to authorize one account claim per server process. Claiming another account requires a fresh token and restart. The command below creates an account-bound password-reset link valid for 30 minutes and one use:

```bash
node server/create-password-reset.js <teacher-account-id>
```

Resetting a passphrase revokes that account's existing sessions. Passphrases use scrypt derivation; teacher sessions use random `HttpOnly`, `SameSite=Strict` cookies.

## Optional model assistance

With no provider enabled, the server performs a reproducible built-in text review and sends nothing to an external model. This mode is suitable for checking the workflow but does not establish model performance. Additional relationship suggestions require a live provider.

Ollama Cloud is the first provider when enabled. OpenRouter can serve alone or provide a backup for retryable provider failures. Both require explicit server configuration. The following Ollama settings illustrate the setup; select a model supported by the configured provider:

```dotenv
OLLAMA_ENABLED=true
OLLAMA_API_KEY=<server-only-key>
OLLAMA_CLOUD_URL=https://ollama.com
OLLAMA_MODEL=gpt-oss:20b
OLLAMA_TIMEOUT_MS=90000
OLLAMA_MAX_OUTPUT_TOKENS=8192
```

For OpenRouter, set `OPENROUTER_ENABLED=true`, `OPENROUTER_API_KEY`, and `OPENROUTER_MODEL`; optional URL, timeout, token, and reasoning settings are documented in [`.env.example`](./.env.example). Keep all provider credentials server-side and outside version control. Never expose them through `VITE_` variables.

Model requests include the active section's published guidance and material, bounded project instructions, inquiry, analytical level, and memo. Memo text is limited to 131,072 UTF-8 bytes; the inquiry is limited to 8,192 bytes. Students review the transfer disclosure before requesting guidance.

Responses must satisfy the level-specific structured contract. Meso and Macro responses contain scoped nodes without relationship edges. With both providers enabled, retryable provider failures can invoke OpenRouter; input-shaped failures do not trigger that backup. Runtime metadata records which provider served the request. Invalid or unavailable model responses return an error and never silently switch to built-in text review.

## Architecture and operations

| Component | Responsibility |
| --- | --- |
| React and Vite client (`src/`) | Student workflow, browser project library, map interaction, evidence editing, and portable exports. |
| Shared contracts (`shared/`) | Canonical stages, ecological levels, and educator-resource rules used across client and server. |
| Hono server (`server/`) | Class access, teacher accounts, course configuration, validated model requests, and retained review records. |
| SQLite / PostgreSQL | Classroom persistence: SQLite locally and PostgreSQL in hosted mode. |
| Vitest / Playwright (`src/`, `server/`, `tests/e2e/`) | Domain and API checks, rendered student journeys, and automated accessibility scans. |

### Hosted configuration

Hosted mode requires these server settings together:

```dotenv
DATABASE_URL=<postgres-connection-string>
PUBLIC_ORIGIN=https://<public-host>
HOST=0.0.0.0
TRUST_PROXY_HOPS=1
SYSTEMS_MAPPING_CLASS_CODE=<private-class-code>
```

Set the trusted proxy count to match the actual hosting topology. Private class codes must contain 10–32 characters with at least six distinct characters. A public teaching demo explicitly uses `SYSTEMS_MAPPING_PUBLIC_DEMO=true` with `SYSTEMS_MAPPING_CLASS_CODE=101`. A shared code provides class access, not student identity.

Hosted mode uses secure cookies and enforces public-origin checks, rate limits, retention, provider concurrency, and review-queue bounds. PostgreSQL SSL, pool size, and connection, idle, statement, and transaction timeouts are configurable in [`server/index.js`](./server/index.js). Startup initializes the persistence layer; `pnpm db:migrate` is also available to operators.

### Server data and retention

The classroom database stores teacher accounts and sessions, course configuration and its history, bounded evaluations, retained review snapshots, and decision events. Unsubmitted evaluations expire after one day. Pending review snapshots are retained for 30 days; decided snapshots for 180 days. Purges remove snapshot content and decisions while retaining a hashed receipt.

Optional workflow evaluation uses fixed categories for task, completion, explanation, revision quality, and recovery. Reports expose aggregate counts. They exclude memo text, map labels, annotations, prompts, capabilities, identities, row-level observations, sessions, and timestamps.

## Verification and project records

```bash
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm test` includes client, shared-contract, and server tests; `pnpm test:server` runs the server subset. Live PostgreSQL integration tests require a dedicated disposable database through `TEST_POSTGRES_URL` and are skipped when it is absent. The Playwright suite starts an isolated local server with a temporary SQLite database and disabled model providers, then tests desktop and phone viewports. `pnpm test:a11y` runs the dedicated accessibility suite.

Local tests establish behavior for the tested source and environment. They do not establish hosted deployment status, live model quality, or complete accessibility conformance. Release-specific receipts and historical screenshots belong in the project records below; older receipts should be read against their recorded commit and date.

- [Requirements](./docs/REQUIREMENTS.md) — product and workflow requirements.
- [Source ledger](./docs/SOURCE_LEDGER.md) — source provenance and authority.
- [QA report](./docs/QA.md) — recorded validation and scope.
- [Security review](./docs/SECURITY_REVIEW.md) — security design and review evidence.
- [Educator resource framework](./docs/EDUCATOR_RESOURCE_FRAMEWORK.md) — teacher control across applications.
- [Release evidence ledger](./TODO.md) — release work and historical receipts.
- [August 13 reconciliation](./docs/RECONCILIATION_2026-08-13.md) — earlier reconciliation decisions.

The source ledger governs provenance. The August 24, 2026 correction governs the Micro/Meso boundary; compatible August 21 decisions govern the four levels and ecological-layer design. The fuller Drive specification governs compatible general behavior, the supplied HTML/DOCX informs interaction, and CALI materials provide context. Zach's August 5 notes remain unconfirmed minutes; STEM Splitter is an architecture precedent.
