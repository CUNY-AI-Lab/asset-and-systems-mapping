# Student UX implementation ledger

Updated: 2026-08-28

This ledger turns the student-experience review into verifiable implementation work. A row is complete only when the source change, automated coverage, and rendered behavior all agree. The four analytical levels remain Micro-level, Meso-level, Exo-level, and Macro-level. Progress remains non-gating and the graph remains cumulative.

| Requirement | Implementation evidence | Automated evidence | Rendered or runtime evidence | Status |
| --- | --- | --- | --- | --- |
| Establish the focal person or phenomenon, focus question, time period, and map boundary before classification | Intake and persistent project context | Project schema, migration, and intake coverage pass in the 350-test suite | New-project desktop and phone flow | Local source/tests complete; rendered verification pending |
| Classify ecological placement by participation and pathway, not entity type alone | Domain validator, server prompt, review copy | Domain and server contract coverage passes in the 350-test suite | Micro and Exo review using the same institution in different roles | Local source/tests complete; rendered verification pending |
| Keep entity kind separate from ecological placement | Project node schema and editors | Round-trip and migration coverage passes in the 350-test suite | Node inspector and level-move flow | Local source/tests complete; rendered verification pending |
| Preserve model origin until the student explicitly accepts a suggestion | Candidate state and graph commit logic | Candidate provenance coverage passes in the 350-test suite | Review suggestion to map workflow | Local source/tests complete; rendered verification pending |
| Replace Keep language with explicit student actions | Student review copy | Copy and component coverage passes in the 350-test suite | Review screens at desktop and phone widths | Local source/tests complete; rendered verification pending |
| Preserve the graph and history when the memo is revised | Memo revision state transition | Preservation, stale-guidance, and recovery coverage passes in the 350-test suite | Edit a mapped project memo and revisit the map | Local source/tests complete; rendered verification pending |
| Make restart a separate confirmed, recoverable action | Restart control and confirmation | Reset and cancel coverage passes in the 350-test suite | Mapped-project restart flow | Local source/tests complete; rendered verification pending |
| Require informed action before any hosted-model transfer | Review disclosure and Generate action | No-auto-request and manual-route coverage passes in the 350-test suite | Hosted-runtime disclosure flow | Local source/tests complete; rendered verification pending |
| Provide a clearly labeled manual path without model guidance | Review workflow | Manual candidate-path coverage passes in the 350-test suite | Continue-without-guidance flow | Local source/tests complete; rendered verification pending |
| Let students revisit released work levels independently of the visible map filter | Work-level state separate from Show layer | Backward-work and cumulative-state coverage passes in the 350-test suite | Micro to Meso and return-to-Micro flow | Local source/tests complete; rendered verification pending |
| Explain and repair the Micro-setting dependency before Meso | Micro completion summary and level move | Meso eligibility coverage passes in the 350-test suite | Meso with fewer than two settings | Local source/tests complete; rendered verification pending |
| Keep direct interactions at Micro and noun-labeled setting linkages at Meso | Domain and map rendering | Domain, prompt, migration, and graph coverage passes in the 350-test suite | Micro/Meso progression | Local source/tests complete; rendered verification pending |
| Trace outside decisions at Exo-level and broad conditions at Macro-level | Level prompts and validation | Exo/Macro boundary coverage passes in the 350-test suite | East Harlem demonstration project | Local source/tests complete; rendered verification pending |
| Add level-specific revision and final cross-level synthesis | Revision state by level and synthesis fields | Persistence and export coverage passes in the 350-test suite | Complete Micro-to-Macro workflow | Local source/tests complete; rendered verification pending |
| Add process and time without another ring | Context fields and reflection prompts | Schema and export coverage passes in the 350-test suite | Revision and synthesis screens | Local source/tests complete; rendered verification pending |
| Keep map labels readable, fitting reliable, and full screen available | Map layout and responsive styles | Layout contract coverage passes in the 350-test suite | Desktop and 390 px phone map captures | Local source/tests complete; rendered verification pending |
| Provide a synchronized non-spatial list of nodes and connections | Map list view | Keyboard and projection coverage passes in the 350-test suite | Map list interaction at desktop and phone widths | Local source/tests complete; rendered verification pending |
| Never silently filter, delete, or reclassify student work | Move, set-aside, and migration review states | Migration and filter non-mutation coverage passes in the 350-test suite | Level-repair workflow | Local source/tests complete; rendered verification pending |
| Make errors persistent, plain-language, and recoverable | Inline error state and diagnostic details | Failure-path coverage passes in the 350-test suite | Invalid review and sync-conflict flows | Local source/tests complete; rendered verification pending |
| Clarify device-only storage, project links, sync status, and shared-device risk | Projects and project-link UI | Library and link coverage passes in the 350-test suite | Projects screen and conflict flow | Local source/tests complete; rendered verification pending |
| Add optimistic project-link revisions, expiry, and revoke/delete | Client and server link contract | SQLite and fresh PostgreSQL coverage passes in the 350-test suite | Two-session conflict and revoke flow | Local source/tests complete; live conflict/revoke verification pending |
| Keep teacher/model configuration out of the student workflow | Navigation and role boundary | Student-header and Teacher Console coverage passes in the 350-test suite | Student project header | Local source/tests complete; rendered verification pending |
| Reconcile source contract and the full test suite | Requirements, copy, source, and tests | Full Vitest passes: 21 files, 350/350 tests, including fresh PostgreSQL; production build passes; dependency audit reports no known vulnerabilities; scoped static secret scan reports no matches | Production browser smoke test | Local release checks confirmed; deployment and live verification pending |
| Produce only literal production-browser screenshots and a verified archive | Browser capture manifest | File, dimensions, and archive checks | At least twenty workflow captures | Pending — no production capture receipt yet |

## Local verification receipt

- On 2026-08-28, the full local Vitest run passed **21 test files and 350/350 tests**.
- The run included the PostgreSQL integration suite against a freshly created PostgreSQL test database.
- `pnpm run build` completed successfully and emitted `index-BSR_zhd_.js`, `TeacherDashboard-CA6TmLSW.js`, and `index-Dof4gz9i.css`.
- `pnpm audit` reported **No known vulnerabilities found**.
- A scoped scan of the repository, excluding dependencies, build output, and Git metadata, found no common credential or private-key patterns.
- This receipt establishes local acceptance only. It does not establish deployment, live-browser behavior, or screenshot provenance.
- Production deployment, live interaction, and the production-browser screenshot archive remain pending until their separate receipts are recorded.

## Completion gates

- The full automated suite passes, including SQLite and available PostgreSQL integration coverage.
- The production build succeeds without source leakage or dependency regressions.
- A literal browser walkthrough proves the full cumulative progression on desktop and phone.
- Production deployment reaches terminal success, health passes, and the live interface matches the tested source.
- The screenshot manifest records source commit, deployment, URL, viewport, route/state, and capture method for every image.
