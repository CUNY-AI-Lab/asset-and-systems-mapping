# Separate Cloudflare version

The authorized September 22 handoff adds a Cloudflare version of Systems
Mapping with CUNY accounts and CAIL Gateway. It preserves the Node/Railway
application, its database, existing links, and deployment configuration.
The starting point is canonical main `ae5ea57` plus the previously uncommitted
Cloudflare candidate, copied into an isolated checkout. The original candidate
checkout remains unchanged.

## Product and data contract

The current account contract is [Memo workspace](MEMO_WORKSPACE_2026-11-04.md),
[two-memo workflow](TWO_MEMO_WORKFLOW_2026-11-04.md) and [node submission](NODE_SUBMISSION_WORKFLOW_2026-11-04.md).
Projects open on the canvas with Memo · Notebook · Tools in one resizable sidebar.
Two independent memos support Micro → Meso → Exo → Macro within three nested
regions. The model supplies bounded supported nodes; students create every
relationship. Continue requires only a successful submission for the current
memo part, including an empty result. Stored numeric stages remain compatible;
they do not imply the older five-screen student review interface.

Schema 10 preserves graph records, both sources, evidence, student decisions,
node colors, saved edit history and optional independent last-successful analysis
baselines. Incremental source updates preserve existing student customizations
and apply graph/baseline changes atomically. Earlier Micro relationships migrate
to Meso; legacy scoped Meso records remain readable. No Durable Object namespace
or database reset is part of these interface changes.

The `systems-mapping` Worker uses one SQLite-backed `MappingCourse` Durable
Object per deployment-controlled teaching workspace. Account maps are keyed
by the hash of the verified canonical subject. Browser callers cannot choose
the owner or teaching workspace. Lists and direct map IDs are private; an
explicitly created unguessable project link remains a bearer capability used
together with current membership, as in the original product. Links retain
revisions, expiry, revocation and deletion. Railway links remain at their
original origin and are not copied into this namespace.
Opening a Cloudflare project link preserves its exact local path through CUNY
sign-in and opens the map directly. Login return paths accept only the explicit
project-link route, never an external redirect.

Up to 200 account maps are retained. Saves require the expected revision and
use a SQLite transaction. Requests have the same 2 MiB ceiling as existing
project-link writes. The account cache is separate from other accounts and the
legacy device cache. A conditional cache identifier prevents an old tab from
silently writing under a changed login; it does not confer authority. An
unsynced recovery copy resumes only when its original server revision is still
current. Divergent copies stay separate for recovery export. Export timestamps
do not constitute project edits. Browser caches remain accessible to someone
using the same browser profile; CUNY Login does not encrypt browser storage.

Account activity records contain project IDs, event kinds, revisions and times;
they do not duplicate memo text. Old activity for an account is purged during
subsequent saves. Shared review retention follows the existing product rules.

## Identity and model contract

- `IDENTITY` binds to `cail-doorway#WorkerIdentity` with props
  `{id:"systems-mapping",worker:"systems-mapping",workspace:false}`. Login uses
  PKCE/state and an opaque Secure, HttpOnly, SameSite=Lax host cookie. Callback
  codes are canonical UUIDv4. Logout revokes the session.
- HTML pages use `Referrer-Policy: same-origin` so native sign-out forms send
  their origin. Cross-origin referrers remain suppressed; API responses and
  authentication redirects retain `no-referrer`. Mutations still reject
  missing, null, foreign, and cross-site origins before session revocation.
- Both signed `cail:systems-mapping` and `cail:gateway` legs are verified for
  signature, issuer, expiry, exact scalar audience and matching subject. JWTs
  never enter browser responses or browser storage. Caller identity headers
  are stripped. Broken verification configuration is 503; invalid credentials
  are 401. Admission denial/expiry is 403; uncertainty is 503.
- `ADMISSION_RESOLVER` binds to `cail-tools-admission#AdmissionResolver` and is
  checked on every protected request. Current Admission administrators may
  use the shared Instructor Console; members cannot. No legacy teacher account
  is automatically linked by name or email.
- `GATEWAY` binds to `cail-model-api`. Exact installed artifacts are CAIL Client
  6.2.2, Identity 5.2.6, and Log 0.6.4. The configured public model is `gpt-oss-120b`,
  observed active in the public Gateway catalog on October 3. Provider
  credentials, routing controls and accounting identities are not supplied by
  this application. GLM and its GPT-OSS backup use low reasoning. A
  4,096-token completion ceiling bounds legacy review output; the account
  node-submission contract uses 8,192 tokens to include reasoning while still
  allowing only six nodes and no relationships. Truncated results fail
  validation. The account path has no relationship, guidance, scope or example output; Part 2 adds at most three Exo and three Macro nodes. The retained legacy review path may request up to four connections under its separate level rules. No returned items are silently filtered or relabeled.
