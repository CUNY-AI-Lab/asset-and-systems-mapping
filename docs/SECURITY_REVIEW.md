# Systems Mapping security review

Updated: 2026-08-11

## Scope and claim boundary

This review covers the current React application, Node/Hono server, SQLite and PostgreSQL adapters, student class access, teacher authentication, authoritative evaluation, instructor review, import/export, prototype telemetry, and optional Ollama Cloud adapter.

The deterministic active-beta release passes 142 tests with 3 PostgreSQL-gated skips and produces a successful production build. Its production dependency audit reports no known vulnerabilities. Source and application-bundle credential scans are clean; the application bundle excludes the local class code, source maps, dangerous HTML sink, teacher identity, review capability, and server prompt. The tracked publication excludes environment files, databases, local state, screenshots, and test fixtures. GitHub readback previously confirmed application-contract commit `cb2a959` and **Active beta** notice commit `23aa134`. Railway deployment `68e0a3af-33d7-4cc9-9c4e-f95393d83963` previously reached `SUCCESS`, returned healthy status and expected hardening headers, and served a class-entry page with zero console warnings that rejected `101`.

Disposable current browser journeys verify the minimized source prompts, collapsed teacher-only details, instructor focus and question, **Approve with a question**, candidate choice, map entry, revision stage, and Course settings create → save → preview → publish path. The current 50-image archive covers changed views and class entry at 320, 390, 430, and 1440 px without horizontal overflow. This review does not claim current rendered simple **Approve**, **Reject**, reload/export restoration, or a live Ollama provider run.

Status terms:

- **Automated verified** — current source and regression tests prove the stated contract; live/bundle evidence may still be pending.
- **Bounded** — residual behavior is intentional and explicitly limited.
- **Operational verification pending** — implementation exists, but final runtime, bundle, deployment, credential, or real-data evidence is missing.
- **Open** — required work is not yet complete.

## Finding ledger

