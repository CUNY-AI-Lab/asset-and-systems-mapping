# Systems Mapping

> **Active beta.** Systems Mapping is under active classroom development.

Systems Mapping helps students visualize their memos as one cumulative network of people, settings, institutions and broader conditions. The account workspace uses two independent memos, four analytical steps and three nested regions: Microsystem inside Exosystem inside Macrosystem. The model identifies a small supported node set; students create every relationship.

The [Cloudflare account application](docs/cloudflare-deployment.md) uses CUNY Login, private account maps, browser recovery copies and CAIL Gateway model requests. The separate Node/Railway application retains its older review interface and independent storage. Neither its data nor its deployment is migrated by account-interface changes.

The current account design is specified in the [Memo workspace wireframe](docs/MEMO_WORKSPACE_2026-11-04.md) and [two-memo workflow](docs/TWO_MEMO_WORKFLOW_2026-11-04.md). These describe the implementation contract; a source change or passing test does not establish that a feature is live. Dev inspection, screenshots and production readback are separate release steps.

The [current release receipt](TODO.md#exo-validator--november-6-2026) and [verification record](docs/exo-validator-release-2026-11-06.json) separate source checks, deployed bytes, live model acceptance and screenshot provenance.

## Learning model

| Part | Step | Analytical focus | Map representation |
| --- | --- | --- | --- |
| 1 | Micro | People, roles, activities, objects and immediate settings relevant to the focal person or group. | Evidence-supported nodes in the Microsystem. |
| 1 | Meso | Relationships among those local elements and settings. | Student-created, named directional arrows between the same Micro nodes. |
| 2 | Exo | Concrete policies and laws, and outside settings whose decisions affect the focal participants without their direct participation in that setting. | Exo nodes and student-created connections to local relationships. |
| 2 | Macro | Independently evidenced cultural, ideological, historical and economic conditions shaping the mapped settings and relationships. | Macro nodes and student-created links or groups identifying what they affect. |

Classification depends on the focal participants and the pathway of influence, not the presence of a proper noun or the size of an organization. A named institution can be an immediate Micro setting or an outside Exo setting. A person or institution alone is not a Macro condition. Meso uses the Micro map space; it is not a fourth region. Stable internal level IDs remain `micro`, `meso`, `exosphere` and `macrosphere`.

Evidence remains distinct from interpretation. Students can record a source passage, reasoning, uncertainty, counterevidence and missing perspectives. Connections can record direction, frequency, duration, conditions and change over time. Structural validation does not certify the interpretation.

Asset mapping starts from residents' skills, local knowledge, associations, gathering places and resources. Exo and Macro extend the inquiry to outside decisions and structural conditions. The supplied [“What is Asset Mapping?” reference](https://backspace.com/notes/2004/06/what-is-asset-mapping.php) informs that framing; the ecological classification contract determines placement.

## Student experience

Projects begins with a two-field creation form: **Project title** and **Creator name**. The creator can be a person or group and may be prefilled from the account profile; it never replaces the project title. A blank title becomes **Untitled systems map**. Saved rows show the existing title and creator, and search matches either. Opening a saved project preserves both. **Project → Project details** edits those same two fields for an existing map.

Opening a project shows the canvas immediately. A new project emphasizes **Memo** at the top right without stealing focus. An existing project retains its map, camera, step and drafts. The three sidebar controls are **Memo · Notebook · Tools**, with the active view marked by an underline; switching them makes no model request. **Hide** collapses the resizable sidebar while keeping those controls available.

| Surface | Purpose |
| --- | --- |
| **Memo** | Select Part 1 or Part 2, upload or edit its independent source, then submit or **Update map** from the top action. |
| **Notebook** | Move through Micro → Meso → Exo → Macro, edit nodes and relationships, and write optional Field Notes. |
| **Tools** | Search, layers, list, map key, zoom, fit, arrange and full screen in the same sidebar. |
| **Project** | Return to Projects, edit Project title and Creator name, and export/share. |

**Continue** stays at the top. Its only required checkpoint is a successful memo-to-nodes submission for the current part, including a valid empty result. Notes, relationships and review screens are not prerequisites. Continue never generates relationships or silently starts another paid model request. The second memo begins empty; the retained graph supplies context without becoming the second editor's content. The redundant private-information checkbox is removed; existing sensitive memos without consent retain their permission control. Edited sources show “Memo changed | click Update map to submit”.

Submitting a memo places supported nodes on the map. Each response is limited to six nodes; Part 2 returns any mix of Exo and Macro nodes within that limit. Subsequent meaningful edits use the last successful baseline for that same memo and request a small update. Unchanged, whitespace-only and bibliography-only edits do not require paid regeneration. Updates preserve student labels, classifications, colors, evidence edits, notes, positions, relationships and removals. A failed, stale or cancelled response leaves the map and draft intact.

Corrective model requests retain bounded context for proposals that already passed source and identity checks. Each complete replacement is validated again before it reaches the map; this context never adds nodes automatically. The focused repair preserves the existing memo contract rather than restricting acceptable subjects to the test examples. On Dev, **Memo → Load CUNY AI Lab About** loads the public About text into the selected memo draft. Loading does not submit the memo or generate nodes; the control is hidden on production.

A previously successful Part 1 baseline satisfies the initial Part 2 prerequisite even if Part 1 later has an unsubmitted edit. The active part’s pending edit still requires Update map before its own Continue, but it cannot lock an independently completed Part 2. Returning between memos preserves both drafts and never regenerates them automatically.

**Back** revisits workspace views without reverting edits. **Undo/Redo** restores saved content changes independently and remains available after reload. Field Notes are optional and preserve earlier writing. The separate [historical recovery-cache proposal](docs/field-notes-recovery-proposal.md) is not an implemented recovery mechanism.

Instructors publish the optional Field Notes questions through **Instructor Console → Course settings → Edit prompts**. Prompt publication does not replace student answers or change progression requirements; see [instructor settings](docs/instructor-settings.md).

An **Information** icon immediately left of the bug-report control opens a light, nonmodal introduction with two how-to sentences. It closes after 12 seconds, pauses while hovered or focused, dismisses on Escape or outside interaction and can always be reopened. It never steals focus. The footer links the Critical AI Literacy Institute and CUNY AI Lab.

The report dialog accepts bugs and feature requests. Dev and production configuration select direct private Redmine tickets, with no email fallback for new reports; a missing key fails closed. See [report delivery](docs/bug-reports.md) for guest identity, retries and receipt recovery. Configuration is separate from verified live ticket acceptance.

## Working with the map

The course places concrete policies/laws and outside offices at Exo; Macro contains independently evidenced cultural, ideological, historical and economic conditions. See [classification evidence](docs/CLASSIFICATION_EVIDENCE_2026-11-04.md). Existing maps are preserved, and students can correct classifications in Notebook.

Content-fitted ecological regions appear cumulatively: Micro only, Micro + Exo, then all three nested regions. They accommodate uneven geometry while reserving the most space for local work. Auto-fit places unpinned Exo and Macro cards around the retained Micro map according to the available canvas, including space above and below. Saved manual positions remain exact; opening or resizing a map does not rewrite them. Labels and line patterns supplement colors. Relationship wording stays attached to its own route; auto-fit separates cards, labels and shared route segments, with visible separation at unavoidable crossings. Filtering hides records without deleting them.

With auto-fit on, an active Exo or Macro move from a valid position stops before entering its preceding sphere, along the requested path. Valid moves keep their chosen position. Existing imported placements are preserved; **System** changes classification. Turning auto-fit off uses saved coordinates and removes this movement constraint.

The sidebar keeps map context visible. Controls retain 44px targets with compact 13–14px labels, readable 14px body text and distinct primary and secondary actions. Tools puts Add item and Map key first, followed by adjacent zoom controls and Fit map; the sidebar supplies its only scrollbar. The Systems Mapping header stays visible at narrow widths. Narrow screens retain canvas context above the scrolling panel and 44-pixel touch targets. Selecting a node opens its label, evidence, classification, color and interpretation. The **On map** status is distinct from the stateful **Remove** action; Add to map and Remove never appear together for a node. Evidence is labeled **Quote from memo**, with the relevant item name bolded inside unchanged quoted text. A single compact item header places the smaller status below its name, followed by equal-width Remove/Add to map and Done buttons. No visible Edit heading repeats the purpose of the fields. The account List uses single-line records in its own horizontal scroller, contained within the map area.

| Task | Control |
| --- | --- |
| Move around the map | Drag empty canvas, use a middle-button drag, or hold Space while dragging. Arrow keys pan a focused canvas. |
| Zoom | Scroll at the pointer, pinch, use zoom controls, or press `+` / `−` with canvas focus. |
| Move a node | Drag the node or use arrow keys while it is focused. Auto-fit keeps an outer node outside its preceding sphere; saved manual positions persist. |
| Connect existing nodes | Double-click a source (keyboard Shift+Enter), or choose **Connect from [node name]**, then choose the target and name the relationship. From an Exo or Macro node the target can also be a local relationship line. |
| Create a connected node | Start from a source, click empty canvas (keyboard N), name the new node and relationship, then save both together. Cancel or Escape creates neither. |
| Add a node in a level | Double-click empty canvas inside that level's region; the form opens with the level preset and the node keeps that spot. |
| Correct classification | Change System and Type; save while preserving identity, evidence and connections. Incompatible dependencies require explicit repair. |
| Change node color | Choose Automatic, Blue, Teal, Purple, Amber, Rose or Slate. Color changes appearance only, never classification. |
| Restore the overview | Choose **Fit map** or press `0` with canvas focus. |
| Reorganize the layout | Choose **Arrange map**. |
| Reverse an edit | Use saved **Undo/Redo** controls; Back changes the view rather than content. |
| Expand the workspace | Choose **Full screen map**; Escape exits. |

Node and relationship wording uses explicit Save/Cancel. Blur and selection changes never commit a draft. Text changes do not request a new layout; full labels wrap rather than being clipped. Removing the current connection source cancels connection mode. New connections are committed only after the student supplies their wording; the model does not supply them.

## Saving and sharing

In the local Node/Railway version, projects save to browser `localStorage`, including the memo, candidates, graph, evidence, annotations, per-level progress, layout, and viewport. This storage belongs to the current browser and device; its classroom server does not synchronize the student project. Export JSON to keep a portable backup or move work to another browser.

In the Cloudflare version, projects also save to the signed-in account using
optimistic revisions. An unsynced browser copy is preserved when a save fails
or another session changes the map. Explicit project links keep their existing
sharing, expiry, and revocation behavior and reopen after CUNY sign-in.

When the last verified institutional grant expires, the workspace preserves
pending memo and annotation drafts and shows **Checking sign-in…** while
requesting a current Systems grant. A valid grant restores the work. Missing
or rejected access keeps the workspace paused; an unavailable check offers
**Try again**. Returning to a paused page can also recheck access without a
reload. Recognized identity
alone does not replace the account and course authorization check.

Select a node or relationship and press **Delete** or **Backspace** to remove it. Removing a node also removes its attached lines. Groups keep their remaining relationships. **⌘/Ctrl+Z** restores the entire edit; **⌘/Ctrl+Shift+Z** redoes it. Saved history survives reopening the project. Text fields keep their normal editing shortcuts. With the canvas focused, press **?** for the Map key, **/** to find a node, or **0** to fit the map.

Choose **File format** and then **Download** in Project → Export & share, on the finished map, or under Private exports in Projects. When the account and device copies differ, **Saved copy** selects which version to download without changing either. **Project link** and **Import JSON** remain separate actions:

- **PNG, PDF and SVG** show the cumulative map with the positions, colors, relationship wording, direction marks and groups used on the canvas. The whole drawing fits into the file; zoom, focus and the editing controls are omitted. SVG stays sharp when enlarged. PNG and PDF use the same image. The completion page previews the drawing before download.
- **JSON — Full project** preserves a reopenable project with both memos, their last-successful analysis baselines, relationship group memberships, Field Notes, stable IDs, node colors, layout and saved edit history. Keep this complete copy private. Import validates the file before replacing the open project.
- **CSV** supports spreadsheet analysis of graph records and neutralizes cells that could be interpreted as formulas.
- **Markdown** includes the source memos and notes for review and discussion.

Exports include the cumulative graph across levels. Portable copies remove evaluation and review bearer capabilities and include redaction metadata. Non-private exports also remove analysis baselines and edit history; visual exports retain permitted node colors. Project links retain their existing access, expiry and revocation rules. If browser storage fails, the current in-memory project remains available with a recovery export. Project schema v10 supports migration of v1–v9 projects.

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

Evidence, privacy, output validation and graph-write rules remain controlled by the application. Instructor text cannot enable automatic relationships, require Field Notes for account progression or override the account node-only contract. The preview exposes instructor-authored guidance and materials without exposing internal prompts or configuration fingerprints.

The Console opens on **Review submissions**. The current student interface does not create submissions for this queue; it supports retained records and the compatibility review API. Review actions provide asynchronous feedback without editing the student's map or controlling access to stages.

Fresh databases seed unclaimed accounts for Maria Mavrides Calderon and Zach Muhlbauer. There are no default passphrases. An operator can set a temporary, server-only `SYSTEMS_MAPPING_TEACHER_BOOTSTRAP_TOKEN` of 16–256 characters to authorize one account claim per server process. Claiming another account requires a fresh token and restart. The command below creates an account-bound password-reset link valid for 30 minutes and one use:

```bash
node server/create-password-reset.js <teacher-account-id>
```

Resetting a passphrase revokes that account's existing sessions. Passphrases use scrypt derivation; teacher sessions use random `HttpOnly`, `SameSite=Strict` cookies.

## Legacy Node/Railway model assistance

This section describes the separate local/classroom entrypoint. The account application uses the node-only [submission contract](docs/NODE_SUBMISSION_WORKFLOW_2026-11-04.md), including incremental memo updates, through CAIL Gateway. Account requests never propose relationships.

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

Responses must satisfy the level-specific structured contract. Micro responses contain nodes, Meso responses contain relationships between carried Micro nodes, and Macro responses contain scoped conditions. With both providers enabled, retryable provider failures can invoke OpenRouter; input-shaped failures do not trigger that backup. Runtime metadata records which provider served the request. Invalid or unavailable model responses return an error and never silently switch to built-in text review.

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

The source ledger governs provenance. The [November 4 Memo workspace](docs/MEMO_WORKSPACE_2026-11-04.md) and [two-memo workflow](docs/TWO_MEMO_WORKFLOW_2026-11-04.md) govern the current account application. The October 28 and August 24 designs remain historical context for compatible storage and the separate Node application. The fuller Drive specification governs compatible general behavior, the supplied HTML/DOCX informs interaction, and CALI materials provide context. Zach's August 5 notes remain unconfirmed minutes; STEM Splitter is an architecture precedent.

## License

Copyright © 2026 CUNY AI Lab, The Graduate Center, City University of New York.

This software is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later). You may use, study, change, and share it, including for commercial purposes. If you distribute a modified version, or run one as a network service that other people use, you must make its complete source code available to them under the same license.

This license applies to every version of this repository, including earlier commits.

Questions about licensing: [ailab@gc.cuny.edu](mailto:ailab@gc.cuny.edu). See CAIL's [licensing page](https://ailab.gc.cuny.edu/license/).
