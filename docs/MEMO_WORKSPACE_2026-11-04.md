# Memo workspace wireframe and behavior

This design precedes application implementation. Interactive wireframe: [memo-workspace.html](wireframes/memo-workspace.html). Its content is fictional and it makes no model or account calls.

## Project entry

Projects begins with two visible fields, Project title and Creator name, and a prominent New project action. Saved rows show the title and creator, searchable by either. The existing Project menu provides Project details with those same two editable fields. Opening any saved map preserves its chosen identity.

## Screen states

1. **Open a new project:** show the canvas immediately, with the Memo panel at the top right. Briefly emphasize Memo and its upload control without stealing focus. Never replace the entire canvas with intake.
2. **Open an existing project:** retain its graph, camera, stage and memo drafts. Notebook is available beside Memo and Tools. A pending memo draft is visibly marked; reopening does not submit it.
3. **Memo:** the same resizable sidebar contains independent Part 1 / Part 2 sources, file upload, editable text and a sticky top action. The old private-information toggle is removed; an existing unconsented private memo retains its permission control. The current part opens by default; switching parts never copies the other memo into its editor.
4. **Memo edited:** show “Update map” when text differs from its last successful submission. Send the significant changed passages and prior accepted map context to the model. A failed or cancelled request preserves both draft and map. An unchanged memo does not trigger a paid regeneration.
5. **Map updated:** return to Notebook with a concise result count. Add supported new nodes and update eligible evidence on existing nodes by stable identity; preserve student labels/classifications, positions, notes, all student-created relationships and removed decisions. Undo can reverse the update. The model never draws relationships.
6. **Notebook:** progression, nodes, relationships and optional notes. No duplicate memo accordion or suggestion queue. Back and Undo retain their distinct view/content meanings.
7. **Tools:** current map controls in the same sidebar. Hide collapses the sidebar while leaving Memo · Notebook · Tools accessible.
8. **Information:** an i icon immediately left of the bug icon, using current header spacing, color and size tokens. A light nonmodal flag contains the user's description plus exactly two practical sentences. It dismisses after a short interval, pauses while hovered or focused, dismisses on Escape/outside interaction, and can always be reopened. Respect reduced motion.
9. **Narrow screens:** preserve visible canvas context above a scrolling panel, readable tabs and touch targets. Do not place a full-screen modal over the map or shrink controls to fit.

## Info copy

Systems mapping helps students visualize memos as network graphs scaffolded across local and global scales, using asset and systems mapping theory to connect nodes across people and places, laws and policies, along with broader historical and sociological influences.

Upload your first memo to place people, places, and resources on the map, then use Notebook to create and label their relationships. Add your second memo to extend the map to institutions and broader conditions; edit either memo in Memo and choose Update map to incorporate your changes.

## Canvas-driven progression and direct editing

- Continue stays at the top. The only required checkpoint is a successful memo-to-nodes submission for the current part. A later edit to Part 1 does not lock an already generated Part 2. Connections, optional notes and review screens do not gate progression. Empty but successfully processed results remain complete; the app must not invent nodes to unlock navigation.
- Scaffold Micro/Meso around the same local canvas and Exo/Macro around the expanded canvas. Move to the next memo on this operational page, with the current graph retained.
- Auto-fit places unpinned outer cards around the retained Micro content to fit the available canvas, using vertical space when local content is wide. Preserve saved/manual pins, retired records and graph data on opening or resizing; disabling auto-fit uses saved coordinates exactly.
- With auto-fit on, an active outer-node move from a valid position stops along its path before entering the preceding sphere. Legal moves retain their chosen position, imported pins are not corrected automatically, and the System field remains the way to reclassify a node. Auto-fit off removes the movement constraint.
- Node color can be Automatic or a named accessible palette color. This is presentation only, independent of system/type. Save, Undo, reload and exports preserve it.
- Double-click a node to start a connection; then click another node to connect existing nodes, or click empty canvas to create a connected node at that location. A compact editor asks for a new node label when needed and the relationship wording. Save both atomically; Escape/cancel leaves no half-created node or edge. A source deletion cancels the operation. Back never resurrects a cancelled or incomplete connection draft.

## Compact controls and list

- Keep Systems Mapping visible in the header, including the 806-pixel layout. Link both footer credits.
- Use compact text with 44-pixel control targets. Back stays on one line; Undo/Redo and Continue share its row without increasing its height.
- Tools uses the remaining sidebar height with one scroller. Add item and Map key come first; − and + stay adjacent, followed by Fit map.
- Find a node searches part of a node name across mapped levels; it does not search memo passages or infer meaning.
- A selected item has one header: title, smaller On map / Not on map status, and equal-width Remove / Add to map and Done actions. An empty inspector returns to Notebook.
- List rows stay compact and single-line inside their own horizontal scroller, without extending beneath the sidebar. Detailed evidence remains in the selected item.

## Incremental update constraints

- Store a last-successful baseline independently for each memo. Draft saving must not advance that baseline.
- Compare submitted and edited text; prioritize changed passages while retaining enough surrounding source for exact evidence validation. Avoid presenting a marginal edit as a new unrelated project.
- Existing IDs and original generated labels are the identity anchors, including renamed, reclassified and removed nodes. Do not match solely on their current labels.
- Existing manual records and every relationship are preserved. Deletions in memo prose do not automatically delete a student's node or its connections.
- Apply a validated update atomically and capture it in saved Undo. Reject unknown IDs, duplicate identities, stale responses, oversize input and unsupported evidence before graph mutation.
- Model output stays small and node-only. Part 2 classifies Exo organizations and Macro conditions using the retained Part 1 map as context and the active Part 2 memo as source. The Part 1 memo is never copied into the Part 2 editor or submitted as its source.
- Legacy projects without a submitted baseline are handled conservatively and never rewritten just by opening them.

## Reports

Report a bug or request a feature asks “What went wrong? What could be better?” New reports go directly to private Redmine tickets using the existing configured project, tracker and credentials. If that route fails, preserve the draft for retry instead of silently switching to email. Previously delivered receipts retain their original channel and idempotency.

## Release boundary

The pre-change production baseline was `9fa6e00b78ae08292b10acc148c5c3c4925a7d4e`; its source, readiness, three entry-asset hashes and 100% traffic were checked before this work. The user authorized this design on Dev, ten screenshots and a regression audit, followed by production. The [November 5 release receipt](../TODO.md#memo-workspace-release-receipt--november-5-2026) records the exact candidate, current deployment evidence and remaining acceptance. Earlier saved-map test/restoration incidents remain in their dated audit records; this specification is not an assertion about their current state.
