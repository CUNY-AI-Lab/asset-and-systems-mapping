# Systems Mapping — QA and visual-fidelity report

Updated: 2026-08-24

## Candidate status

The direct decision recorded on 2026-08-24 corrects the Micro/Meso contract:

- Micro contains discrete people, groups, objects, resources, and immediate settings, together with their direct relationships. The relationship verbs remain Micro records.
- A whole clause or proposition cannot become a Micro node. The model must identify the relevant actor, object, or setting and represent any supported proposition as a direct Micro relationship.
- Meso contains noun-labeled linkages among at least two carried Micro settings. It contains no generic relationship edges or verbs.
- A Meso linkage renders in the Meso region and references its included Micro settings. Any connector line shows membership in the linkage, not a new proposition.

Still required from the earlier map work:

- Except for the specialized `mesosystem` record, each node names one concrete actor, object, setting, institution, policy, law, condition, or structure. A Meso label names the interrelation among its included settings. Clause labels and question sentences never mint nodes or relationships.
- Reviews remain selective and bounded.
- Exosphere and Macrosphere reviews receive the live map (`carriedNodes` and `carriedConnections`); mapped elements and relationships are not re-proposed.
- Completing a level continues directly at Review for the next level; the intake form is not repeated, and each level uses its own direct terminology.
- Map labels stay complete and clear of node cards and controls; map view controls remain available over the canvas; the map screen fits the desktop viewport; an untouched ecology viewport opens centered.
- Micro revise and export shows its Micro nodes and relationships while excluding records assigned to later levels; full export preserves the cumulative graph.
- Meso carries eligible Micro setting IDs forward and stores each linkage as a `mesosystem` node with at least two valid setting IDs in `scopeNodeIds`.
- Exosphere replaces Macro.
- Macrosphere replaces Integration.
- Exosphere and Macrosphere use filterable concentric ecological regions. Exosphere may contain supported institutional connections; Macrosphere uses scoped structure nodes and no graph edges.
- Completing a level advances Micro to Meso to Exosphere to Macrosphere; completing Macrosphere begins another Macrosphere cycle.
- The larger canvas retains pointer panning, adds focused-canvas arrow-key panning, supports a reversible CSS full-screen view, and zooms out to `0.15`.

The five workflow stages remain repeatable. The current student interface has no instructor-submission field. Retained instructor review stays advisory, and an outstanding evaluation must not block another stage, level, or cycle. Per-session supersession and retention purges remain unchanged and are deferred from redesign.

The 2026-08-21 and 2026-08-22 receipts below verify earlier builds. They do not verify this corrected Micro/Meso contract. Current automated, source-built browser, GitHub, Railway, and live-provider evidence must be recorded after the correction is complete.

## Historical local candidate receipts — superseded Micro/Meso contract

| Historical receipt | Result | Boundary |
| --- | --- | --- |
| Ordinary suite | 242 passed; 4 PostgreSQL tests skipped behind their explicit environment guard | 2026-08-22 working tree; does not test the corrected contract. |
| Production build | Passed; emitted `index-BJBuN6w3.js`, `TeacherDashboard-DPrpmbM0.js`, and `index-BZOzcHy4.css` | Earlier local production build; not current or deployed bundle parity. |
| Diff integrity | `git diff --check` passed | Earlier local textual integrity only; not current, rendered, or deployed evidence. |
| Source-built browser run | The browser showed node-only Micro and generic relationship callouts in Meso, along with working full-screen, zoom, and keyboard pan. | The viewport evidence remains useful, but the Micro/Meso content model is superseded. |
| Micro discrete-label browser run | The clause “Adult Participants face delays when the Accessible Van Program is unavailable” surfaced `Adult Participants` and `Accessible Van Program` as discrete nodes. | The clause-rejection evidence remains useful; its zero-relationship result is superseded. |

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
| Micro model contract | Provider and deterministic paths return one discrete noun phrase per node and may return direct relationships with clear verbs and valid Micro endpoints; whole clauses are rejected as nodes. | Current correction requires new automated and live-provider proof. |
| Micro revision projection | Revise and export shows Micro nodes and direct relationships while excluding later-level records; full export retains the cumulative graph. | Current correction requires new automation and browser proof. |
| Meso carry-forward | Meso receives eligible Micro setting IDs and returns noun-labeled `mesosystem` linkage candidates scoped to at least two of those settings, with zero relationship edges. | Current correction requires new automated and live-provider proof. |
| Meso map placement | Each Meso linkage sits in the Meso region; any lines to included Micro settings indicate scope and carry no relationship verb or proposition label. | Current correction requires new automation and browser proof. |
| Ordered progression | Completion advances Micro to Meso to Exosphere to Macrosphere; Macrosphere starts another Macrosphere cycle. | Full sequence verified by automation; Micro to Meso and Meso to Exosphere verified in browser |
| Map viewport | The larger canvas supports reversible CSS full-screen, persistent pointer panning, arrow-key panning, and zoom down to `0.15`. | Verified locally by automation; the historical browser baseline verified full-screen, keyboard pan, and `0.25` zoom |
| Level migration | `macro` becomes `exosphere`; `integration` becomes `macrosphere` across nodes, relationships, current/completed levels, course settings, and exports without data loss. | Verified locally, including populated PostgreSQL v8→v9 migration |
| Ecological map | Exosphere and Macrosphere render distinct concentric regions. Exosphere may show supported institutional connections; Macrosphere shows scoped structure nodes without graph edges. | Verified in inspected captures |
| Filters | Showing all available levels or one level never deletes, rewrites, or repositions hidden graph records. | Verified locally |
| Labels | Node and connection text stays complete, readable, above lines, and clear of icons at desktop and 320, 390, and 430 px. | Verified in inspected captures |
| Optional name | A student or group name can be added to a project link and left blank without blocking progress. | Verified locally |
| Teacher Console settings | Compact controls show one Part and one section. Settings are shared by both levels in the Part. **Preview level** changes context only, not the saved configuration. | Verified locally and in post-authentication captures |
| Safe settings preview | Preview returns and renders only saved instructor guidance and course material plus Part, section, contextual level, and revision; no effective prompt, guardrails, internal modules, or fingerprints appear. | Verified locally |
| Evaluation capacity | Many outstanding evaluations in one course do not trigger a course-wide active-evaluation maximum. | Verified locally |
| Unchanged behavior | Per-session supersession and retention-purge tests continue to pass without redesign. | Verified locally |
| Persistence | SQLite and PostgreSQL preserve stable IDs, sphere membership, annotations, positions, and viewport. | Verified locally |
| Delivery | Changed tree is committed, pushed, deployed, and verified through migration, health, public access/authz, configuration, logout, headers, assets, logs, and live-provider checks. | Not established for the 2026-08-24 correction; last established for the superseded 2026-08-21 release. |

