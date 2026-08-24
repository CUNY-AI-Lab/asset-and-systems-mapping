# Systems Mapping — QA and visual-fidelity report

Updated: 2026-08-23

## Candidate status

The current local candidate gives each ring its own representational grammar (the 2026-08-23 outer-rings pass, on top of the 2026-08-22 concreteness pass):

- Level assignment is governed by testable delimiters, printed on every Review screen and enforced in the model contract: Micro is what the memo-writer is in the room with; Meso holds only links between mapped settings; an Exosphere item passes the never-in-the-room test and must trace a pathway into a mapped element; a Macrosphere item is a pattern with no door.
- Outer-level verbs come from closed registers (institutional at Exosphere: funds, administers, regulates, employs, sets rules for…; deontic at Macrosphere: mandates, prohibits, defines eligibility for, normalizes, frames…). Off-register verbs coerce to a canonical entry or drop at generation time.
- The Exosphere is produced by elicitation, not extraction: the model walks the carried map by institutional category and may propose institutions the memo never names, marked `basis: "inference"` with verification-oriented evidence; students can also add institutions from a standard category checklist with a typed pathway to a chosen anchor. Every Exosphere connection lands on a carried map element.
- The Macrosphere holds structures, never edges: each structure carries a deontic verb and a student-editable scope of mapped elements (`scopeNodeIds`), rendered on the map as a shaded convex-hull field over its members. Selecting a structure lights exactly its field; the Macrosphere layer view shows fields plus members instead of spokes.

Carried forward from 2026-08-22:

- Node labels are concrete at every level: one named actor, object, institution, policy, or event per node; clause and theme labels are rejected everywhere, and question sentences never mint nodes or relationships.
- Reviews are selective: per-level ceilings (Micro 10 nodes; Meso 8 connections; Exosphere/Macrosphere 8 new nodes and 6 connections) and at most 4 guidance points.
- Exosphere and Macrosphere reviews receive the live map (`carriedNodes` and `carriedConnections`); mapped elements and relationships are never re-proposed, and new connections may tie institutions or structures to existing nodes. A Meso connection can never be re-logged or re-scaled by a later level.
- Completing a level continues directly at Review for the next level; the intake form is never repeated, and each level speaks its own language (nodes / connections / institutions / structures).
- Ring callouts anchor beside their own endpoints with a collision sweep across callouts and cards; map view controls float over the canvas; the map screen fits the desktop viewport; an untouched ecology viewport opens centered.
- Micro generates nodes only.
- Micro revise and export shows no relationships even when the cumulative project contains later-level connections; full export still preserves the entire graph.
- Meso carries the same Micro node IDs forward, places relationship callouts inside the Meso annulus, and points inward to those Micro endpoints.
- Exosphere replaces Macro.
- Macrosphere replaces Integration.
- Exosphere and Macrosphere use filterable concentric ecological regions that contain nodes and connections.
- Completing a level advances Micro to Meso to Exosphere to Macrosphere; completing Macrosphere begins another Macrosphere cycle.
- The larger canvas retains pointer panning, adds focused-canvas arrow-key panning, supports a reversible CSS full-screen view, and zooms out to `0.15`.

The five workflow stages remain repeatable. The current student interface has no instructor-submission field. Retained instructor review stays advisory, and an outstanding evaluation must not block another stage, level, or cycle. Per-session supersession and retention purges remain unchanged and are deferred from redesign.

Current automated, build, and local source-built browser checks are recorded separately from the 2026-08-21 release receipts below. No GitHub publication, Railway deployment, hosted readback, or live-provider claim is made for the 2026-08-22 working tree here.

## Current local candidate receipts

