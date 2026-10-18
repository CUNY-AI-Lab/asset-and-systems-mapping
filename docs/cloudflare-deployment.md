# Separate Cloudflare version

The authorized September 22 handoff adds a Cloudflare version of Systems
Mapping with CUNY accounts and CAIL Gateway. It preserves the Node/Railway
application, its database, existing links, and deployment configuration.
The starting point is canonical main `ae5ea57` plus the previously uncommitted
Cloudflare candidate, copied into an isolated checkout. The original candidate
checkout remains unchanged.

## Product and data contract

Micro includes direct relationships and their verbs. Meso contains named
linkages among carried Micro settings. Exosphere and Macrosphere, existing
schema migrations, five stages, teacher guidance, retained reviews, map
editing/filtering, and privacy-aware exports continue to use the shared product
implementation. `docs/MICRO_MESO_CORRECTION_2026-08-24.md` and the current
requirements take precedence over the older Zoom interpretation.

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
  use the shared Teacher Console; members cannot. No legacy teacher account
  is automatically linked by name or email.
- `GATEWAY` binds to `cail-model-api`. Exact installed artifacts are CAIL Client
  6.2.2, Identity 5.2.6, and Log 0.6.4. The configured public model is `glm-5.3-flash`,
  observed active in the public Gateway catalog on October 3. Provider
  credentials, routing controls and accounting identities are not supplied by
  this application. GLM and its GPT-OSS backup use low reasoning. A
  4,096-token completion ceiling bounds output, and truncated results fail
  validation. A compact first pass asks the model for at most six nodes and
  four connections, subject to the stricter active-level contract. No returned
  items are silently filtered or relabeled.
- An explicit model action normally makes one attempt. The requested backup,
  `gpt-oss-20b`, gets a separately admitted Gateway call only after
  a known availability refusal with affirmative Gateway retry advice. This
  is application-level model selection, not a claim of model equivalence or
  Gateway routing configuration. Respect Retry-After within the original
  deadline. Quota/auth denials, ambiguous failures, timeouts, and invalid
  completed output never trigger an automatic second paid call.
  Invalid structured output fails without a corrective paid retry. Bodies and deadlines are bounded;
  cancellation ends local waiting even when an upstream ignores it. Safe
  error code, retry advice and canonical UUIDv4/v7 support ID reach the UI.
  Quota is an estimated display only; unavailable quota remains unavailable.
- DeepSeek Flash is not an automatic backup: live full-memo checks on October
  3 exceeded the 25-second model budget even with reasoning disabled. The
  opt-in live test can probe it again before qualifying a future change.
- Guidance POSTs have a 28-second whole-Worker waiting limit, including
  identity checks and course dispatch, below the browser's 30-second limit.
  The entire Gateway attempt/fallback operation has a 25-second bound. A whole-request
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

The bundled public JWKS exactly matches the live Doorway public JWKS read on
September 23 at `/cail-sso/.well-known/jwks.json`, including key ID
`a4d816154d18135a15c2ee76998a57eb`. The live Gateway stores its verifier value
as a secret, so its bytes were not read back. Real signed-in acceptance remains
the check of the deployed signing/verifier relationship.

## Release and recovery

Cloudflare account: `452c33847cf5cb1e46f391fca32fd1b5` (CUNY AI Lab).
Target: `https://systems-mapping.ailab-452.workers.dev`.
No Worker existed at that target during the September 23 preflight.

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

The initial isolated candidate can be released by the authorized operator from
a clean, pushed, checked commit using checkout-local Wrangler and
`--var RELEASE:<full-source-SHA>`. Record the actual version and deployment
readback. The release marker and SQLite initialization/health check must pass,
and anonymous project access must return 401. The verification script checks
these receipts without claiming authenticated acceptance. No Railway command
or shared Gateway release belongs in this procedure.

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

`GET /api/cloud/guidance-jobs/<id>?wait=1` holds inside the Durable Object for
up to 20 seconds while the attempt it owns is running, then returns the current
page. The browser uses this form with a 30-second request budget and a short
pause between reads, so one guidance action costs about one authenticated read
every 20 seconds instead of one every 2 seconds. Retry waits and resumes are
unchanged. A job whose attempt runs on another instance returns at once and the
browser falls back to ordinary polling.

## Map Check

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

