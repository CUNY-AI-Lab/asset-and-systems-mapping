# Account workflow revision, November 4

This records the user's later corrections to the two-memo design. See the [Memo workspace wireframe and behavior](MEMO_WORKSPACE_2026-11-04.md) for the current interface contract; implementation, Dev verification and production release are separate evidence. These rules
supersede the earlier two-sphere interface and five-stage student review queue
for the Cloudflare account application. The Node/Railway entrypoint remains a
separate application; its stored data and review flow are not migrated here.

1. **Micro:** upload and submit the first memo. Add the small supported starting
   set of local nodes immediately; students can rename, add or remove them.
2. **Meso:** students draw relationships between those local nodes. The model
   neither suggests nor creates relationships.
3. **Exo:** upload a distinct second memo into an empty, independent field. Use
   the existing graph as context, without copying or submitting the first memo
   as second-memo content. Classify outside decision settings at Exo and broader
   cultural beliefs, historical patterns and economic structures at Macro. Students connect Exo
   settings to selected local relationships.
4. **Macro:** students decide how broader conditions connect to mapped settings
   and relationships. Named institutions remain at Exo or Micro, according to
   the focal participants' involvement. All connections are student-created.

The map has three nested, content-sized spheres: Micro inside Exo inside Macro.
Connections use lighter lines and distinct dash patterns; the key explains
color and pattern together. Wording remains attached to its own line. Auto-fit
routes around cards and labels, separates shared paths, and gives crossings a
visible gap when they cannot be eliminated. Manual node positions persist.

The Notebook has four direct steps, persistent Back/Continue controls above the scrolling content and optional
field notes. Continue requires only a successful memo submission for the current part, including a valid empty result. There is no suggestion carousel, Set aside action, note requirement or relationship requirement. Memo, Notebook and Tools share the resizable sidebar. Hide closes it while keeping all three controls available. The active view uses an underline.

Projects begins with a two-field creation form: **Project title** and **Creator name**. The creator can be a person or group and may be prefilled from the account profile; it never replaces the project title. A blank title becomes **Untitled systems map**. Saved rows show the existing title and creator, and search matches either. Opening a saved project preserves both. **Project → Project details** edits those same two fields for an existing map.

Every project opens onto the canvas; uploading never requires replacing the canvas with intake. The obsolete Map button and generic private-information checkbox are removed. Stored privacy declarations and permission controls for existing sensitive memos without consent remain intact. Edited sources show “Memo changed | click Update map to submit”.
Evidence excerpts identify their source; node interpretation asks “Where does
this connect? What is still uncertain?” Buttons and disclosures have consistent
boundaries and states. Each node shows only Add to map or Remove according to its saved state, at the top of its editor. Removed nodes remain removed after resubmission. The report form has space around its delivery note and accepts bugs or feature requests. Dev and production configuration select direct private Redmine delivery without an email fallback for new reports; live acceptance is verified separately.

Both source documents, graph identities, student relationships, notes and
placement remain saved independently. Reading an older project must not retire
an Exo node for lacking a proper name or a Macro condition for lacking a scope.
Existing relationships are preserved; this change prevents new model-created
relationships rather than deleting students' saved work.

The shared `student-nodes-v1` contract bounds output to six nodes (any mix of Exo
and Macro nodes from the second memo), requires narrative evidence,
and rejects guidance, relationships and scopes. Server, Gateway and client use
that contract. Account-interface components are isolated from legacy review
components; storage and draft journals remain shared.

Each newly generated node names one supported subject. A parenthetical list of
distinct named providers or a slash-separated bundle of distinct professional
roles is rejected for a bounded model correction, never silently split or
renamed by the app. The replacement may choose one evidenced subject or return
separate nodes within the same six-node limit. A single official name, acronym,
locality qualifier or demographic/caregiving population remains eligible. This
narrow guard applies only to new submissions: stored reviews and exact
`existingId` echoes of student-edited labels remain readable and unchanged.
Fresh subject bundles are checked across the response before evidence repairs,
so an early bad quote cannot conceal a later combined role until the final
attempt. Table evidence must copy actual source passages or cells, never
reconstruct quotations by joining columns. Quote validation remains strict.
Typography-only quotation differences are normalized against the literal saved
text before structural table separators are removed. A partial row may retain
its real pipes; invented words, omitted negation and reordered cells still fail.
The shared cache contract is `memo-workspace-table-quotes-v12`, used by both
browser reuse and durable generation jobs.

Acceptance requires source regressions, Worker/browser tests, real supplied
memo tests on Dev, separate file persistence through reload, manual grouping,
desktop/phone inspection, and exact-source production package verification.
Controlled model fixtures are not evidence of live model acceptance.

Account displays verified profile details when supplied and otherwise shows CUNY Login and the verified access role, without unavailable-name/email placeholders. This changes display only, not the identity contract.

