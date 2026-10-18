# Doorway / CUNY Login parity

Systems Mapping uses the same private Doorway `WorkerIdentity` session protocol
as Stem Splitter. The October 12 comparison pinned Stem at
`2c8f3a821f4e9e16179cd60a8671720fcdbc95cc`; its SSO/configuration files were
unchanged from the previously observed release `d54348906b7638f17c153043c93066c1a89007e4`.
This is a source comparison, not a fresh live signing-key or binding inspection.

The browser starts a ten-minute PKCE transaction at `/auth/start`. Doorway owns
CUNY OIDC and one-use handoff grants. The callback is fixed by deployment props
to `https://systems-mapping.ailab-452.workers.dev/auth/callback`. Browser return
paths allow only this application's home/project routes and a bounded course
selector. Cookies are app-specific `__Host-*`, Secure, HttpOnly and SameSite=Lax.
Session installation is capped at 24 hours; Doorway remains the expiry and
revocation authority.

Document navigation reuses an existing session only after a fresh Doorway
lookup and verification of the exact Systems Mapping JWT. An expired or reused
callback can recover only to home after that verification, clears the pending
login transaction, and cannot renew the session or trust an old destination.
Failure pages contain fixed retry/access links and no caller-supplied values.
API authentication separately validates both app and Gateway JWTs, matching
subjects and current Admission membership. Cookie shape and JWT role claims
never establish course authority.

Only new login starts consume the sign-in IP bucket. Callback completion and
same-origin POST logout still work when that bucket is full. Logout attempts
Doorway revocation and always clears local session/transaction cookies, including
on service failure. It ends this app session, not the upstream CUNY SSO session.
Replacing a session retires the previous app session; an uncertain retirement
does not install the replacement.

## Deployment contract

| Setting | Systems Mapping value |
| --- | --- |
| `IDENTITY` | service `cail-doorway`, entrypoint `WorkerIdentity` |
| Binding props | `id: systems-mapping`, `worker: systems-mapping`, `workspace: false` |
| `ADMISSION_RESOLVER` | service `cail-tools-admission`, entrypoint `AdmissionResolver` |
| `GATEWAY` | service `cail-model-api` |
| `PUBLIC_ORIGIN` | `https://systems-mapping.ailab-452.workers.dev` |
| `LOGIN_URL` | `/auth/start` |
| Issuer | `https://tools.ailab.gc.cuny.edu/cail-sso` |
| App audience | `cail:systems-mapping` |
| Gateway audience | `cail:gateway`, same canonical subject as app JWT |
| Public verification keys | `CAIL_IDENTITY_JWKS` override, otherwise existing bundled `cloudflare/jwks.json` |

Stem has a separate preview origin and binding. Systems has one origin and must
not copy Stem's preview props, app audience, cookies, credentials or membership
namespace. Stem injects its public JWKS at deployment; Systems retains its
existing public-key fallback. The release reviewer must verify the active
Doorway key is trusted, including any rotation, and that an explicit override
has valid public verification keys. An invalid override fails closed. No private
signing key or new OAuth credential belongs in this application.

Course APIs additionally require the shared Admission Systems app scope,
`systems-mapping-member-v1-*` receipts, `COURSE_ACCESS_ENABLED="true"` and an
approved `COURSE_IDS` allowlist. Those runtime settings remain absent from the
checked-in deployment configuration. `COURSE_ID=systems-mapping-default` is the
existing general storage namespace, not an enrollment grant. Exact-course owner
checks, prompt history, data and caches remain separate; a general administrator
does not become a course owner. Stem's course-specific student policy is not
copied into Systems' existing general workspace.

Release shared Admission support before enabling course access, verify the
canonical instructor/course/enrollment links, then perform authorized live
owner/student/outsider/other-course/general acceptance. Direct Systems course
links need no Doorway launcher change. A My Classes launch card would require
separate coordinated Doorway navigation work.

Local coverage includes synthetic PKCE and session recovery, duplicate/malformed
credentials, exact JWT boundaries, native browser sign-out, an exhausted login
bucket, immediate course revocation, and actual Admission-to-Systems Worker
integration. These tests do not authenticate real accounts or prove live grants.
