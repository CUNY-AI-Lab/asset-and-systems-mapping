# Production source recovery, November 11, 2026

The source tree on `recovery/production-56a87a1` reconstructs the runtime served
with release marker `56a87a1f4f88342ccd872147a7ffdc6a740fb515`. It is a new Git
commit, not the recovered original commit object or proof of who released it.

Recovery starts at `a2a02f9bc53e7b95d355043e6eff17bc8195db94`, applies recorded
November 10 source edits, and restores surviving App, AccountWorkspace and
studentMapLayout files. Historical tests and the student-copy record were also
recovered. Session logs, credentials, private maps and generated bundles are
not included in this branch.

Using that commit's frozen dependency lockfile, the reconstructed build matches
the downloaded production Worker byte for byte (1,333,590 bytes). All 36 public
frontend files also match, including the HTML served at `/`, JavaScript chunks,
CSS, fonts and icons. Individual SHA-256 values are recorded in
`production-56a87a1-recovery.json`. These comparisons establish runtime source
equivalence; they do not establish the original Git metadata or deployment
operator. Live configuration and account data were not changed.

The recovered runtime preserves upload-status spacing, adding left-out names,
the extra Macro pass, restoring supported nodes dropped by correction, refined
left-out reasons and shortened Project/Name labels. It also contains a partial
layout safeguard: Micro drags stop before enclosing an outer card. It does not
repair existing covered pins or consistently handle other expanding regions.

The layout-fix branch integrates this recovery with current main's dependency
updates. Its outward pin adjustment supersedes the partial Micro drag cap,
allowing inner growth while keeping outer cards outside the preceding region.
Fit off continues to preserve manual positions. Recovery evidence alone is
neither a new deployment receipt nor signed-in acceptance of those behaviors.
