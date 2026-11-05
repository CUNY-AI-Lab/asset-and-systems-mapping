# Systems Mapping security review

Updated: 2026-08-24

## November 4 account change review requirements

The ledger below is an August security review, preserved as dated evidence. Its “current” and “verified” claims refer to that source and Node/Railway environment, not acceptance of the latest account release. Current identity, Admission, Gateway and deployment boundaries are in [cloudflare deployment](cloudflare-deployment.md).

The Memo workspace changes require a focused regression audit: preserve account isolation and optimistic revisions; bound and validate independent memo analysis/update objects; retain only supplied-current-source evidence; reject unknown or duplicate identities before graph mutation; commit connected nodes/edges and analysis/graph updates atomically; preserve manually edited and removed records; and strip analysis/history from all non-private exports. Node colors use an allowlisted enum, not arbitrary CSS. Information copy renders as text with no HTML-injection path. No new service, credentials, role grants, email action or provider call is implied by opening controls or Continue.

Audit these requirements in the integrated source and actual Dev build before production promotion. Automated containment does not prove correct model interpretation; use the separate classification and real-memo acceptance cases. No August receipt closes these new checks.

## Historical August scope and claim boundary

This review covers the current React application, Node/Hono server, SQLite and PostgreSQL adapters, student class access, teacher authentication, authoritative evaluation, instructor review, import/export, prototype telemetry, and optional Ollama Cloud adapter.

The current working contract uses the five-stage ecological-map workflow described in the requirements. Part 1 groups Micro and Meso; Part 2 groups Exosphere and Macrosphere. Micro may return discrete elements and direct relationships with verbs. Meso may return only noun-labeled `mesosystem` linkages scoped to at least two eligible carried Micro settings, with zero relationship edges. No review or evaluation controls stage, level, candidate, or map access.

