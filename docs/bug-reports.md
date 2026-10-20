# Authenticated private bug reports

The Cloudflare frontend has a compact footer button that opens a report panel
with one description field. It uses the existing CUNY Login. The Node/Railway frontend is unchanged.
Reports are saved for the protected Lab administrator desk at
https://tools.ailab.gc.cuny.edu/admin. This flow never sends email or calls a model.
The previous anonymous name/email form and SES delivery flow are superseded.

## Authentication and attribution

`GET /api/bug-reports/session` and `POST /api/bug-reports` pass through the existing
`authorize()` function and account request limiter. That function requires the
opaque app cookie, valid exact-audience Systems and Gateway JWTs for the same
canonical subject, and fresh Admission membership. The report branch runs before
course resolution, so a failure of the selected course does not prevent an
admitted person from reporting it. No course instructor flag grants report
administration.

The session endpoint returns only an opaque, app-specific SHA-256 comparison
marker derived from the verified subject. It is not an authentication credential.
The controller pins it before the first edit and sends it as `expectedActor`.
Every POST compares it with the freshly verified account before any report RPC.
An account switch returns 409 and cannot attribute the old draft to the new user.
The marker is not forwarded, persisted or logged. No name, email, raw subject or
JWT reaches the browser through reporting.

POST accepts exactly `reportId`, `description`, `path`, and `expectedActor`.
Only the description is an editable form field. Requests require the exact origin,
JSON, at most 16,384 bytes, a UUIDv4 and 10–4000 characters of normalized text.
The server derives the canonical subject, configured origin and release. The
receiving service rechecks membership and supplies the canonical creation time
and protected identity attribution. Only typed receipt fields return to the app.

The browser sends a page category. Both browser and server replace
`/p/<bearer-capability>` with `/p/:shared-map`. The server permits only `/`
and `/p/:shared-map`; unknown paths, queries and fragments
are rejected. It never attaches maps, notes, conversations, audio, logs, headers,
cookies, screenshots, project identifiers or an arbitrary URL.

## Draft and retry behavior

Descriptions stay in the current tab's memory; closing the browser tab or reloading clears them.
Closing the pop-out keeps the draft. Escape and the close button return focus to
the footer button; clicking outside dismisses without moving focus away from the
chosen app control. The nonmodal panel uses the browser's top layer with a fixed
position fallback. It anchors above the button, fits narrow screens, respects
reduced motion, and stays clear of Systems Map/Notebook navigation. A fixed-label
page preview never renders a raw URL, share token, project name or user identity.
A pending draft requests the browser's normal leave-page confirmation. Session
expiry keeps the draft in place and offers CUNY Login in a new tab plus an explicit
Check sign-in action. That check never submits a report. The same account can
resume after signing in; a different account cannot adopt the draft silently.

After a lost acknowledgement or an unavailable receiver, the original text and
UUID remain locked together. Check report status explicitly resubmits that exact
report. The receiver's app/subject/UUID idempotency returns the original saved
receipt, so no automatic resend or new UUID is needed. A known rate refusal keeps
the text and observes Retry-After. Success says **Report saved**, which means
persistent storage acknowledged the report; it makes no email-delivery claim.

`src/support/form.js` and `form.css` are shared with Stem. `mountBugReport` returns
its cleanup function, with `hasDraft()` and `sessionChanged()` hooks. It also
publishes a boolean-only `cail:report-draft` event. Systems supplies its route
normalizer and React lifecycle wrapper. Existing desktop/phone map, notebook,
full-screen and print layout behavior is preserved.

## Service contract and release boundary

The private receiver is `AdmissionBugReports.submitAuthenticated`:

```ts
{ reportId, subject, description, origin, path, release }
// success
{ ok: true, status: 'saved', reportId, createdAt }
```

Typed failures are `invalid`, `forbidden`, `not_admitted`,
`idempotency_conflict`, `rate_limited`, or `unavailable`, with `retryable` and an
optional bounded retry delay. The shared wire contract and central schema/admin
implementation belong to `cail-tools-admission`; this app cannot list or triage
reports and has no administrator service capability.

**Production remains disabled.** Both active Wrangler configurations have their
existing bindings unchanged and contain no `BUG_REPORTS` binding. The review-only
proposal is in `../systems-evidence/authenticated-report-binding-proposal.patch`.
Applying it would grant Systems a new persistent, app-scoped capability to the
existing Admission service. That requires explicit approval under the user's
restriction on new bindings/security permissions. No alternate existing identity
or resolver capability is repurposed to bypass this boundary. Missing capability
fails closed. No commit, push, merge or deployment is part of this local work.

## Validation

`bug-reports.test.ts` covers exact fields, account comparison, sanitized metadata,
capability-path removal, body limits, origin/method checks, missing binding,
release validation, cancellation and bounded receipts. `bug-report-runtime.test.js`
uses the production Worker handler, the real identity verifier with synthetic
signed app/Gateway JWTs, synthetic membership and a mocked report store. Its
browser cases run with `SYSTEMS_MAPPING_BROWSER_ACCEPTANCE=1` and exercise one
field, expired/switched accounts, same-UUID recovery, privacy and current map
layout on desktop/phone. Test-only keys, session translation and report receiver
are absent from release configuration. No test uses a real account, student
content, email or paid inference.

These local checks do not prove deployment, live CUNY sign-in, the central admin
flow, or durable production receipt readback. Those remain separate release and
acceptance boundaries owned by the integrated change.
