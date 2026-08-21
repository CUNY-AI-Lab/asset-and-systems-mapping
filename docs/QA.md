# Systems Mapping — QA and visual-fidelity report

Updated: 2026-08-21

## Candidate status

The current candidate reworks the four analytical levels around one persistent map:

- Micro generates nodes only.
- Meso carries the same Micro node IDs forward and first adds connections.
- Exosphere replaces Macro.
- Macrosphere replaces Integration.
- Exosphere and Macrosphere use filterable concentric ecological regions that contain nodes and connections.

The five workflow stages remain repeatable. The current student interface has no instructor-submission field. Retained instructor review stays advisory, and an outstanding evaluation must not block another stage, level, or cycle. This pass removes only the course-wide active-evaluation ceiling; per-session supersession and retention purges remain unchanged and are deferred from redesign.

Current local automated, PostgreSQL, build, audit, leakage, and rendered-browser checks are recorded below. GitHub publication, Railway deployment/live readback, and a separately authorized live model request remain pending.

## Current candidate receipts

| Current receipt | Result | Boundary |
| --- | --- | --- |
| Ordinary suite | 227 passed; 4 PostgreSQL tests skipped behind their explicit environment guard | Current working tree; guarded tests were run separately below. |
| Fresh native PostgreSQL 17.5 loopback suite | 4/4 `*_test` cases passed, including populated v8→v9 migration | Local disposable database, not hosted Railway readback. |
| Production build | Passed; emitted `index-DKxOo_cS.js`, `TeacherDashboard-CO55RhLk.js`, and `index-CisvqIv_.css` | Local production build, not deployed bundle parity. |
| Dependency and leakage checks | `pnpm audit --prod` reported no known vulnerabilities; gitleaks found no secret in the dirty diff or three intended untracked documentation/concept files; `git diff --check` passed | Does not replace live header, configuration, or log inspection. |
| Annotated rendered package | 40 true PNGs, 4 fabricated memos, and 4 metadata/assertion files; SHA-256 `89f959144d0257a0a21d6440f7be3a37e50925f60adc7dd1687caeb246277c11` | Local disposable runtime; no credentials; not live-provider evidence. |

## Historical evidence only

The following receipts predate the 2026-08-21 reversion and remain useful baselines, not proof of this candidate:

| Historical receipt | Recorded result | Limitation |
| --- | --- | --- |
| Integrated local suite, 2026-08-17 | 171 passed; 3 PostgreSQL integration tests skipped | Covers the preceding Micro/Meso/Macro/Integration tree. |
| Production build and dependency audit, 2026-08-17 | Build passed; no known production vulnerabilities recorded | Must be rerun after the current changes. |
| Fresh PostgreSQL 17 integration | 3/3 passed in an earlier run | Must be rerun against current migrations. |
| PR #5 at `abddbd0a2640aa0e4db0dcf0a1c47d65e9983597` | Merged and synchronized before its release | Predates Exosphere and Macrosphere. |
| Railway deployment `39d38543-20ca-4626-95e6-237ef9213881` | Reached `SUCCESS` for the preceding clean tree | Does not establish current deployment or live behavior. |

Earlier security, persistence, session, and review receipts remain historical regression references. Current local replacements are recorded above; only GitHub, Railway, hosted readback, and any authorized live-provider result remain outside this local receipt.

## Current acceptance matrix

| Area | Required proof | Status |
| --- | --- | --- |
| Micro model contract | Provider and deterministic paths return nodes and exactly zero connections, examples, or connection prompts. | Verified locally |
| Meso carry-forward | Meso receives existing Micro node IDs, returns no new nodes, proposes connections only among those IDs, and does not duplicate carried nodes. | Verified locally |
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
| Delivery | Changed tree is committed, pushed, deployed, and verified through health, auth, database, and rendered UI checks. | Pending |

## Required rendered journey

Use a disposable database and temporary teacher claim values, never the handoff database.

