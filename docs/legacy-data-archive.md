# Railway archive preparation

`cloudflare/legacy-archive.js` is an offline migration foundation. It is not
imported by the Worker or Node server, and it exposes no HTTP routes. It does
not assign records to CUNY accounts or a course, change active settings, or
authorize access. The existing Railway and Worker databases remain separate.

## Source boundary

The source origin is fixed to `https://web-production-08455.up.railway.app`.
Use the SHA-256 digest of a protected, consistent source backup as `snapshotId`.
Keep the original backup unchanged and private; a projected archive is not a
replacement for a complete database backup or a tested restoration.

Supported projections retain:

- Account IDs, display names, and creation times as source attribution only
- Course profiles, their authorship, and append-only profile events
- Retained submissions and feedback events, without old bearer IDs or sessions
- Saved maps, revision/time/expiry/revocation metadata, without link tokens or sessions
- Code-owned prompt modules and history for private preservation only
- Retention-purge receipts

Password hashes/salts, reset/claim tokens, sessions, temporary evaluations,
Worker account maps, and telemetry are not portable archive tables. Project
evaluation/review capability fields are replaced with explicit redaction
markers. Unknown columns, unredacted structured capabilities, duplicate JSON
keys, and credential-shaped content fail rather than being silently discarded.
The projection preserves graph content without calling semantic migrations or
reclassifying model output.

Accounts are not identity links. A display name, email, anonymous student
session reference, or old project ID cannot establish a verified CUNY account.

## Offline API

```js
import {
  sanitizeLegacySourceRow,
  prepareLegacyArchiveBatch,
  initializeLegacyArchive,
  importLegacyArchiveBatch,
  legacyArchiveSummary,
  sealLegacyArchiveSnapshot,
} from '../cloudflare/legacy-archive.js';

const source = {
  origin: 'https://web-production-08455.up.railway.app',
  snapshotId: backupSha256,
};
const records = restoredRows.map(row => sanitizeLegacySourceRow(table, row));
const batch = prepareLegacyArchiveBatch({ source, batchId, records });

initializeLegacyArchive(disposableSqliteDatabase);
const receipt = await importLegacyArchiveBatch(disposableSqliteDatabase, batch);
const summary = legacyArchiveSummary(disposableSqliteDatabase, source);
await sealLegacyArchiveSnapshot(disposableSqliteDatabase, {
  source,
  expectedCounts: independentlyComputedCounts,
  expectedChecksum: independentlyComputedChecksum,
});
```

Do not open a source database through application startup for inventory or
export. Startup and teacher-queue reads can run retention purges. Export from
a raw read-only connection or an isolated restored backup instead.

Each batch contains at most 50 records and at most 2 MiB of encoded JSON.
Split larger batches before transfer; never omit a row to meet the limit.
Records are addressed by source origin, snapshot digest, table, and a
domain-separated hash of the source key. The exact **projected** payload bytes
and their SHA-256 digests are retained. Source keys are not usable as new link
or review capabilities.

Identical batch replays are no-ops. Identical records in another batch are
deduplicated. Conflicting contents roll back the entire batch without
overwriting previous records or receipts. Different source snapshots preserve
different versions separately. Summary checksums are independent of record
order and batch boundaries. A verified final manifest seals the snapshot;
immutable SQL triggers reject later record changes or additions.

Portable bundles and rehearsal databases contain private memos. Store them in
a restricted location, exclude them from source control and public artifacts,
and report counts/checksums rather than payloads or credential values.

## Future access boundary

Archive snapshots begin `unassigned`. Do not enable a reader or importer until
the target course association is explicit and verified. A future, separate
association must not mutate these immutable source records.

An instructor-only reader can consult the existing private
`AdmissionClassOwner.getClass` receiver with the verified principal and exact
assigned class ID, enforce current course/owner state and dates, and fail
closed. Do not substitute general CAIL administrator status for ownership of
every course. That receiver does not establish exact student enrollment
authority for private map persistence.

Any eligible instructors for the same assigned collection should receive the
same access to source work, regardless of which legacy instructor authored it.
Unrelated instructors and students must remain denied. Code-owned prompt
content is not an instructor-facing reader or editable settings surface.
Existing Worker account projects stay private and are never overwritten.

## Local verification

Run `pnpm exec vitest run cloudflare/legacy-archive.test.js`. Tests cover strict
projections, credentials/capabilities, exact payload storage, replay/conflict
behavior, atomic rollback, independent snapshots, metadata preservation,
unassigned access, existing live-table preservation, input bounds, counts and
checksums, sealing, and SQL immutability. These are local SQLite proofs, not a
production import, actual Durable Objects acceptance, or instructor-access
verification.
