# Report a bug

## Delivery configuration

The release configuration selects `BUG_REPORT_MODE=email` in
[wrangler.jsonc](../wrangler.jsonc). Reports use the existing `BUG_REPORTS`
service binding to `cail-tools-admission`, whose email receiver manages the
recipient and provider. Zach confirmed `zmuhlbauer1@gmail.com` for this workflow.
The application carries no Gmail credential and accepts no browser-supplied
recipient. Release acceptance checks a fresh report against that inbox.

Explicit `email` and `redmine` modes both keep the contact form and its account
checks. A delivery-mode change therefore preserves the authorization rules for
an in-flight draft. In email mode, new reports go directly to the email receiver.
In Redmine mode, new reports use Redmine when its key is configured and email
when the key is absent. A definitive Redmine rejection also permits email
fallback. The receipt rules below distinguish these cases from uncertain sends.

`GET /api/bug-reports/availability` returns `enabled`, `mode: "contact"`, the
preferred `delivery`, and an optional email `fallback`. These fields describe
configured capabilities; actual provider acceptance and inbox arrival require
a report transaction. When both delivery capabilities are absent, reporting is
disabled and requests return 503.

## Identity, report contents, and routes

The footer opens a form for either CUNY Login or a guest's first name, last name,
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
The complete 4,000-character description survives fallback.

Redmine delivery creates a private issue in CAIL Ticketing project 15, Bug
tracker 2. Its description includes the report, page category, release,
reference, time, and verified account-name metadata or clearly labeled guest
contact details. Private visibility follows Redmine's permissions.

Context uses fixed page categories. Email supports `/` and `/p/:shared-map`;
other admitted page categories become `/` for the shared receiver. Project
identifiers, shared-link capabilities, query strings, and fragments stay out of
this context. Memo or map contents are included only when a reporter adds them
to the description.

## Durable receipts and safe fallback

The application's Durable Object stores receipt metadata: owner reference,
report UUID, content fingerprint, creation time, state, delivery channel,
Redmine issue ID when applicable, and a flag recording a definitive rejection.
Guest receipts also retain a network rate reference. It stores neither the
report description nor contact text. Browser drafts stay in tab memory, with a
leave-page warning while work is pending.

The channel is persisted before dispatch. Email uses a stable UUID derived from
the local owner and report UUID; the shared receiver owns the durable email
claim and provider-acceptance receipt. Its source records the claim before
calling SES and replays an accepted receipt for the same reference. Concurrent
local requests share one in-flight submission. Eviction or deployment changes
preserve each report's selected channel.

| Outcome | Application behavior |
|---|---|
| New report with email preference, or Redmine key absent | Submit through the email binding. |
| Redmine returns 400, 401, 403, 404, 422, or 429 | Persist the definitive refusal, then use email if available. |
| Redmine timeout, connection exception, 408, 5xx, redirect, or unreadable success | Retain the Redmine receipt as pending; a status check searches for the original issue marker. |
| Redmine issue is found after a lost acknowledgement | Save and replay the Redmine receipt. |
| Email receiver confirms acceptance | Save and replay the email receipt with its delivery reference. |
| Email response or acknowledgement is uncertain | Keep the same email UUID for a status check against the receiver's durable receipt. |
| Email receiver explicitly permits retry | Retain the UUID and respect its retry delay. |
| Terminal email refusal | Preserve the draft and show a support action. |

An uncertain Redmine request never triggers another creation request or a
second-channel send. An unsuccessful reconciliation remains pending. Earlier
rejected Redmine receipts may have represented redirects after creation; their
migration preserves that uncertainty. Only newly classified definitive
rejections, or the earlier 429 retryable state, permit fallback.

An additional metadata table keeps the original receipt-table shapes intact.
Earlier records default to Redmine, so switching the configured preference cannot reinterpret a prior
receipt as an email acceptance. Changed content under the same report reference
returns an idempotency conflict.

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

A production acceptance record should pair the application's email
`deliveryReference` with the message received at Zach's confirmed inbox.
Availability and health responses establish configuration only. See the
[deployment guide](cloudflare-deployment.md) for release verification.