| ID | Status | Current evidence | Residual risk / required closure |
| --- | --- | --- | --- |
| SEC-01 — client-visible class code | Automated, bundle, and deployed-entry verified | Local default `101` is selected by the server. The application bundle excludes that class code; unrelated numeric `101` values occur only in a library bundle's glyph tables. Hosted startup and the deployed browser entry reject `101`; hosted mode requires 10–32 characters with at least six distinct characters. | The local code remains a convenience, not authentication. Keep future bundle scans byte- and asset-specific so library glyph data is not mistaken for application configuration. |
| SEC-02 — student session isolation | Automated verified | Student access issues a distinct random, expiring, `HttpOnly`, `SameSite=Strict` cookie; hosted cookies are Secure. Student sessions cannot authorize teacher routes. A stale activity-log 401 is confirmed against the current session before expiring the UI grant. | Verify access, expiry, logout, and teacher-route denial in the current browser build. |
| SEC-03 — teacher account claiming | Automated verified | Fresh stores seed Maria and Zach without passphrases. Claim requires an explicit account ID, a 16–256 character operator token, and a new passphrase. A token is hashed in the use ledger and authorizes one claim per process. Passphrases use salted scrypt; failures are generic, throttled, and concurrency-bounded. | Claim both accounts only with temporary values against a disposable database. Confirm the real database remains unclaimed and contains no QA credentials/sessions. |
| SEC-04 — CSRF, Host, and proxy trust | Automated and deployed-header verified | Every state-changing route requires exact same origin/fetch-site. Local mode accepts only loopback Host; hosted mode requires an exact HTTPS public origin and bounded trusted proxy depth. Tests reject missing/foreign origin, untrusted Host, and mismatched forwarding; the current Railway service returned its expected hardening headers. | Misconfigured `TRUST_PROXY_HOPS` remains an operator risk. Repeat exact-origin mutation checks after proxy or domain changes. |
| SEC-05 — body and resource exhaustion | Automated verified | Content type, total request bytes, JSON depth/work/keys/arrays, field lengths, collections, rate windows, concurrent evaluation, queue size, provider request/output, database pool, and query timeouts are bounded. | Recheck production error receipts and load limits after Railway variables are selected. Process-local rate buckets reset on restart. |
| SEC-06 — browser response hardening | Automated and live-header verified | Tests assert restrictive CSP, `DENY` framing, no-referrer, permissions restrictions, nosniff, same-origin opener/resource policy, and `no-store`/`no-cache` for APIs and HTML. The current Railway response returned the expected hardening headers, and the application bundle contains no source maps. | Repeat production readback after domain, proxy, or deployment configuration changes. |
| SEC-07 — authoritative evaluation tampering | Automated, PostgreSQL, and primary journey verified | The browser cannot submit result/configuration content for review. The server evaluates and validates the full result, stores it teacher-side, derives at most three short source prompts, and returns no criteria, score, threshold, outcome, or full suggestion to the student. Review submission remains exactly `{evaluationId, studentAnnotation}`; consumption and snapshot creation are transactional. The disposable browser journey verified the minimized prompts and instructor handoff. | Expiry, replay, changed-source race, and projection rejection remain automated rather than current rendered receipts. |
| SEC-08 — capability disclosure | Automated and bundle verified; bounded | Evaluation and review IDs are random 192-bit bearer capabilities. All portable tiers redact both. Student review GET also requires a valid class session and returns only minimized status, one instructor focus, and an optional focused question—not source, criteria/scores, prompt configuration, teacher identity, or teacher-only model details. The application-bundle scan found no review capability or teacher identity. | Anyone who has both a current class session and a leaked review ID can read that minimized response. Treat IDs as secrets and repeat storage/export inspection after capability-handling changes. |
| SEC-09 — model/prompt and credential leakage | Automated and source/bundle verified | Student evaluation output is allowlisted to `id`, `redirects`, sanitized configuration/runtime metadata, and timestamps. Redirects accept only `action` plus optional `evidenceExcerpt`; full criteria and scores remain teacher-authenticated and collapsed in the UI. Current source and application-bundle scans found no credential values; the application bundle contains no server prompt, teacher identity, or capability. Authenticated teachers can read the bounded published course profile and its trial history, while retired internal module routes return `410`. | Course settings still become part of the Ollama provider prompt when that runtime is enabled. Repeat scans after build or prompt-loading changes. |
| SEC-10 — review history integrity | Automated and one rendered branch verified | Decisions require an expected revision, a teacher identity, and one instructor focus. Only the `revise_and_approve` compatibility decision—displayed as **Approve with a question**—accepts one bounded focused question; legacy revised-suggestion input is rejected. SQLite and PostgreSQL protections prevent review-event mutation outside guarded retention. The current disposable browser journey verified **Approve with a question**. | Review records are immutable until retention, not permanent. Simple **Approve** and **Reject** remain active-beta rendered follow-up; their automated contracts pass. |
| SEC-11 — retention and deletion | Automated verified; bounded | Evaluations expire at 1 day; pending snapshots at 30; decided snapshots at 180. Guarded deletion removes source-bearing submissions/events and writes a hashed append-only purge receipt. Startup and queue access run bounded purge work. | Institutional policy must accept these periods. Backup/snapshot retention outside the application is not controlled by this code and must be configured separately. |
| SEC-12 — SQL portability and transactions | Automated verified | SQLite and PostgreSQL use prepared parameters, matching schema constraints, migration locks, nested/queued transactions, and tested rollback. A fresh PostgreSQL 17 run completed the review workflow. | Railway connection SSL/pool/timeouts and actual migration state remain unverified. |
| SEC-13 — import and export injection | Automated and static-scan verified | Schema-owned objects use known-field allowlists; credential/account canaries, invalid references, malformed geometry, policy escalation, and excessive data fail closed. React renders values as text. CSV formula/control/whitespace prefixes are neutralized at the byte boundary. The current application-bundle scan found no dangerous HTML sink or source map. | Current rendered reload/export restoration remains beta follow-up. Opening exported files still depends on downstream application behavior. |
| SEC-14 — annotation and redaction leakage | Automated verified | Node, evidence, relationship, and map annotations have stable ownership, limits, and reference validation. Restricted projections redact source-derived annotations/prose and retain an explicit manifest. Unknown nested canaries fail before export. | Perform current private/course/CUNY/public browser export receipts with realistic sensitive data. |
| SEC-15 — prototype telemetry | Automated verified; bounded | Only named events, canonical stage numbers, and bounded numeric/boolean metadata are accepted. Memo text, labels, annotations, prompts, capabilities, and identity are outside the schema. Rows and retention are bounded. | The rate bucket is intentionally shared by local students and process-local; heavy use can throttle activity logging without blocking core local project persistence. |
| SEC-16 — Ollama endpoint/key handling | Automated verified; live pending | Ollama is disabled unless explicitly enabled with a fresh server key. Production URL is pinned to `https://ollama.com`; the key is non-enumerable in validated config and sent only as a bearer header. Timeouts, cancellation, HTTP errors, response size, envelope keys, and JSON result shape fail closed. | The previously pasted key is exposed and must be revoked. No local/Railway key or live request has been configured or verified. |
| SEC-17 — prompt injection and model output | Bounded | Project source is labeled untrusted data; an additional system instruction requires JSON only. The server rejects extra keys, invalid criteria, inconsistent score/outcome, invalid timestamps/configuration, and oversized output before persistence. It then projects only bounded source prompts to the student; full codification remains behind teacher authentication. | This is schema containment, not proof that a model cannot be influenced. Instructors must inspect the collapsed model details and write their own focus/question before candidates unlock; a live adversarial provider suite remains required. |
| SEC-18 — source egress and storage | Bounded; operational approval pending | Deterministic STEM Splitter has no provider egress. Ollama mode discloses and sends teacher prompt, project instructions, inquiry, scale, source metadata, and memo text; source is capped at 131,072 UTF-8 bytes. Submitted review snapshots store source material for 30/180 days. | Hosted use requires an explicit institutional decision about source sensitivity, Ollama processing, PostgreSQL/backups, and instructor access. Technical opt-in alone is insufficient. |