| Current receipt | Result | Boundary |
| --- | --- | --- |
| Ordinary suite | 242 passed; 4 PostgreSQL tests skipped behind their explicit environment guard | Current working tree; guarded tests were not rerun in this frontend pass. |
| Production build | Passed; emitted `index-BJBuN6w3.js`, `TeacherDashboard-DPrpmbM0.js`, and `index-BZOzcHy4.css` | Local production build, not deployed bundle parity. |
| Diff integrity | `git diff --check` passed | Local textual integrity only; not rendered or deployed evidence. |
| Source-built browser run | Real in-app browser against the final local built bundle at 1440×1000 and 390×844: Micro revision had no relationship count and offered **Continue to Meso**; six complete Meso callouts rendered in the Meso annulus with zero pairwise label overlaps; computed callout sizes were `24px` on desktop and `26px` on phone; full-screen filled the viewport without horizontal overflow; zoom reached `0.25`; arrow-key pan changed `panX`; Meso completion selected Exosphere; browser warnings/errors were 0 | Disposable local SQLite only; not generated imagery, GitHub publication, deployment, or live-provider evidence. |
| Micro discrete-label browser run | The clause “Adult Participants face delays when the Accessible Van Program is unavailable” surfaced and committed exactly `Adult Participants` and `Accessible Van Program`; the Micro map contained 2 nodes and 0 relationships; browser warnings/errors were 0 | Disposable local SQLite and deterministic review only; not hosted-provider or deployment evidence. |

## 2026-08-21 release receipts

