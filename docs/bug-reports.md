# Report a bug or request a feature

## Control placement

The bug icon stays at the far right of the project header. The matching information icon sits immediately to its left; it opens introductory copy rather than a report form. Preserve recognizable button boundaries and 44px targets. The report form keeps margins between its text area, delivery explanation and submit action, and wraps at phone widths. The information flag's timeout and dismissal do not submit or clear a bug-report draft.

## Delivery configuration

Both [production](../wrangler.jsonc) and [Dev](../wrangler.dev.jsonc) select
`BUG_REPORT_MODE=redmine`. New bug reports and feature requests go directly to
CAIL Ticketing using the existing `REDMINE_API_KEY` secret. Explicit Redmine mode
never substitutes email, including when the key is missing or Redmine refuses a
request. A missing key disables reporting and returns 503; it does not create a
receipt or send data elsewhere.

The dialog heading is **Report a bug or request a feature** and the description
prompt is **What went wrong? What could be better?**. The delivery explanation
states that the report becomes a private ticket. The form accepts either kind
of report in the same description field; the existing support tracker handles
triage without adding another required choice.

`GET /api/bug-reports/availability` returns `enabled`, `mode: "contact"`,
`delivery: "redmine"`, and `fallback: null` for this configuration. This establishes
configuration only; it does not prove a live ticket was accepted.

The retained `BUG_REPORTS` binding in production supports receipt recovery for
reports sent by earlier email releases. It is not used for new reports in
explicit Redmine mode. Older installations may still select `email` or use the
legacy automatic preference; those compatibility paths retain their prior
account checks and receipt behavior.

## Identity, report contents, and routes

The header bug icon opens a form for either CUNY Login or a guest's first name, last name,
and .edu email address. Guest details are self-reported contact information.
Signed-in names come from the verified application identity.

- `GET /api/bug-reports/session` verifies the account and returns `expectedActor`
  and `preferredName`.
- `POST /api/bug-reports` accepts exactly
  `{reportId, expectedActor, description, path}` and rejects an account change.
- `POST /api/bug-reports/guest` accepts exactly
  `{reportId, firstName, lastName, email, description, path}`. Shared client and
  server validation checks names and .edu email syntax.

Email submission uses Admission's existing description-only contract. It
includes the unchanged report description, a fixed page category, release,
reference, and server-derived daily rate metadata. It adds neither account
identity nor guest contact fields to the message. The form explains that a
reporter who wants a reply should include contact details in the description.
The complete 4,000-character description remains intact in this compatibility path.

Redmine delivery creates a private issue in CAIL Ticketing project 15, Bug
tracker 2. Its description includes the report, page category, release,
reference, time, and verified account-name metadata or clearly labeled guest
contact details. Private visibility follows Redmine's permissions.

Context uses fixed page categories. Email supports `/` and `/p/:shared-map`;
other admitted page categories become `/` for the shared receiver. Project
identifiers, shared-link capabilities, query strings, and fragments stay out of
this context. Memo or map contents are included only when a reporter adds them
to the description.

## Durable receipts and recovery

The application's Durable Object stores receipt metadata: owner reference,
report UUID, content fingerprint, creation time, state, delivery channel,
Redmine issue ID when applicable, and a flag recording a definitive rejection.
Guest receipts also retain a network rate reference. It stores neither the
report description nor contact text. Browser drafts stay in tab memory, with a
leave-page warning while work is pending.

The selected channel is persisted before dispatch. Concurrent local requests
share one in-flight submission; saved receipts replay after eviction or deployment.
The same UUID with different content returns an idempotency conflict.

| Outcome in explicit Redmine mode | Application behavior |
|---|---|
| Redmine confirms a valid issue ID | Save and replay the private-ticket receipt. |
| Redmine returns 400, 401, 403, 404, or 422 | Preserve the rejected receipt and the browser draft; do not send email. |
| Redmine returns 429 | Retain the reference for a retry; do not send email. |
| Timeout, connection exception, 408, 5xx, redirect, or unreadable success | Keep the Redmine receipt pending; a status check searches for the original issue marker. |
| The original issue is found after a lost acknowledgement | Save and replay that receipt without another creation request. |
| A prior email receipt is checked | Retain its original channel and derived UUID; never duplicate it as a Redmine ticket. |

An uncertain Redmine request never triggers another creation request or a
second-channel send. An unsuccessful reconciliation remains pending. Earlier
receipt tables and rejection metadata stay readable. The legacy automatic mode
still permits fallback only after a classified definitive rejection, while
explicit Redmine mode disables it. Existing email receipts continue using the
original owner-scoped UUID and Admission's durable acceptance contract.

## Acknowledgements and limits

A Redmine success returns `status: "saved", delivery: "redmine"`; the form says
**Saved to CAIL Ticketing**. An email success returns
`status: "accepted", delivery: "email"` and `deliveryReference`; the form says
**Accepted for email delivery** and shows that reference. Provider acceptance
and inbox arrival are separate outcomes. The browser keeps uncertain drafts
locked and offers **Check status** with the same local reference.

Request bodies are bounded to 32,768 bytes and five seconds of reading. Reports
require UUIDv4 references and 10–4,000 UTF-16 description units after whitespace
normalization. Each owner can create 10 receipts per rolling 24 hours; guest
network references can create 20. Configured Redmine keys preserve the existing
keyed network reference; email-only deployments use a daily IP digest. Worker
ingress limits and the shared email receiver's independent limits also apply.

Redmine responses are bounded to 2 MiB and 18 seconds. Requests keep credentials
on the configured host. Email RPC waits are bounded to 18 seconds, while the
receiver retains responsibility for any dispatch already in progress. Neither
closing the form nor a lost browser connection establishes that delivery stopped.

## Earlier anonymous installations

When neither an explicit delivery mode nor a Redmine key is configured, the
retained anonymous form and handler use `AdmissionBugReports.submitPublic`
directly. This route accepts `{reportId, description, path}` and stays separate
from account and course authorization. Its accepted receipt also means provider
acceptance. The explicit contact modes retain their authenticated or validated
guest boundaries.

## Verification

Synthetic tests cover routing, contact validation, channel selection, definitive
refusals, uncertain Redmine outcomes, email receipt replay, concurrent requests,
legacy receipt migration, and real Durable Object eviction. The contact form
checks channel-specific acknowledgements and retains the same draft reference
through status checks. The email runtime harness exercises the production
Worker, real local storage, and a synthetic email receiver.

Tests for the current configuration cover direct private-ticket creation,
feature-request text, duplicate receipts, missing credentials, and definitive
rejections without email dispatch. The existing email tests remain as recovery
coverage for earlier releases. No automated fixture creates a live support ticket.

A live acceptance record must separately verify an explicitly authorized report
and its private Redmine issue. Secret-name presence, availability and health
responses establish configuration only. See the [deployment guide](cloudflare-deployment.md)
for release verification.