- An explicit model action normally makes one attempt. The requested backup,
  `gpt-oss-20b`, gets a separately admitted Gateway call only after
  a known availability refusal with affirmative Gateway retry advice. This
  is application-level model selection, not a claim of model equivalence or
  Gateway routing configuration. Respect Retry-After within the original
  deadline. Quota/auth denials, ambiguous failures and timeouts never trigger an
  automatic corrective call. A completed memo review that fails semantic
  validation gets one ordinary corrective call. If that completed correction
  still fails source grounding, one final evidence repair supplies bounded
  exact narrative passages and requires quoted evidence. Each call receives
  separate Gateway admission and shares the original generation deadline.
  Malformed JSON/parser failures, repeated generic schema errors, connection
  suggestions and Map Check do not receive this evidence repair. Successful
  and returned failed results record the actual `correctiveRetries` count
  (up to two) and optional `evidenceRepairAttempts` (one). Durable outcomes
  retain those counts. If a completed review still fails on a specific map
  item, a server-constructed feedback-only result may be saved only after the
  nonempty guidance passes its normal source and shape checks; it carries no
  map suggestions and is labeled in runtime metadata and the interface. This
  adds no provider call and does not rescue provider or transport failures. This feedback-only result belongs to the retained legacy review contract; account node submissions never revive a guidance queue.
  The count records
  attempted calls, rather than proof of provider execution or zero cost.
  An outer cancellation or disconnect can prevent a result from being recorded;
  Gateway owns per-call usage accounting. Bodies and deadlines are bounded;
  cancellation ends local waiting even when an upstream ignores it. Safe
  error code, retry advice and canonical UUIDv4/v7 support ID reach the UI.
  Quota is an estimated display only; unavailable quota remains unavailable.
- DeepSeek Flash is not an automatic backup: live full-memo checks on October
  3 exceeded the 25-second model budget even with reasoning disabled. The
  opt-in live test can probe it again before qualifying a future change.
- Guidance POSTs have a 28-second whole-Worker waiting limit, including
  identity checks and course dispatch, below the browser's 30-second limit.
  Ordinary Gateway generation, correction and availability fallback share a
  25-second bound. Existing verified durable guidance jobs retain their
  85-second generation budget across these attempts; their polling flow is
  separate from the ordinary 28-second Worker response wait. A whole-request
  timeout returns `504` with `guidance_timeout` and no automatic retry.
  The browser displays a persistent error and a Try again action. Existing
  memo/map data remains unchanged. Transfer an absolute deadline across the
  course RPC boundary, not an unsupported AbortSignal; the course reconstructs
  a local abort signal and releases its active permit on cancellation. An
  expired queued request cannot begin generation, and a late model response
  cannot be saved. This bounds application waiting, not provider residency or
  billing after cancellation. Project reads, saves, and submissions do not
  use this guidance-only deadline.
- The Gateway session hint is a stable application label. Gateway owns its
  principal-scoped affinity derivation; no account identity is constructed
  locally. Affinity may help prefix reuse, but is not a promise of warm model
  residency. The app does not send speculative billable warm-up requests.
- Successful Workers AI responses retain native `@cf/vendor/model` IDs.
  Accept only an exact canonical model or its exact native variant and
  normalize it before the strict envelope parser. The separate Railway
  provider parser is unchanged.
- `GUIDANCE_CONCURRENCY=8` bounds concurrent guidance and connection actions
  in the Cloudflare teaching workspace. Each student can have only one such
  action running at a time. Duplicate and capacity refusals do not consume
  that student's generation rate allowance. Gateway-approved retry timing
  reaches the caller; only the explicit availability fallback above may start
  another admitted model call.
- Protected API request limits are per verified account, not per campus IP.
  Login and anonymous failures retain their IP-bound limit. Identity and
  Admission remain authoritative on every protected request.
- CAIL Log emits fixed request/outcome fields without prompts, maps, user
  identifiers, credentials or provider bodies. Logging is separate from the
  product's private data and semantic validation.

Account incremental requests retain `workflowMode: "student-nodes-v1"` and add a bounded `memoUpdate` identity/passages object. Only significant changed narrative is sent where possible; broad or deletion-only edits can explicitly fall back to the complete active memo. Provider context is limited to 80 KiB for incremental calls, the analysis/update object to 64 KiB, current source to 128 KiB and total wire payload to 256 KiB. Identity is never silently truncated. Optional `existingId` refreshes only eligible generated evidence and must echo the current saved identity. Current-source evidence validation and repairs retain the same supplied passages and identity context. Neither Continue nor unchanged memo saving triggers a paid request. See [node submission](NODE_SUBMISSION_WORKFLOW_2026-11-04.md) for complete baseline and preservation rules.