| Release receipt | Result | Boundary |
| --- | --- | --- |
| Fresh native PostgreSQL 17.5 loopback suite | 4/4 `*_test` cases passed, including populated v8→v9 migration | Previous release candidate; not rerun for the 2026-08-22 frontend-only pass. |
| Dependency and leakage checks | `pnpm audit --prod` reported no known vulnerabilities; gitleaks found no secret in the dirty diff or three intended untracked documentation/concept files | Previous release candidate; not a current-tree receipt. |
| Annotated rendered package | 40 source-built browser PNGs, 4 fabricated memos, and 4 metadata/assertion files; SHA-256 `89f959144d0257a0a21d6440f7be3a37e50925f60adc7dd1687caeb246277c11` | Previous release UI; it does not show the 2026-08-22 map changes. |
| GitHub publication | PR [#9](https://github.com/CUNY-AI-Lab/systems-mapping/pull/9) merged feature commit `e17142b7c4974a8db4fe02bcded47f0ce5ecf497` into `main` at `7f6444147d34a4c62203eb1a3943fcfd6c3f4491` | Last published ecological release, not the current working tree. |
| Railway deployment | `51a03b7e-6752-4681-8714-5bbf6106d843` reached terminal `SUCCESS` from the clean merge | Last deployed ecological release, not the current working tree. |
| Hosted readback | Root/health/security headers, public-demo access, session/configuration/logout, student-to-teacher denial, Teacher Console route, exact asset hashes, and zero HTTP 5xx passed | Previous release; no teacher passphrase was used or exposed. |
| Live provider | `ollama-cloud` / `deepseek-v4-flash:0731` returned valid Micro 7/0, Meso 0/6 exact-ID, Exosphere 11/5, Macrosphere 8/1 reviews; connection suggestions returned six exact-ID relationships | Previous release with fabricated East Harlem memos; key value and rotation history were not inspected. |

## Historical evidence only

The following receipts predate the 2026-08-21 reversion and remain useful baselines, not proof of this candidate:

| Historical receipt | Recorded result | Limitation |
| --- | --- | --- |
| Integrated local suite, 2026-08-17 | 171 passed; 3 PostgreSQL integration tests skipped | Covers the preceding Micro/Meso/Macro/Integration tree. |
| Production build and dependency audit, 2026-08-17 | Build passed; no known production vulnerabilities recorded | Must be rerun after the current changes. |
| Fresh PostgreSQL 17 integration | 3/3 passed in an earlier run | Must be rerun against current migrations. |
| PR #5 at `abddbd0a2640aa0e4db0dcf0a1c47d65e9983597` | Merged and synchronized before its release | Predates Exosphere and Macrosphere. |
| Railway deployment `39d38543-20ca-4626-95e6-237ef9213881` | Reached `SUCCESS` for the preceding clean tree | Does not establish current deployment or live behavior. |

Earlier security, persistence, session, and review receipts remain historical regression references. The current local checks and previous hosted release are recorded separately above. An authenticated production Teacher Console mutation and credential-owner confirmation of provider-key rotation remain separate operator checks.

## Current acceptance matrix

| Area | Required proof | Status |
| --- | --- | --- |
| Micro model contract | Provider and deterministic paths return one discrete actor/object noun phrase per node and exactly zero connections, examples, or connection prompts; whole clauses are rejected before review or commit. | Verified locally for the current tree; the earlier live receipt predates the discrete-label change |
| Micro revision projection | Revise and export shows Micro nodes and zero relationships while full export retains the cumulative graph. | Projection verified by automation and browser; cumulative export verified by automation |
| Meso carry-forward | Meso receives existing Micro node IDs, returns no new nodes, proposes connections only among those IDs, and does not duplicate carried nodes. | Verified locally and live |
| Meso map placement | Relationship callouts sit in the Meso annulus and point inward to carried Micro endpoints. | Verified locally by automation and browser |
| Ordered progression | Completion advances Micro to Meso to Exosphere to Macrosphere; Macrosphere starts another Macrosphere cycle. | Full sequence verified by automation; Micro to Meso and Meso to Exosphere verified in browser |
| Map viewport | The larger canvas supports reversible CSS full-screen, persistent pointer panning, arrow-key panning, and zoom down to `0.15`. | Verified locally by automation; the historical browser baseline verified full-screen, keyboard pan, and `0.25` zoom |
| Level migration | `macro` becomes `exosphere`; `integration` becomes `macrosphere` across nodes, relationships, current/completed levels, course settings, and exports without data loss. | Verified locally, including populated PostgreSQL v8→v9 migration |
| Ecological map | Exosphere and Macrosphere render distinct concentric regions that contain nodes and connections. | Verified in inspected captures |
| Filters | Showing all available levels or one level never deletes, rewrites, or repositions hidden graph records. | Verified locally |
| Labels | Node and connection text stays complete, readable, above lines, and clear of icons at desktop and 320, 390, and 430 px. | Verified in inspected captures |
| Optional name | A student or group name can be added to a project link and left blank without blocking progress. | Verified locally |
| Teacher Console settings | Compact controls show one Part and one section. Settings are shared by both levels in the Part. **Preview level** changes context only, not the saved configuration. | Verified locally and in post-authentication captures |
| Safe settings preview | Preview returns and renders only saved instructor guidance and course material plus Part, section, contextual level, and revision; no effective prompt, guardrails, internal modules, or fingerprints appear. | Verified locally |
| Evaluation capacity | Many outstanding evaluations in one course do not trigger a course-wide active-evaluation maximum. | Verified locally |
| Unchanged behavior | Per-session supersession and retention-purge tests continue to pass without redesign. | Verified locally |
| Persistence | SQLite and PostgreSQL preserve stable IDs, sphere membership, annotations, positions, and viewport. | Verified locally |
| Delivery | Changed tree is committed, pushed, deployed, and verified through migration, health, public access/authz, configuration, logout, headers, assets, logs, and live-provider checks. | Not established for the 2026-08-22 local candidate; last established for the 2026-08-21 release |

## Required rendered journey

Use a disposable database and temporary teacher claim values, never the handoff database.

1. Enter class access and create a project with an optional student or group name.
2. Add a Micro memo containing an actor, an object, and a proposition joining them. Generate guidance and confirm that only the discrete actor/object noun phrases appear as nodes; the whole clause must not appear.
3. Keep several Micro nodes. Confirm that no connection prompt, connection candidate, or relationship line appears. At revise and export, confirm that the current-level summary still contains zero relationships while full export retains the cumulative graph.
4. Complete Micro and confirm automatic advancement to Meso. Confirm that the same node IDs are present, then describe and review proposed connections.
5. Accept, edit, and reject separate connection suggestions. Confirm that only accepted versions enter the map, each relationship callout sits inside the Meso annulus, and its lines point inward to the carried Micro endpoints.
6. Toggle full-screen on and off. Pan by pointer, focus the canvas and pan with the arrow keys, and zoom out to `0.15`; confirm that opening or closing a detail panel does not disable panning.
7. Complete Meso and confirm automatic advancement to Exosphere. Place nodes and connections inside indirect institutional or environmental spheres.
8. Complete Exosphere and confirm automatic advancement to Macrosphere. Add broader legal, political, cultural, and economic structures around or across existing spheres. Complete Macrosphere and confirm that another Macrosphere cycle begins.
9. Filter to each level and back to all available levels. Confirm that hidden records are unchanged and that records appear in their assigned spheres.
10. Open Teacher Console. Confirm that Course settings uses compact Part and Section controls, that one edit is shared across both levels in the Part, and that **Preview level** changes context without changing saved text.
11. Inspect the saved preview response and rendered panel. Confirm that they contain only guidance, course material, Part, section, contextual level, and revision—not the effective prompt, guardrails, internal modules, or fingerprints.
12. Confirm that retained review records and outstanding evaluations do not block navigation, mapping, or another cycle.
13. Capture the successful cycle from the built application at desktop, 320, 390, and 430 px. Inspect for clipping, truncation, line/text collisions, icon/text overlap, horizontal overflow, and relevant console errors. Generated or composited visuals do not satisfy this gate.

## Rendered screenshot record

These older archives remain historical:

- `/Users/milwright/.codex/visualizations/2026/08/08/019fe2ef-096c-7093-b898-9a6e64ef1b23/systems-mapping-app-all-views-2026-08-11.zip`
- `/Users/milwright/.codex/visualizations/2026/08/11/019ff16f-b119-7963-9090-525be49b8d8a/systems-mapping-course-settings-2026-08-11.zip`
- `/Users/milwright/.codex/visualizations/2026/08/11/019fe2ef-096c-7093-b898-9a6e64ef1b23/systems-mapping-semester-cycle-qa.zip`
- `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ui-qa-2026-08-12.zip`

They do not show the 2026-08-21 ecological release or the 2026-08-22 map-interaction changes.

The last packaged rendered evidence is `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ecological-cycle-qa-2026-08-21/systems-mapping-ecological-cycle-qa-2026-08-21.zip`, SHA-256 `89f959144d0257a0a21d6440f7be3a37e50925f60adc7dd1687caeb246277c11`; it predates the 2026-08-22 map changes.

The package contains all 15 states at 1440×1000 and 390×844, plus five map/Teacher states each at 320×812 and 430×932. Its 40 true PNGs are accompanied by 4 fabricated memo files and 4 metadata/assertion files. Strict inspection recorded no truncation, overlap, overflow, or console errors. Graph assertions record Micro at 6 nodes/0 connections, Meso using the exact carried Micro IDs, a cumulative 21-node/19-connection map, and Teacher Console after authentication. No credentials are included.

## Release boundary

The 2026-08-22 map-interaction candidate is locally tested, built, and checked in a real in-app browser against the final built bundle, but has no GitHub, Railway, hosted, or live-provider receipt. The completed delivery gate below belongs to the 2026-08-21 ecological release:

- [x] full UI, domain, shared-contract, server, SQLite, and fresh PostgreSQL tests;
- [x] production build, dependency audit, and static leakage scan;
- [x] rendered desktop and phone journeys with inspected screenshots and no relevant console errors;
- [x] GitHub readback showing the changed commit on `main`;
- [x] Railway deployment reaching terminal success;
- [x] live health, class access, Teacher Console route and authorization boundary, current public configuration, migration, logout, and changed-bundle checks;
- [x] live-provider runs using fabricated memos for all four levels and connection refinement.

The inspected local browser package establishes responsive browser usability only for the 2026-08-21 release. Its GitHub, Railway, hosted readback, and provider receipts do not establish delivery or live behavior for the 2026-08-22 working tree. No authenticated production Teacher Console mutation was performed.

## Source authority

The current authority is the Maria and Zach Zoom material supplied on 2026-08-21 and recorded in `docs/MARIA_ZOOM_REVERSIONING_2026-08-21.md`. The fuller Drive specification governs compatible general behavior. An earlier Gmail search did not locate the summary; that is a historical search boundary, not a current absence claim. See `docs/SOURCE_LEDGER.md`.