## Authentication and authorization boundaries

### Local student access

The initial class code `101` is intentionally low-assurance. It is suitable only for opening a loopback classroom workspace. It does not identify a student, protect against another person using the same local machine, or provide cross-device continuity. Local server binding to `127.0.0.1` is part of this boundary.

### Hosted student access

Hosted mode replaces `101` with a stronger operator-supplied server code, Secure cookies, HTTPS origin validation, trusted-proxy limits, and session issuance bounds. It still represents shared class access, not individual institutional identity. If per-student accountability becomes required, SSO or another identity layer is a separate feature.

### Teacher access

Teacher authorization is distinct from student access. The public login/claim surface does not enumerate the seeded roster. Bootstrap tokens must be delivered outside the application, used once, and removed after claim. A restart with a fresh token is required for the other unclaimed account.

### Review capabilities

The browser stores a high-entropy review ID so a student can refresh after a class-session renewal. This intentionally allows any valid class session holding that ID to retrieve the minimized decision. Portable exports remove the ID, and instructor source/detail remains teacher-only.

## Ollama Cloud decision record

Ollama Cloud is an explicit source-egress mode, not a transparent enhancement. The runtime disclosure must be visible before generation. The configured provider does not receive browser credentials or review capability IDs, but it does receive the active teacher prompt and the project/source inputs listed above.

The local `.env` intentionally has an empty `OLLAMA_API_KEY`. The credential previously provided in chat must be considered compromised by disclosure. Required sequence:

1. revoke the exposed key;
2. create a new key;
3. store it only in the local server secret file and/or Railway secret store;
4. verify it never appears in source, bundle, logs, exports, or screenshots;
5. run a separately authorized live acceptance with non-sensitive test source.

No current result demonstrates a live Ollama request.

## Railway readiness boundary

The code is ready for a Railway-style service backed by PostgreSQL: startup requires paired `DATABASE_URL`/`PUBLIC_ORIGIN`, explicit public binding and proxy depth, a strong class code, and bounded pool/timeouts. Hosted tests and a fresh local PostgreSQL integration pass.

Railway project/service/database creation, variables, migration, terminal deployment success, and public database-backed health readback are verified. Deployment `68e0a3af-33d7-4cc9-9c4e-f95393d83963` reached `SUCCESS` at `https://web-production-08455.up.railway.app`; health returned `{"status":"ok"}`, expected hardening headers were present, and the browser entry loaded with zero console warnings while rejecting `101`. The health endpoint intentionally accepts Railway's internal hosted readiness Host while all other hosted routes retain exact public Host/origin enforcement. A full teacher-review journey against deployed PostgreSQL remains useful beta coverage. If Ollama is enabled later, the rotated key and live egress test remain separate gates.

## Final verification checklist

- [x] Run the production dependency audit: no known vulnerabilities.
- [x] Scan source and application bundles: no credential values; no application-bundle class code, source maps, dangerous HTML sink, teacher identity, review capability, or server prompt. Library-only numeric `101` values are unrelated glyph tables.
- [x] Run the frozen full suite and production build: 142 passed, 3 PostgreSQL-gated skipped, and the production Vite build passed.
- [x] Complete the disposable **Approve with a question** browser journey with source prompts, collapsed teacher details, instructor focus/question, candidates, map entry, and revision stage.
- [x] Capture the changed student and teacher states and class entry at 320, 390, 430, and 1440 px with no horizontal overflow; the current ZIP contains 50 PNGs and passes `unzip -t`.
- [x] Restart/read back the loopback production server and audit the real SQLite database without printing sensitive values.
- [x] Confirm the tracked publication excludes environment files, databases, local state, screenshots, and test fixtures; read back private GitHub commits `cb2a959` and `23aa134`.
- [x] Deploy/read back Railway deployment `68e0a3af-33d7-4cc9-9c4e-f95393d83963`: terminal `SUCCESS`, health ok, expected hardening headers, zero-warning entry, and hosted `101` rejection.
- [ ] Exercise simple **Approve** and **Reject**, rendered reload/export restoration, and the full deployed teacher-review journey as active-beta follow-up.
- [ ] Revoke the exposed Ollama key; configure a rotated key only if authorized; run a separate live-provider acceptance.

The correct status is **deterministic active-beta release verified, scanned, published, and deployed; additional rendered branches/restoration and optional live Ollama remain scoped follow-up**.