Classification follows focal participation and the supported indirect path, not organization names. The [classification evidence and regression gates](CLASSIFICATION_EVIDENCE_2026-11-04.md) define the minimal-pair live model acceptance cases. Passing schema validation alone does not establish correct ecological interpretation.

The bundled public JWKS exactly matches the live Doorway public JWKS read on
September 23 at `/cail-sso/.well-known/jwks.json`, including key ID
`a4d816154d18135a15c2ee76998a57eb`. The live Gateway stores its verifier value
as a secret, so its bytes were not read back. Real signed-in acceptance remains
the check of the deployed signing/verifier relationship.

## Release and recovery

For the November 4 changes, the user authorized **all changes on Dev first, screenshots, then production**. Source tests and CI precede deployment. Verify the integrated Dev behavior, saved-map reload and ten screenshots before promoting the checked source. Record the exact SHA, Worker version, traffic, assets, authenticated/model checks and unresolved limitations at each boundary. This document is a procedure, not a release receipt; historical deployment paragraphs below remain dated evidence only.


Cloudflare account: `452c33847cf5cb1e46f391fca32fd1b5` (CUNY AI Lab).
Target: `https://systems-mapping.ailab-452.workers.dev`.
Historical boundary: no Worker existed at that target during the September 23 preflight. This is not the current deployment status.

`pnpm check:cloudflare` typechecks, builds the account frontend and bundles the
Worker without deploying. `pnpm test` exercises both shared product code and
the actual local Workers/SQLite runtime. Set
`SYSTEMS_MAPPING_BROWSER_ACCEPTANCE=1` to include the Chrome account/export
journey; `TEST_POSTGRES_URL` enables a separate disposable loopback PostgreSQL
database ending in `_test`. `pnpm test:e2e` preserves the existing Node browser
and accessibility paths. PR CI runs all of these with a fresh PostgreSQL 17
service and Chrome.

The manual release workflow requires the exact current main SHA, complete
checks, the `cloudflare` GitHub environment, and a scoped
`CLOUDFLARE_API_TOKEN`. It serializes releases and checks main again immediately
before deployment. This repository had no release secret at preflight; the
workflow is not active evidence of a completed CI release. Never copy a local
OAuth credential into repository secrets to make that check pass.

The initial September candidate procedure allowed an authorized operator release from
a clean, pushed, checked commit using checkout-local Wrangler and
`--var RELEASE:<full-source-SHA>`. Record the actual version and deployment
readback. The release marker and SQLite initialization/health check must pass,
and anonymous project access must return 401. The verification script checks
these receipts without claiming authenticated acceptance. No Railway command
or shared Gateway release belongs in this procedure.

### Deploy the verified CI package from an authorized Mac

The checks workflow uploads `systems-mapping-cloudflare-<source-SHA>` only
after the frozen install, Cloudflare typecheck/build/bundle, unit/Worker tests,
and browser checks succeed. The package contains the bundled `worker.js`,
`dist-cloudflare`, the checked production configuration and lockfile,
`SOURCE_SHA`, `SOURCE_TREE`, and `SHA256SUMS`. It contains no credentials or
test databases. This avoids reconstructing private registry dependencies on
the operator's Mac. The artifact inherits the private repository's access
controls and expires after seven days; it does not deploy automatically.

For a production release, select the successful **main push** run for the exact
current main SHA. Download its named artifact with `gh run download`, into an
empty directory. Check `SOURCE_SHA` against current main, `SOURCE_TREE` against
that commit's Git tree, and run `shasum -a 256 -c SHA256SUMS` inside the package.
Compare its `wrangler.jsonc` and `pnpm-lock.yaml` against the same source commit.
Do not deploy a PR merge artifact as a main release or accept a package from
a failed, incomplete, or different run. Recheck main immediately before upload.

Using the existing authorized Wrangler login and the pinned public Wrangler
`4.130.0`, run from the verified package directory:

```sh
wrangler deploy worker.js --no-bundle --config wrangler.jsonc --assets dist-cloudflare --var "RELEASE:$RELEASE_SHA"
```

`RELEASE_SHA` must be the verified full current-main SHA. First run the same
command with `--dry-run` to validate the package and production configuration
without uploading. `--no-bundle` uploads the already checked Worker; it does
not install private packages. Preserve all bindings, migrations, account and
origin settings from the checked configuration. Never copy the local OAuth
credential into CI or create a repository token to make this route work.
After upload, run `scripts/verify-cloudflare-release.mjs` from the matching
checkout, verify deployment/version traffic and asset hashes, and retain the
separate authenticated-acceptance limits below.

