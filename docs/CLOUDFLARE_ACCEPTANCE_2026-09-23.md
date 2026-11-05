# Cloudflare source acceptance — September 23, 2026

> **Historical record.** Claims of “current,” “implemented,” or “verified” below refer to this document’s dated source and environment. The November 4 [Memo workspace](MEMO_WORKSPACE_2026-11-04.md), [two-memo workflow](TWO_MEMO_WORKFLOW_2026-11-04.md) and [classification evidence](CLASSIFICATION_EVIDENCE_2026-11-04.md) govern the account application. Older screen, model-output and sphere rules do not override them; the receipts below are preserved, not rerun acceptance.

The isolated candidate starts from canonical main `ae5ea57` and preserves the
existing Cloudflare draft from `Projects/dev/systems-mapping-cloudflare`.
That original checkout and the Node/Railway deployment were not changed.
The current Micro/Meso correction and product requirements govern both versions.

## Checked behavior

- `pnpm check:cloudflare` passed TypeScript, the account frontend build and the
  production Worker dry bundle.
- The complete default test run passed 436 tests, with the four opt-in
  PostgreSQL cases and one opt-in Chrome case skipped there. Those five cases
  were exercised separately as described below.
- All 18 focused identity, Gateway, recovery, real Workerd/SQLite and Chrome
  checks passed. JWTs, Admission and provider responses are controlled fixtures.
  The tests run the actual production Worker, shared Hono application and
  Cloudflare SQLite engine.
- Signed identity legs have exact audiences and one subject. Membership and
  instructor authority are checked per request. Origin checks, forged headers,
  expired credentials, unavailable verification, opaque login/logout, and
  safe project-link return paths fail at their intended boundaries.
- Model actions make one attempt, including invalid structured output and
  quota refusal. Cancellation and body/deadline limits terminate local waiting;
  safe error codes and UUIDv4/v7 support IDs survive the transport.
- Account maps survive actual local Durable Object eviction. Cross-account
  reads and stale browser-account writes are rejected. Concurrent saves with
  the same expected revision produce one success and one conflict.
- Chrome verifies a nine-node ecological map, saved map-note edits, reload,
  a simulated failed account save and recovery, downloaded JSON bytes and IDs,
  a second account, an explicit shared link, and instructor course settings.
  The Teacher Console still starts with its review queue and loads course
  settings only when selected. Desktop and 390-pixel phone captures are native
  browser screenshots; they are local fixture evidence.
- The existing Node browser/accessibility suite passed all 24 desktop and
  phone cases, including map editing, filtering, search, scope links, viewport
  controls, annotations, manual nodes, keyboard use and contrast checks.
- All four integration cases passed against a fresh disposable PostgreSQL 17
  database. One historical migration fixture now pins its clock before its
  expiry, so the test continues to exercise migration rather than automatic
  retention deletion. Production retention logic is unchanged.

## Release evidence still required

At source acceptance, no new Worker was deployed and no live institutional
login, paid model request, account-data migration or recovery rehearsal was
performed. The bundled public JWKS exactly matches the live public Doorway
endpoint; live Gateway verifier bytes are stored as a secret and were not read back.

The source includes exact-main CI release and readback scripts. Their presence
does not establish a configured deployment secret, protected environment,
successful hosted run or completed release. Record the pushed commit, hosted
checks, deployed version, binding readback and signed-in acceptance separately.
No Gateway, Doorway or Admission release is part of this product deployment.
