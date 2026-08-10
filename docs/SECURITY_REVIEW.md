# Systems Mapping security review

Updated: 2026-08-09

## Scope and claim boundary

This review covers the current React application, Node/Hono server, SQLite and PostgreSQL adapters, student class access, teacher authentication, authoritative evaluation, instructor review, import/export, prototype telemetry, and optional Ollama Cloud adapter.

It does not claim that the frozen pedagogy changes, every teacher-decision branch, or a live Ollama provider have been accepted. The published release had 130 passing tests plus 3 PostgreSQL-gated skips, a successful build, green dependency/leak scans, a healthy preserved SQLite handoff store, private GitHub publication, and successful Railway/PostgreSQL deployment with public health readback. The changed server contract passes 53 SQLite/server tests plus a fresh PostgreSQL 17 integration run of 3/3; the integrated frozen tree passes 132 tests with 3 PostgreSQL-gated skips, and its production build succeeds. Prior rendered evidence covers the approve path, map interaction, annotation, and 11 states at configured 320, 390, 430, and 1440 px, but it predates the frozen student-prompt and teacher focus/question surfaces. Final changed-tree security scans, rendered acceptance, publication, and Railway redeployment remain pending.

Status terms:

- **Automated verified** — current source and regression tests prove the stated contract; live/bundle evidence may still be pending.
- **Bounded** — residual behavior is intentional and explicitly limited.
- **Operational verification pending** — implementation exists, but final runtime, bundle, deployment, credential, or real-data evidence is missing.
- **Open** — required work is not yet complete.

## Finding ledger

| ID | Status | Current evidence | Residual risk / required closure |
| --- | --- | --- | --- |
| SEC-01 — client-visible class code | Automated verified; bundle scan pending | Local default `101` is selected by the server. Client tests exchange a code asynchronously and persist no rejected code. Hosted startup rejects `101` and requires 10–32 characters with at least six distinct characters. | Run the final `dist/` scan to prove `101` and the hosted code are absent. The local code remains a convenience, not authentication. |
| SEC-02 — student session isolation | Automated verified | Student access issues a distinct random, expiring, `HttpOnly`, `SameSite=Strict` cookie; hosted cookies are Secure. Student sessions cannot authorize teacher routes. A stale activity-log 401 is confirmed against the current session before expiring the UI grant. | Verify access, expiry, logout, and teacher-route denial in the current browser build. |
| SEC-03 — teacher account claiming | Automated verified | Fresh stores seed Maria and Zach without passphrases. Claim requires an explicit account ID, a 16–256 character operator token, and a new passphrase. A token is hashed in the use ledger and authorizes one claim per process. Passphrases use salted scrypt; failures are generic, throttled, and concurrency-bounded. | Claim both accounts only with temporary values against a disposable database. Confirm the real database remains unclaimed and contains no QA credentials/sessions. |
| SEC-04 — CSRF, Host, and proxy trust | Automated verified | Every state-changing route requires exact same origin/fetch-site. Local mode accepts only loopback Host; hosted mode requires an exact HTTPS public origin and bounded trusted proxy depth. Tests reject missing/foreign origin, untrusted Host, and mismatched forwarding. | Verify headers/origin behavior through the final loopback and Railway proxies. Misconfigured `TRUST_PROXY_HOPS` remains an operator risk. |
| SEC-05 — body and resource exhaustion | Automated verified | Content type, total request bytes, JSON depth/work/keys/arrays, field lengths, collections, rate windows, concurrent evaluation, queue size, provider request/output, database pool, and query timeouts are bounded. | Recheck production error receipts and load limits after Railway variables are selected. Process-local rate buckets reset on restart. |
| SEC-06 — browser response hardening | Automated verified; live pending | Tests assert restrictive CSP, `DENY` framing, no-referrer, permissions restrictions, nosniff, same-origin opener/resource policy, and `no-store`/`no-cache` for APIs and HTML. | Read back final production headers and confirm there is no permissive CORS or source-map exposure. |
| SEC-07 — authoritative evaluation tampering | Automated and PostgreSQL verified; browser pending | The browser cannot submit result/configuration content for review. The server evaluates and validates the full result, stores it teacher-side, derives at most three short source prompts, and returns no criteria, score, threshold, outcome, or full suggestion to the student. Review submission remains exactly `{evaluationId, studentAnnotation}`; consumption and snapshot creation are transactional. | Browser-test expiry, replay, changed-source race, projection rejection, and recovery messaging. |
| SEC-08 — capability disclosure | Automated verified; bounded | Evaluation and review IDs are random 192-bit bearer capabilities. All portable tiers redact both. Student review GET also requires a valid class session and returns only minimized status, one instructor focus, and an optional focused question—not source, criteria/scores, prompt configuration, teacher identity, or teacher-only model details. | Anyone who has both a current class session and a leaked review ID can read that minimized response. Treat IDs as secrets; repeat bundle/storage/export inspection after rebuild. |
| SEC-09 — model/prompt and credential leakage | Automated verified; final bundle scan pending | Student evaluation output is allowlisted to `id`, `redirects`, sanitized configuration/runtime metadata, and timestamps. Redirects accept only `action` plus optional `evidenceExcerpt`; full criteria/scores remain teacher-authenticated and collapsed in the UI. Fixed/shared prompt bodies, project custom-instruction text, and the Ollama key are excluded. | Scan the rebuilt source/bundle/logs/exports and inspect live responses. Teacher module bodies and full evaluation details intentionally remain available to authenticated teachers. |
| SEC-10 — review history integrity | Automated verified | Decisions require an expected revision, a teacher identity, and one instructor focus. Only the `revise_and_approve` compatibility decision—displayed as **Approve with a question**—accepts one bounded focused question; legacy revised-suggestion input is rejected. SQLite and PostgreSQL protections prevent review-event mutation outside guarded retention. | Review records are immutable until retention, not permanent. Verify all three decisions against the changed Railway deployment. |
| SEC-11 — retention and deletion | Automated verified; bounded | Evaluations expire at 1 day; pending snapshots at 30; decided snapshots at 180. Guarded deletion removes source-bearing submissions/events and writes a hashed append-only purge receipt. Startup and queue access run bounded purge work. | Institutional policy must accept these periods. Backup/snapshot retention outside the application is not controlled by this code and must be configured separately. |
| SEC-12 — SQL portability and transactions | Automated verified | SQLite and PostgreSQL use prepared parameters, matching schema constraints, migration locks, nested/queued transactions, and tested rollback. A fresh PostgreSQL 17 run completed the review workflow. | Railway connection SSL/pool/timeouts and actual migration state remain unverified. |
| SEC-13 — import and export injection | Automated verified | Schema-owned objects use known-field allowlists; credential/account canaries, invalid references, malformed geometry, policy escalation, and excessive data fail closed. React renders values as text. CSV formula/control/whitespace prefixes are neutralized at the byte boundary. | Final static scan must reconfirm no dangerous HTML sink or unexpected serialization path was added. Opening exported files still depends on downstream application behavior. |
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