Code rollback must retain the Durable Object namespace and compatible schema.
Cloudflare documents 30-day SQLite point-in-time recovery using bookmarks;
this is platform capability, not a completed restoration rehearsal. Local
development cannot test PITR. A data recovery must separately establish the
target bookmark and preserve newer work before applying it. Never restore a
database automatically because a code release failed. See the official
[SQLite storage/PITR API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api).

After release, complete a real CUNY login, model action with a fabricated memo,
map save/reload, export, second-account isolation, membership revocation and
logout checks before describing this version as accepted for classroom use.

## Dev Worker

`wrangler.dev.jsonc` deploys the same code as `systems-mapping-dev` at
`https://systems-mapping-dev.ailab-452.workers.dev`. It has its own Durable
Object namespace, rate-limit counters and `PUBLIC_ORIGIN`; it shares nothing
with production storage. The `IDENTITY` binding keeps `id: "systems-mapping"`,
so the app's `cail:systems-mapping` audience check still verifies, and sets
`worker: "systems-mapping-dev"`, from which Doorway derives the sign-in
callback. No Doorway, Admission or Gateway change is needed for a dev Worker.

Release from a clean, committed checkout with `pnpm deploy:dev`, which builds
the account frontend, deploys with `RELEASE` set to the full commit, and runs
the readiness receipt against the dev origin. `pnpm check:cloudflare:dev` is
the dry run. Real CUNY sign-in, a model action and a saved-map reload on the
dev origin remain separate human acceptance, as for production.

First deployment: 2026-10-17 from commit `c894c9655fa100cf88fa0d74538096c0886cbbed`,
version `790fe04e-c73d-43b4-bd2f-b51556a391e3`; health, release marker and the
anonymous 401 passed. Production was not redeployed.

## Guidance jobs: long-poll reads

Each account retains at most 40 generation payloads for 24 hours. A new request
can evict the oldest completed or failed outcome; running, queued and retry-wait
jobs are preserved. This cache limit does not cap completed memo edits. Request
tokens remain for seven days so an expired response cannot replay inference.
The existing 1,000-token, retry and Gateway admission limits remain in force.
Busy, oversized, invalid and unavailable-storage failures have distinct safe
messages; a rejected creation does not leave an orphan request token.

`GET /api/cloud/guidance-jobs/<id>?wait=1` holds inside the Durable Object for
up to 20 seconds while the attempt it owns is running, then returns the current
page. The browser uses this form with a 30-second request budget and a short
pause between reads, so one guidance action costs about one authenticated read
every 20 seconds instead of one every 2 seconds. Retry waits and resumes are
unchanged. A job whose attempt runs on another instance returns at once and the
browser falls back to ordinary polling.

## Retained Map Check API

This compatibility API is not exposed as a student account-workspace control. It does not belong in the new Memo/Notebook progression and must not be used to add automatic relationships.

`POST /api/map/check` (job kind `map-check`) sends the carried map as
`carriedNodes` and `carriedConnections`, memberships as `scopes`, an optional
focus, the student judgments and at most 4,000 characters of memo excerpt. It
never sends the whole memo. The response is `{ notes: [{ kind, point, refs }] }`
with 1 to 4 notes, each `ref` an ID from the request; the validator rejects
anything else and no corrective paid retry is made. Intents: `gaps` and
`connection` use the `build-map` stage guidance; `synthesis` is Macro-only and
uses `revise-and-export`. The published course appendix applies through the
builder prompt. Output budget is 1,024 completion tokens; the Gateway session
label is `systems-mapping-map-check`. Logging is unchanged: outcomes only.


## November 4 integrated release checks

Before promotion, check the complete build on Dev: canvas-first new/existing projects; independent memo drafts and successful baselines; meaningful, unchanged and one-word updates; successful empty results; current-part Continue gating; stable manual labels/classification/colors/evidence and removed nodes; failure/cancel/stale job recovery; saved Undo/Redo across reload; both double-click connection targets and atomic cancel; source deletion; three content-sized regions; color parity in PNG/PDF/private JSON; info copy/timer/focus; keyboard/touch and narrow sidebar/phone layouts. The model must demonstrate the Micro/Exo participation distinction on the documented same-name cases and return no relationships.

Use approved real PDFs as well as synthetic continuations, keep those source files outside Git, and record every actual model failure and retry. A finite passing test set establishes those cases only. Production verification must read back the exact checked source and assets separately from Dev evidence. Do not mark the new design released merely because it is documented or passes local tests.
