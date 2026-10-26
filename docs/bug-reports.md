# Report a problem

## Current production flow

Production selects `BUG_REPORT_MODE=redmine` in [wrangler.jsonc](../wrangler.jsonc).
The footer opens a report form for either CUNY Login or a guest's first name,
last name and .edu email address. Guest details are self-reported contact
information, not verified identity or proof of enrollment. A signed-in reporter's
preferred name comes from the verified application identity.

[Worker routing](../cloudflare/worker.ts) exposes
`GET /api/bug-reports/availability`. Redmine mode returns `mode: "contact"` and
`delivery: "redmine"`; `enabled` reflects whether `REDMINE_API_KEY` is configured.
Explicit Redmine mode with a missing key disables reporting and returns 503 for
report requests. It does not fall back to email. The presence of that key also
selects Redmine when the mode variable is absent. This describes existing
configuration; changing credentials is a separate authorized operation.

The [contact form](../src/support/contact-form.js) uses these routes:

- `GET /api/bug-reports/session` checks the signed-in account and returns
  `expectedActor` and `preferredName`. It is active in Redmine mode.
- `POST /api/bug-reports` accepts exactly
  `{reportId, expectedActor, description, path}`. The server verifies the account
  and rejects a changed actor; the browser does not supply the preferred name.
- `POST /api/bug-reports/guest` accepts exactly
  `{reportId, firstName, lastName, email, description, path}` without CUNY Login.
  [Shared validation](../src/support/contact.js) checks the names and .edu email
  syntax on both client and server. It does not verify mailbox ownership.

Context uses fixed page categories (`/`, `/teacher.html`, `/account.html`, or
`/p/:shared-map`), not project IDs or capability URLs. The form does not
attach map or memo contents automatically. Reporters can still put personal or
sensitive information in their description; this is not an anonymous channel.

## Storage, limits and delivery

[RedmineReports](../cloudflare/redmine-reports.ts) creates private issues in
CAIL Ticketing project 15, Bug tracker 2. The issue includes the description,
page category, release, report reference and time. Signed-in issues include an
account reference and the verified preferred name when available. Guest issues
include the self-reported name and email, explicitly labeled unverified. Private
issue visibility remains subject to Redmine's permissions.

The Durable Object stores receipt rows containing an owner reference, report
UUID, content fingerprint, creation time, state and issue ID. Guest receipts
also retain a network rate reference. Guest owner references are derived from
normalized email; network references are derived from the connecting IP and
server secret. These are pseudonymous references, not a claim of anonymity.
The receipt tables do not store the description or contact text; that text is
sent to Redmine. Browser drafts remain in tab memory, with an unload warning
while a draft is pending. Closing the pop-up preserves the draft; reloading or
leaving the page can discard it. No broader provider retention or logging claim
is established by these application tables.

The server bounds the JSON body to 32,768 bytes and five seconds of reading,
validates a UUIDv4 report ID and closed payload fields, and limits descriptions
to 4,000 UTF-16 code units before normalization. After normalizing line endings
and tabs and trimming outer whitespace, it requires at least 10 code units and
rejects disallowed control characters. Each owner may create 10 receipts in a rolling 24 hours; guest network
references may create 20. Existing report IDs are checked before these creation
limits. Worker ingress limits also apply. Redmine responses are bounded to
2 MiB and the delivery/reconciliation operation to 18 seconds; redirects are
not followed with the API key.

## Receipts and retries

`{ok:true,status:"saved",reportId,createdAt}` means the application recorded a
Redmine issue ID from a successful creation response or reconciliation lookup.
It does not mean an email was sent or that an instructor read the report.

A receipt is claimed before sending. Repeating a saved report returns its
receipt without another issue creation; changing the payload under the same
owner/report ID returns `idempotency_conflict`. Concurrent requests for an
active report return `pending`.

If acknowledgement is lost, the receipt stays pending. A retry searches Redmine
for its report marker and records the issue ID if found; it does not issue a
second creation request. An empty, failed or incomplete lookup remains
unconfirmed, so a report may remain pending even if delivery never occurred.
The lookup is bounded to 1,000 results. An explicit Redmine 429 marks the receipt
retryable and allows a later creation attempt; selected definitive rejections
mark it rejected. Other uncertain responses remain pending.

The browser locks an uncertain payload, displays its reference and offers
**Check status**, retaining the same UUID. Rate limits display a wait before
retry. Authentication changes require the original signed-in account for its
draft; definitive failures remain visible. Closing a form or losing the browser
connection does not prove that server-side delivery stopped. These controls
reduce duplicate creation; they do not constitute a general exactly-once
provider guarantee.

## Legacy email flow

The retained [email handler](../cloudflare/bug-reports.ts) and
[email form](../src/support/form.js) support the older `BUG_REPORTS` service
binding. They apply when Redmine is not explicitly selected and no Redmine key
is present. In that mode, the report session endpoint returns 404 and anonymous
`POST /api/bug-reports` accepts `{reportId, description, path}` through
`AdmissionBugReports.submitPublic`. Its `accepted` receipt concerns email
provider acceptance, not mailbox arrival. Its payload, budgets and receipts
must not be used to describe current Redmine production behavior. Retaining the
binding in configuration does not make it an automatic Redmine fallback.

## Verification boundaries

Synthetic coverage lives in [Redmine receipt tests](../cloudflare/redmine-reports.test.ts),
[contact form tests](../src/support/contact-form.test.js) and
[Worker reporting tests](../cloudflare/bug-report-runtime.test.js). Read-only
availability, health and asset checks confirm configuration and deployed bytes,
not report delivery. A prior guest issue receipt establishes only that specific
guest transaction. Signed-in reporting, account-change behavior and issue
readback require separately authorized acceptance; do not submit another live
report merely to check deployment freshness. Follow the
[deployment guide](cloudflare-deployment.md) for release verification.