The node-submission call allows up to 8,192 completion tokens because GPT-OSS reasoning shares that limit with JSON output; a live six-page memo was cut short at 4,096. Node counts, no-relationship validation and the existing 85-second job deadline remain bounded. Legacy review calls retain their earlier limits.

## Classification placement gate

New Exo placement requires quoted source evidence naming the setting, explicit focal nonparticipation or a staff-only setting, an outside decision/action, and its indirect local effect. The source is checked for contrary focal participation in the same setting. Exo validation and its repair attempts can resolve a participant named in the second quotation against a live Micro person, role, group or family. An office visit elsewhere in the memo only contradicts the proposed placement when the passage identifies the same setting. For a policy, the quoted factual material must describe the operation. Conversely, an explicit outside chain must not become a directly participated Micro office. The model withholds unsupported placement rather than turning an institution name into an Exo rule. A Macro condition is distinct from its administering office.

This is a conservative textual evidence gate, not a universal semantic proof. It may withhold a legitimate setting whose participation or pathway is only implied. The [classification evidence cases](CLASSIFICATION_EVIDENCE_2026-11-04.md) require same-name direct/indirect, ambiguity, staff-only, resident-board-member, negation and policy/office comparisons. Existing-ID evidence refresh preserves manual classification and does not rerun new-placement heuristics over the student's saved choice.

## Incremental updates and identity

`workflowMode: "student-nodes-v1"` remains the account contract for initial and updated memos. An update adds optional `memoUpdate` with `version: 1`, `part`, `baselineFingerprint`, `sourceFingerprint`, exact current-source `passages` (`start`, `end`, `text`), and `existingNodes` containing current identity plus `originalLabel`, `originalType`, `originalScale` and `removed`. Current labels alone cannot identify a previously generated node after student edits.

The provider receives changed passages and bounded graph identity context. If a broad rewrite or deletion-only change produces no suitable bounded passages, the explicit fallback is the complete current active memo. The other memo is not substituted. Evidence must quote supplied current-source narrative; repair attempts retain the same update/identity context and cannot use passages withheld from that request.

Output retains the existing five-key envelope with empty guidance, connections and example and no scopes. At most six node entries are allowed, including updates. New Part 2 nodes may be any mix of Exo and Macro within the six. Optional node `existingId` must identify a live known record and echo its current label, type and scale. It refreshes evidence only if the current evidence still matches the previous generated baseline. Unknown IDs, duplicate identities and unsupported evidence reject the result before mutation. The model never deletes or reconnects student work.

Each memo independently saves optional `analysis` (`version`, `sourceFingerprint`, `contentFingerprint`, block fingerprints, and original generated node identity/evidence). This records the last successful submission, never the draft. A meaningful narrative edit marks the memo pending. Whitespace-only and bibliography-only edits save without requiring paid regeneration. A successful empty response completes the checkpoint. Older projects without a baseline use conservative exact-fingerprint success evidence; opening them never rewrites their map.

The analysis/request baseline is bounded to 64 KiB and changed passages to 24 KiB before full-active-source fallback; identity lists are rejected if oversized rather than silently truncated. Incremental provider context may use up to 80 KiB, while full source remains capped at 128 KiB and the wire payload at 256 KiB. Graph changes, memo completion and analysis update form one durable Undo transaction. Non-private exports remove analysis and edit history. Failed, cancelled or stale results preserve the prior graph, baseline and current draft.

A previously successful Part 1 baseline satisfies the initial Part 2 prerequisite even if Part 1 later has an unsubmitted edit. The active part’s pending edit still requires Update map before its own Continue, but it cannot lock an independently completed Part 2. Returning between memos preserves both drafts and never regenerates them automatically.

## Manual editing acceptance

Continue checks only the current part's successful memo submission. Drawing does not wait for that submission: once the map holds a live node, double-click, keyboard Shift+Enter or Connect from starts a student connection (an Exo or Macro source may also target a local relationship line, and double-clicking empty canvas adds a node in that level); an empty-canvas click or keyboard N can draft a node only when its relationship is also named and saved atomically. Cancel creates no records. A local connection created while viewing Micro stores Meso scale and appears immediately without changing the current step. Node colors are Automatic or Blue, Teal, Purple, Amber, Rose and Slate; colors are independent of ecological classification and survive save, Undo, reload and visual export. These behaviors require local tests and Dev inspection before claiming release.

Policies/laws and external offices are represented at Exo under the explicit course convention. Macro names independently evidenced cultural, ideological, historical and economic conditions. See [classification evidence](CLASSIFICATION_EVIDENCE_2026-11-04.md). Existing saved maps are preserved; new classifications and explicit corrections use this convention.

A specifically identified functional office name need not use title case. Automatic Exo placement still requires a source-grounded indirect decision pathway. An explicitly named focal person can supply the participation subject, and an immediately adjacent sentence about “this office” can complete the same quoted chain; evidence from another setting cannot. Concrete authorization policies remain Exo.