1. Enter class access and create a project with an optional student or group name.
2. Add a Micro memo. Generate guidance and confirm that only nodes appear.
3. Keep several Micro nodes. Confirm that no connection prompt, connection candidate, or relationship line appears.
4. Move to Meso. Confirm that the same nodes and IDs are present, then describe and review proposed connections.
5. Accept, edit, and reject separate connection suggestions. Confirm that only accepted versions enter the map.
6. Move to Exosphere. Place nodes and connections inside indirect institutional or environmental spheres.
7. Move to Macrosphere. Add broader legal, political, cultural, and economic structures around or across existing spheres.
8. Filter to each level and back to all available levels. Confirm that hidden records are unchanged.
9. Open Teacher Console. Confirm that Course settings uses compact Part and Section controls, that one edit is shared across both levels in the Part, and that **Preview level** changes context without changing saved text.
10. Inspect the saved preview response and rendered panel. Confirm that they contain only guidance, course material, Part, section, contextual level, and revision—not the effective prompt, guardrails, internal modules, or fingerprints.
11. Confirm that retained review records and outstanding evaluations do not block navigation, mapping, or another cycle.
12. Capture the successful cycle at desktop, 320, 390, and 430 px. Inspect for clipping, truncation, line/text collisions, icon/text overlap, horizontal overflow, and relevant console errors.

## Screenshot and concept record

These older archives remain historical:

- `/Users/milwright/.codex/visualizations/2026/08/08/019fe2ef-096c-7093-b898-9a6e64ef1b23/systems-mapping-app-all-views-2026-08-11.zip`
- `/Users/milwright/.codex/visualizations/2026/08/11/019ff16f-b119-7963-9090-525be49b8d8a/systems-mapping-course-settings-2026-08-11.zip`
- `/Users/milwright/.codex/visualizations/2026/08/11/019fe2ef-096c-7093-b898-9a6e64ef1b23/systems-mapping-semester-cycle-qa.zip`
- `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ui-qa-2026-08-12.zip`

They do not show the current Exosphere/Macrosphere candidate.

The current concept references are:

- `docs/concepts/ecological-layers-desktop-concept-2026-08-21.png`
- `docs/concepts/ecological-layers-mobile-concept-2026-08-21.png`

They guide implementation but are not rendered application evidence. Current rendered evidence is `/Users/milwright/Projects/dev/systems-mapping/artifacts/systems-mapping-ecological-cycle-qa-2026-08-21/systems-mapping-ecological-cycle-qa-2026-08-21.zip`, SHA-256 `89f959144d0257a0a21d6440f7be3a37e50925f60adc7dd1687caeb246277c11`.

The package contains all 15 states at 1440×1000 and 390×844, plus five map/Teacher states each at 320×812 and 430×932. Its 40 true PNGs are accompanied by 4 fabricated memo files and 4 metadata/assertion files. Strict inspection recorded no truncation, overlap, overflow, or console errors. Graph assertions record Micro at 6 nodes/0 connections, Meso using the exact carried Micro IDs, a cumulative 21-node/19-connection map, and Teacher Console after authentication. No credentials are included.

## Release gate

Local verification is complete for the current working tree. Do not report the candidate as deployed until the remaining external receipts are recorded against the committed tree. The gate is:

- [x] full UI, domain, shared-contract, server, SQLite, and fresh PostgreSQL tests;
- [x] production build, dependency audit, and static leakage scan;
- [x] rendered desktop and phone journeys with inspected screenshots and no relevant console errors;
- GitHub readback showing the changed commit on `main`;
- Railway deployment reaching terminal success;
- live health, class access, Teacher Console authentication, current public configuration, migration, logout, and changed-bundle checks;
- a separate live-provider run only if a rotated provider key is enabled.

The inspected local browser package establishes browser usability for its disposable runtime. It does not prove GitHub publication, Railway deployment, live hosted behavior, or live provider behavior.

## Source authority

The current authority is the Maria and Zach Zoom material supplied on 2026-08-21 and recorded in `docs/MARIA_ZOOM_REVERSIONING_2026-08-21.md`. The fuller Drive specification governs compatible general behavior. An earlier Gmail search did not locate the summary; that is a historical search boundary, not a current absence claim. See `docs/SOURCE_LEDGER.md`.
