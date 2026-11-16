# Browser copies across the two Systems addresses

This is a bounded, user-initiated recovery flow, not background synchronization.
Saved account maps already use the same Worker storage at the original production
address and the Tools mount. From Projects, **Recover browser copies from the
other address** opens a separate recovery page. The original editor stays open.
The recovery page opens a new top-level source popup, where the user separately
chooses **Read browser copies**. It never mounts the editor or writes source
browser storage, including on errors.

The existing root page accepts `browserRecovery=source` or `destination`, together
with the normal validated course selection. No identity, nonce, proof, map,
draft or sharing token appears in the URL. No new public Doorway exception is
needed: the root page remains public, and every recovery API uses the existing
protected API route. Both releases must include the recovery interface and
receiver. Only the exact production Worker and Tools pair is supported. Dev has
separate Durable Objects: its account response advertises no recovery peer, its
Projects page hides the recovery link, direct recovery pages explain that it is
unavailable, and proof operations return 404. No Dev-to-production transfer is
attempted. Local fixtures are not evidence of live CUNY acceptance.

## Authentication and transport

Fresh `/api/cloud/account` responses select the exact account/course cache
namespace and return the fixed peer origin/path. Three same-origin JSON POSTs
implement `/api/cloud/browser-recovery/issue`, `/verify` and `/consume`:

- Issue takes only a cryptographic nonce and returns an opaque, two-minute
  token. Verify takes that token, nonce and snapshot SHA-256 fingerprint at the
  opposite entrypoint, then replaces it with an opaque receipt. Consume takes
  that receipt, nonce and fingerprint at the original destination.
- Both stages require the same freshly verified canonical account and course,
  current Admission and expected account cache identifier. Cache identifiers
  and window-claimed identities are not credentials. Tools still requires both
  signed identity legs; the original Worker still uses its own session cookie.
- The per-course Durable Object stores only hashed tokens, hashed ownership,
  purpose/origin binding, nonce, fingerprint, phase and expiry. Atomic SQL
  consumption prevents replay. Each account has at most one flow per direction;
  replacement flows invalidate earlier ones. Bodies are capped at 1 KiB.
  No browser payload reaches the proof service or logs.
- The popup handshake requires the exact expected origin and window, a
  cryptographic nonce and one transferred MessagePort. Proofs and payloads use
  that port, not later WindowProxy messages. Navigation cannot redirect an
  already transferred port into another document. A two-minute timer closes
  abandoned flows. Account requests have ten-second client deadlines.
- Sessions are rechecked before source export, destination staging, private
  downloads and each restoration. Focus, pageshow and visibility revalidation clear private
  review content after access changes. Captured storage adapters and checks
  before writes prevent a delayed action from entering another account.

## Preserved state and deliberate restoration

The allowlist covers account-scoped active/legacy projects, project bodies and
library, memo journals, relationship journals, cloud revision baselines, pending
guidance, guidance caches, stored sharing links, deleted/invalid project recovery,
account navigation and theme. Only theme and the two existing width preferences
are read outside the account namespace. Other accounts, apps, unscoped legacy
maps and nested recovery archives are excluded. There is no application
sessionStorage or IndexedDB migration. Imported project IDs follow the domain's
nonblank, 200 UTF-16-unit bound, using each existing writer's exact raw or
canonical URI-encoded suffix. A stable snapshot is limited to 1,000 entries,
2,097,152 UTF-16 units per value and 8 MiB total; oversize/changing sources fail
intact.

Incoming bytes and conflicting destination bytes are saved in a separate,
immutable, account-scoped recovery journal. Its identity includes both sides,
so importing the same source after a destination edit preserves that new conflict.
An existing recovery record must contain the exact incoming bytes and conflicts
before it counts as safely staged. A damaged record stays untouched and disables
restoration; the verified in-memory copy remains available for private download.
No active map, library, sync baseline, pending request or sharing permission is
installed by staging. Quota failure retains the in-memory snapshot for an
explicit private download and leaves active work unchanged.

Projects pass the existing parser; memo journals use existing project/source
identity and base-fingerprint checks. Divergent versions remain separate. The
user can compare against a fresh server map using the existing reconciliation
rules, download a private map, or explicitly save a new private account map with
a new identity and revision zero. This never replaces an existing account map.
After that explicit save, a second action can restore bounded relationship
journals to the new map only: original creation identity, live endpoints, current
graph and journal schema must match. Newer destination drafts are not overwritten.
Preferences require a separate click and an unchanged destination value.

Pending paid requests, guidance caches, invalid/unmatched journals and bearer
sharing links remain archival. Recovery does not submit a memo, resume a job,
restore sharing authority or call a provider. Invalid bytes remain available
in the private backup. Private downloads can contain memo text and sharing
capabilities and are labeled accordingly.

## Limits and acceptance

All Tools apps share one browser origin. Exact namespace and account checks do
not isolate this application's storage or APIs from other scripts on that
origin. Strong sibling-app isolation requires separate origins.

A new popup cannot read an older tab's JavaScript memory or sessionStorage.
In particular, an unfinished new-node form in the existing production tab is
not durable browser storage. That original tab must remain open; its text needs
an explicit save/copy in that tab when the user is ready. This feature does not
claim to recover that memory or a lost/cleared browser profile. Source-only
changes made after the snapshot require another deliberate recovery.

Local tests cover proof expiry, replay/races, account/course mismatch, revocation,
partial identity, origin rejection, parser/draft fingerprints, conflicts, quota,
preference checks, relationship restoration and account-change isolation. A real
headless-browser fixture exercises both origins, popup/port transfer, reload,
explicit new-map save and an unchanged original-tab form/cache. All requests in
that fixture stay in local Workers; it does not use production sessions, browser
profiles, provider calls or the user's unsaved draft. Deployment and ordinary
signed-in acceptance remain separate gates.
