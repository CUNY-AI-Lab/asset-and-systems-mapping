# Systems Mapping source and deployment authority

Read `docs/cloudflare-deployment.md`, `docs/REQUIREMENTS.md`, and
`docs/MICRO_MESO_WORKFLOW_2026-10-28.md` before changing this application.
The October 28 direct request supersedes the August 24 Micro/Meso correction:
Micro displays nodes, and Meso adds directional relationships between those same nodes. Preserve the five stages and map navigation,
map geometry, evidence, annotations, import/export and explicit project links.

The Cloudflare entrypoint is a separate version with independent SQLite-backed
Durable Object storage. The original Node/Railway target and its existing data
are not migrated or retired by this work. Only the Cloudflare frontend build
sets `VITE_ACCOUNT_WORKSPACE=true`. Do not copy test entrypoints or fixture
identity keys into the production configuration.

Consult current remote `CUNY-AI-Lab/cail-knowledge-base` and owning service source
for institutional contracts. Forward only the separately verified, matching
Gateway identity. Gateway changes require PRs; do not merge or deploy Gateway
as part of a product release. Do not introduce provider keys, hidden retries,
local model-spend admission, or payload/identity logging.

Preserve recovery copies and optimistic revisions. An account change must not
make an old browser tab write into the new account. A code rollback never
authorizes a database rollback. Report source tests, hosted CI, deployed source,
and real signed-in model acceptance as separate evidence.

The student interface uses Map / Notebook: the mounted canvas and one current
notebook task share each level (`src/App.jsx` `MapStage`, `src/MapStudio.jsx`,
`src/ReflectionEntry.jsx`, `src/nextStep.js`). Map tools and Project menus
consolidate secondary controls. Map | Notebook | Tools and the work-level selector share the Notebook panel header. When the panel is closed, these controls float over the canvas; never reserve a full-width toolbar strip. The bug-report dock belongs in the main header. Keep the controls readable in a resized narrow panel and preserve keyboard focus when moving between Map and Notebook. Notebook has two writing tasks: memo/suggestions and Field Notes; selected-item editing is contextual. Map tools must use their own flex layout, not legacy toolbar grid selectors. Full screen must close Notebook, switch List to Canvas, fill the viewport, and expose an exit. Field Notes are one string per scale, required only to complete that scale. Questions are published by scale through teaching profiles; navigation back to Map remains available. Keep the existing draft journal and the `reflection` storage keys;
preserve older labeled Macro prose without parsing or rewriting it. Stage numbers and labels are still the
record of progress and must not be renumbered. `wrangler.dev.jsonc` deploys the
separate `systems-mapping-dev` Worker; production releases stay manual.

Instructor prompt editing follows `docs/instructor-settings.md`: one scale selector and prompt field, optional student preview, and Publish changes that saves pending edits first. Routine editing generates draft metadata; preserve optimistic revision checks, failed-publication drafts, and the advanced version/history controls.
Course rosters stay in a collapsed disclosure under Submissions and load on demand; they must not displace the console navigation or course-settings editor.