Railway project/service/database creation, variables, migration, terminal deployment success, and public database-backed health readback are verified for the published release. Deployment `f23a2cf0-6f4b-462f-b1e2-8a1c5e2bc7de` is live at `https://web-production-08455.up.railway.app`. The frozen student-prompt/teacher-focus tree is newer local work and requires a new deployment/readback before those semantics can be attributed to Railway. The health endpoint intentionally accepts Railway's internal hosted readiness Host while all other hosted routes retain exact public Host/origin enforcement. Secure-cookie, all-decision review, retention, and value-free database acceptance remain operational gates. If Ollama is enabled, the rotated key and live egress test remain separate gates.

## Final verification checklist

- [ ] Re-run `pnpm audit` and `pnpm audit --prod` on the final changed-tree lockfile; retain the earlier green release scan as historical evidence.
- [ ] Scan source and `dist/` for `101`, configured class codes, credential values/field leakage, passphrase fixtures outside tests, session/capability material, prompt bodies, teacher roster/history, `dangerouslySetInnerHTML`, and source maps.
- [x] Run the frozen full suite and production build: 132 passed, 3 PostgreSQL-gated skipped, and the production Vite build passed.
- [ ] Complete all three teacher decisions in the in-app browser using a disposable database, with student output limited to three source prompts, teacher model details collapsed, one instructor focus, and an optional question.
- [ ] Recapture the changed student/teacher states at desktop and 320/390/430 px; verify focus, touch targets, map interaction, persistence, exports, and console state.
- [x] Restart/read back the loopback production server and audit the real SQLite database without printing sensitive values.
- [ ] Publish/read back the frozen pedagogy commit to the existing private `CUNY-AI-Lab/systems-mapping` repository.
- [ ] Deploy/read back the frozen pedagogy tree on the existing Railway/PostgreSQL project; verify terminal success and the changed review contract live.
- [ ] Revoke the exposed Ollama key; configure a rotated key only if authorized; run a separate live-provider acceptance.

Until those boxes are complete, the correct status is **frozen client/server/build green; final security scans, rendered acceptance, publication, and operational security verification pending**.
