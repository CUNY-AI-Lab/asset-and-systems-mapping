# Systems Mapping security review

Updated: 2026-08-21

## Scope and claim boundary

This review covers the current React application, Node/Hono server, SQLite and PostgreSQL adapters, student class access, teacher authentication, authoritative evaluation, instructor review, import/export, prototype telemetry, and optional Ollama Cloud adapter.

The current active-beta candidate implements the five-stage ecological-map workflow described in the requirements. Part 1 groups Micro and Meso; Part 2 groups Exosphere and Macrosphere. Micro returns nodes only. Meso returns no new nodes and may connect only the exact carried Micro IDs. No review or evaluation controls stage, level, candidate, or map access.

PR [#5](https://github.com/CUNY-AI-Lab/systems-mapping/pull/5) and Railway deployment `39d38543-20ca-4626-95e6-237ef9213881` remain historical evidence for the preceding Macro/Integration tree. They do not verify this Exosphere/Macrosphere candidate. A fresh commit, deployment, and live readback remain required.

Earlier local captures remain historical evidence where noted. Current annotated desktop/mobile capture and local verification are complete; GitHub publication, Railway deployment/live readback, and live-provider verification remain pending.

Status terms:

- **Automated verified** — a test run against the current candidate proves the stated contract; live/bundle evidence may still be pending.
- **Bounded** — residual behavior is intentional and explicitly limited.
- **Operational verification pending** — implementation exists, but final runtime, bundle, deployment, credential, or real-data evidence is missing.
- **Open** — required work is not yet complete.

## Finding ledger

| ID | Status | Current evidence | Residual risk / required closure |
| --- | --- | --- | --- |
| SEC-01 — client-visible class code | Automated verified; live receipt pending | Local default `101` is selected by the server rather than compiled into application code. Hosted mode rejects it unless the operator supplies the exact public-demo flag/code pair; private courses require 10–32 characters with at least six distinct characters. The current automated suite and production build passed locally. | The demo code is shared low-assurance access, not authentication or identity. Repeat byte-level bundle and access checks against the deployed candidate. |
| SEC-02 — student session isolation | Implemented; candidate live receipt pending | Student access issues a distinct random, expiring, `HttpOnly`, `SameSite=Strict` cookie; hosted cookies are Secure. Student sessions cannot authorize teacher routes. A stale activity-log 401 is confirmed against the current session before expiring the UI grant. | Verify session, expiry, logout, and teacher-route denial against the candidate deployment. |
| SEC-03 — teacher account claiming | Automated; historical production login retained | Fresh stores seed Maria and Zach without passphrases. Claim requires an explicit account ID, a 16–256 character operator token, and a new passphrase. A token is hashed in the use ledger and authorizes one claim per process. Passphrases use salted scrypt; failures are generic, throttled, and concurrency-bounded. Maria's production account was provisioned on 2026-08-11, a real login passed, the verification session was closed, and the temporary Railway bootstrap variable was removed. | Keep passphrases outside source and logs. Provision Zach separately only when requested, with a fresh one-time operator path. Repeat teacher login only as part of an authorized current live Teacher Console journey. |
| SEC-04 — CSRF, Host, and proxy trust | Implemented; candidate live receipt pending | Every state-changing route requires exact same origin/fetch-site. Local mode accepts only loopback Host; hosted mode requires an exact HTTPS public origin and bounded trusted proxy depth. Earlier tests and deployed-header checks passed against the preceding tree. | Misconfigured `TRUST_PROXY_HOPS` remains an operator risk. Repeat exact-origin and header checks for the candidate. |
| SEC-05 — body and resource exhaustion | Automated verified; live limits pending | Current tests verify bounded content, JSON work, fields, collections, rate windows, per-session supersession, provider concurrency/output, submission queues, database pools, query timeouts, and retention work. This pass removes the buggy course-wide active-evaluation ceiling only; it does not remove those other bounds. | Recheck production error receipts and load limits. Process-local rate buckets reset on restart. |
| SEC-06 — browser response hardening | Automated and local build verified; deployed headers pending | The application asserts restrictive CSP, `DENY` framing, no-referrer, permissions restrictions, nosniff, same-origin opener/resource policy, and `no-store`/`no-cache` for APIs and HTML. The current production build passed locally; earlier live header checks belong to the preceding tree. | Repeat the complete header and byte-level bundle checks against the deployed candidate. |
| SEC-07 — authoritative evaluation tampering | Automated verified; retained review path bounded | The server chooses the runtime and configuration, validates the level-specific result, and returns only `id`, bounded `review`, sanitized configuration/runtime metadata, and timestamps. The current student interface does not submit a note or review snapshot to Teacher Console. The retained submission endpoint still accepts exactly `{evaluationId, studentAnnotation}` and creates its snapshot transactionally when used. Current ordinary and fresh PostgreSQL suites passed. | Repeat the retained transaction against hosted PostgreSQL after deployment. Do not describe the retained endpoint as the current student journey. |
| SEC-08 — capability disclosure | Automated verified; hosted inspection pending | Evaluation and review IDs are random 192-bit bearer capabilities. Portable exports redact both. The retained review-status endpoint also requires a valid class session and returns a minimized response. The current student interface does not create or display a review submission. The current suite passed, and the rendered package contains no credentials. | Anyone who has both a current class session and a leaked retained review ID can read that minimized response. Repeat storage/export inspection against the deployed candidate. |
| SEC-09 — model/prompt and credential leakage | Automated and local scan verified; live pending | Student evaluation output is allowlisted to `id`, bounded `review`, sanitized configuration/runtime metadata, and timestamps. The review allows only `guidance`, `nodes`, `connections`, `example`, and `readiness`. Teacher Console saves settings per Part and section. Its safe preview returns only guidance, course material, Part, section, contextual level, and revision—never the full effective prompt, code-owned guardrails, internal modules, or fingerprints. Current gitleaks scanning found no secret in the dirty diff or three intended untracked documentation/concept files, and the screenshot package contains no credentials. | Published guidance and course material become part of the provider prompt when that runtime is enabled. Run live-provider checks only with an authorized rotated key, and verify live bundle/log parity after deployment. |
| SEC-10 — review history integrity | Retained API implemented; current student handoff absent | Decisions on retained records require an expected revision, a teacher identity, and one instructor focus. Compatible decision IDs and append-only events remain protected in SQLite and PostgreSQL. Every decision is advisory and leaves student stage and map access unchanged. | Review records are immutable until retention, not permanent. Do not infer a current student submission flow from this compatibility surface. |
| SEC-11 — retention and deletion | Automated verified; bounded | Evaluations expire at 1 day; pending snapshots at 30; decided snapshots at 180. Guarded deletion removes submissions and events that contain memo text, then writes a hashed append-only purge receipt. Startup and queue access run bounded purge work. | Institutional policy must accept these periods. Backup/snapshot retention outside the application is not controlled by this code and must be configured separately. |
| SEC-12 — SQL portability and transactions | Automated verified; hosted readback pending | SQLite and PostgreSQL use prepared parameters, matching schema constraints, migration locks, nested/queued transactions, and tested rollback. A fresh native PostgreSQL 17.5 loopback run passed 4/4 current tests, including migration of populated v8 data to v9. Earlier Railway migration receipts still belong to the preceding tree. | Repeat migration and database readback against the candidate Railway deployment. |
| SEC-13 — import and export injection | Automated and rendered verified; deployed bundle parity pending | Schema-owned objects use known-field allowlists; credential/account canaries, invalid references, malformed geometry, policy escalation, and excessive data fail closed. React renders values as text. CSV formula/control/whitespace prefixes are neutralized at the byte boundary. Current tests, production build, and rendered capture checks passed locally. | Repeat byte-level bundle parity and import/export readback against the deployed candidate. Opening exported files still depends on downstream application behavior. |
| SEC-14 — annotation and redaction leakage | Automated verified | Node, evidence, relationship, and map annotations have stable ownership, limits, and reference validation. Restricted projections redact annotations and prose derived from the memo and retain an explicit manifest. Unknown nested canaries fail before export. | Perform current private/course/CUNY/public browser export receipts with realistic sensitive data. |
| SEC-15 — prototype telemetry | Automated verified; bounded | Only named events, canonical section numbers, and bounded numeric/boolean metadata are accepted. Memo text, labels, annotations, prompts, capabilities, and identity are outside the schema. Rows and retention are bounded. | The rate bucket is intentionally shared by local students and process-local; heavy use can throttle activity logging without blocking core local project persistence. |
| SEC-16 — Ollama endpoint/key handling | Automated verified; live pending | Ollama is disabled unless explicitly enabled with a fresh server key. Production URL is pinned to `https://ollama.com`; the key is non-enumerable in validated config and sent only as a bearer header. Timeouts, cancellation, HTTP errors, response size, envelope keys, and JSON result shape fail closed. | The previously pasted key is exposed and must be revoked. No local/Railway key or live request has been configured or verified. |
| SEC-17 — prompt injection and model output | Bounded | The memo and project details are labeled as untrusted data; an additional system instruction requires JSON only. The server rejects extra keys, invalid endpoints, level-incompatible records, and oversized output. Micro is forced to nodes only; Meso is forced to no new nodes and connections only among carried Micro IDs. | This is schema containment, not proof that a model cannot be influenced. A live adversarial provider suite remains required. |
| SEC-18 — memo sharing and storage | Bounded; operational approval pending | The deterministic runtime sends nothing to an outside provider. Provider mode discloses and sends instructor guidance, course material, project instructions, inquiry, level, memo details, and memo text; memo text is capped at 131,072 UTF-8 bytes. The current student interface does not create review submissions. Retained review snapshots keep memo excerpts for 30 or 180 days when that compatibility API is used. | Hosted use requires an explicit institutional decision about memo sensitivity, provider processing, PostgreSQL and backups, and instructor access. Technical opt-in alone is insufficient. |

## Authentication and authorization boundaries

### Local student access

The initial class code `101` is intentionally low-assurance. It is suitable only for opening a loopback classroom workspace. It does not identify a student, protect against another person using the same local machine, or provide cross-device continuity. Local server binding to `127.0.0.1` is part of this boundary.

### Hosted student access

Hosted private-course mode replaces `101` with a stronger operator-supplied server code. A hosted public demo may deliberately retain `101` only through the exact server-side public-demo flag/code pair. Both modes use Secure cookies, HTTPS origin validation, trusted-proxy limits, and session issuance bounds. Either code represents shared class access, not individual institutional identity. If per-student accountability becomes required, SSO or another identity layer is a separate feature.

### Teacher Console access

Teacher authorization is distinct from student access. The public login/claim surface does not enumerate the seeded roster. Bootstrap tokens must be delivered outside the application, used once, and removed after claim. A restart with a fresh token is required for the other unclaimed account.

### Review capabilities

The retained review API uses a high-entropy review ID and requires a valid class session to retrieve its minimized decision. Portable exports remove the ID. The current student interface does not create a review submission or expose a review-status field.

## Ollama Cloud decision record

Ollama Cloud explicitly sends memo text outside the classroom server; it is not a transparent enhancement. The runtime disclosure must be visible before generation. The configured provider does not receive browser credentials or review capability IDs, but it does receive the active Part-and-section guidance, course material, project details, and memo text listed above.

The local `.env` intentionally has an empty `OLLAMA_API_KEY`. The credential previously provided in chat must be considered compromised by disclosure. Required sequence:

1. revoke the exposed key;
2. create a new key;
3. store it only in the local server secret file and/or Railway secret store;
4. verify it never appears in source, bundle, logs, exports, or screenshots;
5. run a separately authorized live acceptance with a non-sensitive test memo.

No current result demonstrates a live Ollama request.

## Railway readiness boundary

The code targets a Railway-style service backed by PostgreSQL: startup requires paired `DATABASE_URL`/`PUBLIC_ORIGIN`, explicit public binding and proxy depth, a strong class code, and bounded pool/timeouts. Final candidate hosted verification remains pending.

Railway deployment `39d38543-20ca-4626-95e6-237ef9213881`, uploaded from clean GitHub `main` commit `abddbd0a2640aa0e4db0dcf0a1c47d65e9983597`, verified migration, headers, public-demo access, session/configuration readback, logout, and bundle parity for the preceding Macro/Integration tree. It is historical evidence only.

A new GitHub-to-Railway chain must be recorded for the Exosphere/Macrosphere candidate. Dirty working-directory deployment `3ea599f4-7fb5-4dd3-998d-c55134a69f15` also remains historical only.

## Final verification checklist

- [x] Preserve the earlier production dependency audit: no known vulnerabilities at the time of that run.
- [x] Preserve the earlier source and application-bundle scan: no credential values; no application-bundle class code, source maps, dangerous HTML sink, teacher identity, review capability, or server prompt. Library-only numeric `101` values were unrelated glyph tables.
- [x] Preserve the 171-test and production-build receipt as a historical baseline for the preceding tree.
- [x] Preserve the earlier local five-stage journey with its then-current instructor-pause behavior as historical evidence; it does not verify current non-blocking review navigation.
- [x] Preserve the preceding Course settings progression-editor recapture at 320, 390, 430, and 1440 px; `/Users/milwright/.codex/visualizations/2026/08/11/019ff16f-b119-7963-9090-525be49b8d8a/systems-mapping-course-settings-2026-08-11.zip` passes `unzip -t`.
- [x] Restart/read back the loopback production server and audit the real SQLite database without printing sensitive values.
- [x] Preserve dirty working-directory deployment `3ea599f4-7fb5-4dd3-998d-c55134a69f15` as historical evidence only.
- [x] Merge PR [#5](https://github.com/CUNY-AI-Lab/systems-mapping/pull/5) to GitHub `main` at `abddbd0a2640aa0e4db0dcf0a1c47d65e9983597` and synchronize local, `origin/main`, and GitHub `main`.
- [x] Preserve clean-main Railway release `39d38543-20ca-4626-95e6-237ef9213881` as historical evidence for the preceding tree.
- [x] Record final candidate test, fresh PostgreSQL, build, dependency, and leakage-scan evidence without carrying forward old counts: 227 ordinary tests passed with 4 guarded PostgreSQL skips; fresh native PostgreSQL 17.5 passed 4/4 including populated v8→v9 migration; `pnpm build` emitted `index-DKxOo_cS.js`, `TeacherDashboard-CO55RhLk.js`, and `index-CisvqIv_.css`; `pnpm audit --prod` reported no known vulnerabilities; gitleaks and `git diff --check` passed.
- [x] Capture and inspect the current student cycle and Teacher Console at desktop and phone sizes: `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ecological-cycle-qa-2026-08-21/systems-mapping-ecological-cycle-qa-2026-08-21.zip`, SHA-256 `89f959144d0257a0a21d6440f7be3a37e50925f60adc7dd1687caeb246277c11`, contains 40 true PNGs, 4 fabricated memos, and 4 metadata/assertion files, with no credentials and no recorded truncation, overlap, overflow, console errors, or captured success toasts.
- [ ] Commit, push, deploy, and verify the candidate through migration, health, access, Teacher Console authentication, public configuration, logout, headers, bundle, and no-5xx checks.
- [ ] Revoke the exposed Ollama key; configure a rotated key only if authorized; run a separate live-provider acceptance.

The correct status is **five-stage Micro/Meso/Exosphere/Macrosphere candidate verified locally and captured across desktop and phone sizes; GitHub update, Railway deployment/live readback, and any separately authorized live-provider run remain pending**.