## Required rendered journey

Use a disposable database and temporary teacher claim values, never the handoff database.

1. Enter class access and create a project with an optional student or group name.
2. Add a Micro memo containing an actor, an object or setting, and a proposition joining them. Generate guidance and confirm that the relevant noun phrases appear as separate nodes, the whole clause does not become a node, and the supported proposition appears as a Micro relationship with a clear verb.
3. Keep, edit, and remove separate Micro node and relationship suggestions. Confirm that accepted relationships enter the Micro map, their verbs remain visible when Micro is filtered, and revise and export includes the current Micro relationships while excluding later-level records.
4. Complete Micro and confirm automatic advancement to Meso. Confirm that eligible Micro setting IDs carry forward, then review noun-labeled linkage suggestions scoped to at least two settings.
5. Keep, rename, rescope, and remove separate Meso linkages. Confirm that only accepted linkages enter the Meso region, every linkage retains at least two valid Micro setting IDs, and no Meso relationship candidate, verb callout, or proposition label appears.
6. Toggle full-screen on and off. Pan by pointer, focus the canvas and pan with the arrow keys, and zoom out to `0.15`; confirm that opening or closing a detail panel does not disable panning.
7. Complete Meso and confirm automatic advancement to Exosphere. Place nodes and connections inside indirect institutional or environmental spheres.
8. Complete Exosphere and confirm automatic advancement to Macrosphere. Add broader legal, political, cultural, and economic structures around or across existing spheres. Complete Macrosphere and confirm that another Macrosphere cycle begins.
9. Filter to each level and back to all available levels. Confirm that hidden records are unchanged and that records appear in their assigned spheres.
10. Open Instructor Console. Confirm that Course settings uses compact Part and Section controls, that one edit is shared across both levels in the Part, and that **Preview level** changes context without changing saved text.
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

The 2026-08-24 Micro/Meso correction has no completed automated, browser, GitHub, Railway, hosted, or live-provider receipt in this document yet. The completed delivery gate below belongs to the superseded 2026-08-21 ecological release:

- [x] full UI, domain, shared-contract, server, SQLite, and fresh PostgreSQL tests;
- [x] production build, dependency audit, and static leakage scan;
- [x] rendered desktop and phone journeys with inspected screenshots and no relevant console errors;
- [x] GitHub readback showing the changed commit on `main`;
- [x] Railway deployment reaching terminal success;
- [x] live health, class access, Teacher Console route and authorization boundary, current public configuration, migration, logout, and changed-bundle checks;
- [x] live-provider runs using fabricated memos for all four levels and connection refinement.

The inspected local browser package establishes responsive browser usability only for the 2026-08-21 release. Its GitHub, Railway, hosted readback, and provider receipts do not establish delivery or live behavior for the 2026-08-24 correction. No authenticated production Teacher Console mutation was performed.

## Source authority

The direct correction supplied on 2026-08-24 and recorded in `docs/MICRO_MESO_CORRECTION_2026-08-24.md` governs the Micro/Meso boundary. The Maria and Zach Zoom material supplied on 2026-08-21 continues to govern compatible level names, order, and ecological-layer behavior; its node-only Micro/generic-edge Meso interpretation is historical. The fuller Drive specification governs compatible general behavior. See `docs/SOURCE_LEDGER.md`.