PR [#9](https://github.com/CUNY-AI-Lab/systems-mapping/pull/9) merged the earlier ecological tree into `main` at `7f6444147d34a4c62203eb1a3943fcfd6c3f4491`. Railway deployment `51a03b7e-6752-4681-8714-5bbf6106d843` reached `SUCCESS` from that clean commit and passed migration, health, hosted access, student-to-teacher API denial, configuration, logout, headers, bundle parity, provider, and no-5xx readback. That deployment implements the superseded node-only Micro/generic-edge Meso contract. PR #5 and deployment `39d38543-20ca-4626-95e6-237ef9213881` remain historical evidence for the preceding Macro/Integration tree.

Earlier local captures remain historical evidence where noted. The 2026-08-24 Micro/Meso correction requires new local verification, source-built browser captures, GitHub publication, Railway deployment/readback, and fabricated-memo live-provider verification. No authenticated production Teacher Console mutation was performed, and provider-key rotation provenance was not inspected.

Status terms:

- **Automated verified** — a test run against the current candidate proves the stated contract; live/bundle evidence may still be pending.
- **Bounded** — residual behavior is intentional and explicitly limited.
- **Operational verification pending** — implementation exists, but final runtime, bundle, deployment, credential, or real-data evidence is missing.
- **Open** — required work is not yet complete.

## Finding ledger

| ID | Status | Current evidence | Residual risk / required closure |
| --- | --- | --- | --- |
| SEC-01 — client-visible class code | Automated and live verified | Local default `101` is selected by the server rather than compiled into application code. Hosted public-demo access returned 201 only through the configured server path; exact deployed bundle hashes matched local production assets. | The demo code is shared low-assurance access, not authentication or identity. |
| SEC-02 — student session isolation | Automated and live verified | Hosted access issued a session, session readback succeeded, a student cookie received 401 from the Teacher API, logout returned null, and subsequent session readback remained null. | Expiry timing remains covered by automated tests rather than a deliberate production wait. |
| SEC-03 — teacher account claiming | Automated; historical production login retained | Fresh stores seed Maria and Zach without passphrases. Claim requires an explicit account ID, a 16–256 character operator token, and a new passphrase. A token is hashed in the use ledger and authorizes one claim per process. Passphrases use salted scrypt; failures are generic, throttled, and concurrency-bounded. Maria's production account was provisioned on 2026-08-11, a real login passed, the verification session was closed, and the temporary Railway bootstrap variable was removed. | Keep passphrases outside source and logs. Provision Zach separately only when requested, with a fresh one-time operator path. Repeat teacher login only as part of an authorized current live Teacher Console journey. |
| SEC-04 — CSRF, Host, and proxy trust | Automated and live verified | A state-changing access request without same-origin headers returned 403; the same request with the exact deployed origin/fetch-site returned 201. Hosted Host/origin/proxy configuration checks and response headers passed. | Misconfigured `TRUST_PROXY_HOPS` remains an operator risk. |
| SEC-05 — body and resource exhaustion | Automated verified; live limits pending | Current tests verify bounded content, JSON work, fields, collections, rate windows, per-session supersession, provider concurrency/output, submission queues, database pools, query timeouts, and retention work. This pass removes the buggy course-wide active-evaluation ceiling only; it does not remove those other bounds. | Recheck production error receipts and load limits. Process-local rate buckets reset on restart. |
| SEC-06 — browser response hardening | Automated and live verified | The deployed root returned restrictive CSP, `DENY` framing, no-referrer, nosniff, same-origin opener/resource policy, and `no-store`; its three changed asset hashes matched local production bytes. | Keep header checks in future release receipts. |
| SEC-07 — authoritative evaluation tampering | Automated verified; retained review path bounded | The server chooses the runtime and configuration, validates the level-specific result, and returns only `id`, bounded `review`, sanitized configuration/runtime metadata, and timestamps. The current student interface does not submit a note or review snapshot to Teacher Console. The retained submission endpoint still accepts exactly `{evaluationId, studentAnnotation}` and creates its snapshot transactionally when used. Current ordinary and fresh PostgreSQL suites passed. | Repeat the retained transaction against hosted PostgreSQL after deployment. Do not describe the retained endpoint as the current student journey. |
| SEC-08 — capability disclosure | Automated verified; hosted inspection pending | Evaluation and review IDs are random 192-bit bearer capabilities. Portable exports redact both. The retained review-status endpoint also requires a valid class session and returns a minimized response. The current student interface does not create or display a review submission. The current suite passed, and the rendered package contains no credentials. | Anyone who has both a current class session and a leaked retained review ID can read that minimized response. Repeat storage/export inspection against the deployed candidate. |
| SEC-09 — model/prompt and credential leakage | Automated, scanned, and live verified | Student evaluation output remained allowlisted to `id`, bounded `review`, sanitized configuration/runtime metadata, and timestamps. Live fabricated-memo reviews returned only the five review keys; deployed bundles matched local bytes; gitleaks and the screenshot-package credential scan passed. | Published guidance and course material become part of the provider prompt. Key rotation provenance remains an operator confirmation; no key value was inspected. |
| SEC-10 — review history integrity | Retained API implemented; current student handoff absent | Decisions on retained records require an expected revision, a teacher identity, and one instructor focus. Compatible decision IDs and append-only events remain protected in SQLite and PostgreSQL. Every decision is advisory and leaves student stage and map access unchanged. | Review records are immutable until retention, not permanent. Do not infer a current student submission flow from this compatibility surface. |
| SEC-11 — retention and deletion | Automated verified; bounded | Evaluations expire at 1 day; pending snapshots at 30; decided snapshots at 180. Guarded deletion removes submissions and events that contain memo text, then writes a hashed append-only purge receipt. Startup and queue access run bounded purge work. | Institutional policy must accept these periods. Backup/snapshot retention outside the application is not controlled by this code and must be configured separately. |
| SEC-12 — SQL portability and transactions | Automated and hosted migration verified | SQLite and PostgreSQL use prepared parameters, matching schema constraints, migration locks, nested/queued transactions, and tested rollback. Fresh PostgreSQL 17.5 passed 4/4 locally, including populated v8→v9 migration; deployment `51a03b7e-6752-4681-8714-5bbf6106d843` logged `Systems Mapping PostgreSQL schema is ready.` before startup. | Hosted data values were not printed or exported. |
| SEC-13 — import and export injection | Automated, rendered, and deployed-bundle verified | Schema-owned objects use known-field allowlists; credential/account canaries, invalid references, malformed geometry, policy escalation, and excessive data fail closed. React renders values as text. CSV formula/control/whitespace prefixes are neutralized at the byte boundary. Deployed app, Teacher Console, and CSS hashes matched local production bytes. | Opening exported files still depends on downstream application behavior. |
| SEC-14 — annotation and redaction leakage | Automated verified | Node, evidence, relationship, and map annotations have stable ownership, limits, and reference validation. Restricted projections redact annotations and prose derived from the memo and retain an explicit manifest. Unknown nested canaries fail before export. | Perform current private/course/CUNY/public browser export receipts with realistic sensitive data. |
| SEC-15 — prototype telemetry | Automated verified; bounded | Only named events, canonical section numbers, and bounded numeric/boolean metadata are accepted. Memo text, labels, annotations, prompts, capabilities, and identity are outside the schema. Rows and retention are bounded. | The rate bucket is intentionally shared by local students and process-local; heavy use can throttle activity logging without blocking core local project persistence. |
| SEC-16 — Ollama endpoint/key handling | Historical live functional path verified; corrected contract pending | The earlier production release reported `ollama-cloud`; fabricated memos returned schema-valid reviews through `deepseek-v4-flash:0731`, and provider-failure searches and HTTP 5xx were zero. The key remained non-enumerable and was not printed. That run used the superseded Micro/Meso schema. | Repeat the fabricated-memo provider run for Micro relationships and Meso scoped linkages. The credential owner must still confirm that the enabled key is the rotated replacement for the previously exposed value. |
| SEC-17 — prompt injection and model output | Bounded; corrected contract verification pending | The memo and project details are labeled as untrusted data; an additional system instruction requires JSON only. The server rejects extra keys, invalid endpoints, level-incompatible records, and oversized output. Micro permits only discrete nodes and valid direct relationships. Meso permits only noun-labeled `mesosystem` nodes scoped to at least two eligible carried Micro settings and rejects relationship edges or verbs. | This is schema containment, not proof that a model cannot be influenced. Run the corrected automated and live adversarial provider suites. |
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

The local `.env` intentionally has an empty `OLLAMA_API_KEY`. Railway reported the provider as enabled, and fabricated-memo live acceptance succeeded without printing the credential. The credential previously provided in chat must still be considered compromised by disclosure. Required operator closure is:

1. revoke the exposed key;
2. create a new key;
3. confirm that the current Railway secret is the rotated replacement;
4. verify it never appears in source, bundle, logs, exports, or screenshots;
5. repeat acceptance when credentials or provider configuration change.

The earlier release demonstrated live `ollama-cloud` requests with fabricated memos across all four levels and connection refinement. It does not establish the corrected Micro/Meso schema or the unobservable credential-rotation history.

## Railway readiness boundary

The code targets a Railway-style service backed by PostgreSQL: startup requires paired `DATABASE_URL`/`PUBLIC_ORIGIN`, explicit public binding and proxy depth, a strong class code, and bounded pool/timeouts. The last hosted verification passed on deployment `51a03b7e-6752-4681-8714-5bbf6106d843`; it predates the 2026-08-24 correction.

Railway deployment `39d38543-20ca-4626-95e6-237ef9213881`, uploaded from clean GitHub `main` commit `abddbd0a2640aa0e4db0dcf0a1c47d65e9983597`, verified migration, headers, public-demo access, session/configuration readback, logout, and bundle parity for the preceding Macro/Integration tree. It is historical evidence only.

The last verified GitHub-to-Railway chain is PR #9 → `main` `7f6444147d34a4c62203eb1a3943fcfd6c3f4491` → deployment `51a03b7e-6752-4681-8714-5bbf6106d843`. It is historical evidence for the superseded contract. Dirty working-directory deployment `3ea599f4-7fb5-4dd3-998d-c55134a69f15` remains historical only.

## Final verification checklist

Checked items below record the 2026-08-21 release and remain historical. They do not close the 2026-08-24 Micro/Meso correction.

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
- [x] Commit, push, deploy, and verify the candidate through migration, health, access, Teacher Console route/authorization boundary, public configuration, logout, headers, bundle, and no-5xx checks.
- [x] Run fabricated-memo live-provider acceptance across all four levels and connection refinement without exposing the key.
- [ ] Confirm with the credential owner that the enabled provider key is the rotated replacement; no credential value was inspected in this release.

The correct status is **the last deployed five-stage release has local, browser, GitHub, Railway, and fabricated-memo provider receipts, but it uses the superseded Micro/Meso schema. The 2026-08-24 Micro relationships and Meso scoped-linkage correction still requires current automated, browser, deployment, and live-provider proof. Authenticated production Teacher Console mutation and credential-owner rotation confirmation were not performed**.
