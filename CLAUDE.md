# Systems Mapping source and deployment authority

Read `docs/cloudflare-deployment.md`, `docs/REQUIREMENTS.md`, and
`docs/MICRO_MESO_CORRECTION_2026-08-24.md` before changing this application.
The later Micro/Meso correction supersedes the node-only Micro rules in the
older Maria Zoom notes. Preserve the five stages, permissive progression,
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
