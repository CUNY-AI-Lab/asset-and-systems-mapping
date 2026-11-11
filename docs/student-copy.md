# Student-facing copy awaiting approval

Student-facing text is not added to the application without approval. This
file lists every string introduced or changed since release `2bd2434`
(2026-11-06), where it appears, and its status. Approved strings are removed
from this list; rejected strings are replaced in the same change that records
the decision.

Status: **pending** unless marked otherwise.

## Corner guide on the map (`src/memoWorkflow.js`, `WORKFLOW_GUIDE`)

One line in the upper-left of the canvas; changes with the step and the map.

| Key | Text | Status |
| --- | --- | --- |
| `memo` | Open Memo and add its nodes to the map to continue. | existing copy, moved |
| `micro` | Select a node to edit it. Double-click the canvas to add a node. | dictated 2026-11-07 |
| `meso` | Double-click a node to connect it. Double-click the canvas to add a node. | pending |
| `exosphere` | Double-click an Exo node, then click the local relationship it affects. | pending |
| `macrosphere` | Double-click a condition, then click the relationship or setting it shapes. | pending |
| `newNode` | New node. Click the map to cancel. | pending |
| `newRelationship` | New relationship | existing copy |

## Add-node form (`src/App.jsx`)

| Where | Before | After | Status |
| --- | --- | --- | --- |
| Micro context field | Person’s involvement | Involvement | dictated 2026-11-07 |
| Micro context field | Where this belongs | Setting | pending (one word requested) |
| Setting picker placeholder | Choose where this belongs… | Choose… | pending |
| Hint under Level | It will sit where you double-clicked. | removed | dictated 2026-11-07 |
| Announcement on click-away | — | New node cancelled. | pending (screen reader only) |

## Left-out list (`src/memoWorkflow.js`, `WITHHELD_REASON_TEXT`; `src/MemoWorkflowNotebook.jsx`)

Shown in the Notebook after a memo submission. Each entry is the proposed name
on one line and a short reason under it. The message after a submission only
counts them ("8 nodes added. 3 left out; the Notebook lists them.").

Rewritten 2026-11-10 at Zach's request for more idiomatic wording. A node
that a retry dropped but that passes every rule is now put back on the map, so
only nodes that fail a rule are listed. The participation reason is split into
the four cases it covered, so a Micro office no longer reads "belongs at Micro".

| Reason | Before | After | Status |
| --- | --- | --- | --- |
| heading | Left out | Left out | unchanged, pending |
| footer | Add any of these in Tools if the memo supports it. | Add any of these that the memo supports. | pending |
| `outside_setting` (Micro) | People in the memo take part here, so it belongs at Micro | An outside office, so it belongs at Exo | pending |
| `participation_conflict` (Exo) | People in the memo take part here, so it belongs at Micro | People in the memo take part in it, so it belongs at Micro | pending |
| `participation_unknown` (Exo) | People in the memo take part here, so it belongs at Micro | The memo says it is unclear whether people take part in it | pending |
| `setting_unnamed` (Exo) | People in the memo take part here, so it belongs at Micro | The quote does not name it | pending |
| `policy_operation` | The memo does not quote the rule | The quote does not show how the rule works here | pending |
| `narrative_quote` | Not quoted from the memo | The quote is not word for word from the memo | pending |
| `evidence_limit` | Quote longer than 500 characters | The quote runs over 500 characters | pending |
| `established_condition` | Stated as a wish or a question | The memo puts it as a wish or a question, not as fact | pending |
| `label_format` | Name is a sentence or covers more than one thing | The name is a sentence or lumps several things together | pending |
| `identity_duplicate` | Already on the map | Already on the map | unchanged, pending |
| `existing_identity` | Would change a node already on the map | It would change a node already on the map | pending |
| `scale_type` | Type does not fit this level | Its type does not fit this level | pending |
| `node_shape` | Incomplete entry | The entry came back incomplete | pending |
| `node_limit` (new) | — | The submission was already full at 10 nodes | pending |
| `outside_participation` (saved maps only) | People in the memo take part here, so it belongs at Micro | The memo does not make clear which level it belongs at | pending |
| `unsupported` (saved maps only) | No passage in the memo supports it | Dropped when the memo was read a second time | pending |
| fallback | Did not pass the evidence checks | Did not pass the evidence checks | unchanged, pending |

## Submission messages (`src/App.jsx`)

| Before | After | Status |
| --- | --- | --- |
| N nodes added; M evidence passages updated. Your connections and manual edits are preserved. Left out: … | N nodes added and M quotes updated. K left out; the Notebook lists them. | pending |
| N nodes added to your map. Left out: … | N node(s) added. K left out; the Notebook lists them. | pending |
| No new nodes were added. Left out: … Use Tools to add nodes yourself. | No new nodes were added. The Notebook lists the K left out. | pending |
| No new nodes were added. Proposed nodes that did not pass the evidence checks were left out. Use Tools to add nodes yourself. | No proposed nodes passed the evidence checks. Add nodes in Tools. | pending |
| No new nodes were added: nothing new in this memo was identified for this step. Use Tools to add nodes yourself. | This memo has no new nodes for this step. Add nodes in Tools. | pending |

## Error messages (`src/userFacingError.js`)

Reassurance tails ("Your existing work was not changed.", "your map remains editable", "your map is unchanged") removed from nine messages; the rejection sentence is now "Nothing was added because {reason}. Try again, or add the node in Tools." Reason phrases shortened: outside office quote does not name it or say who takes part there; local people take part in an office proposed for Exo, so it belongs at Micro; a proposed condition was a wish, recommendation or question; a proposed node name covered more than one thing. The quotation case reads "A quote in the feedback could not be checked. Try again." All pending.

The audit of 2026-11-08 lists 40 findings in all; the rows above cover the toasts, the add-node form and the error text. The remaining rows (field hints, status lines, Tools labels, the duplicate Auto-fit checkbox) are in the change record and wait for a decision.

## AI-tell sweep before the sign-out release (2026-11-08)

Zach: "check for ai slop copy that is student-facing. None of that." A read of every student-facing string over 45 characters (617 lines, excluding instructor files and model prompts) found no vocabulary tells; the fixes below remove em-dash hinges, "cumulative" and one leftover reassurance tail. Listed so the wording can still be changed.

Reverted 2026-11-09: the sweep also replaced the About panel's first sentence, which Zach wrote (commit `ac7ebe8`). His sentence is restored with one change he dictated the same day: "asset and systems mapping theory" becomes "ecological systems theory". Copy he authored is not in scope for a sweep like this; check `git log -S` for the author before touching a string.

| Where | Before | After |
|---|---|---|
| Memo heading | {Part} — set the focus for your map / build on your first memo and the existing map | {Part}. Set the focus for your map. / Build on your first memo and the existing map. |
| Memo privacy note (Part 2) | {Part} — both memos and your existing graph inform guidance | {Part}. Both memos and your existing map inform guidance. |
| Guidance toast | Suggestions could not be added — generate guidance again | Suggestions could not be added. Generate guidance again. |
| Level complete | Your cumulative project is ready to review or export. | Your project is ready to review or export. |
| Meso pause panel | Your cumulative map is saved and ready to review or export. | Your map is saved and ready to review or export. |
| Share-link explainer | The complete project—including its memo and evidence notes—will be stored on the class server for 90 days. | The complete project, including its memo and evidence notes, is stored on the class server for 90 days. |
| Durable guidance failure | Generation needs another attempt. Your existing work was not changed. | Generation did not finish. Try again. |

Left as is: project-title suffixes " — new map" and " — device copy" (labels, not prose); "Try again when you are ready." in two cancellation messages.

## Behaviour change behind the list (2026-11-08)

A node that still fails its rule after the two corrections no longer sinks the
whole memo. The supported nodes are added and the failing ones appear in this
list with their reasons. Identity failures (an unknown, removed, renamed or
duplicated existing node) still fail the submission as a whole.

## Removed from the Notebook sidebar (2026-11-07)

The step instruction paragraph no longer appears in the Notebook; the corner
guide carries it. Still shown there: the step title, the step buttons, "Open
Memo" while the memo is unread, and the left-out list.

- Select a node to edit it. Double-click a node to start a connection.
- Select an Exo node and connect it to the local relationships it affects.
- The `MEMO_WORKFLOW[scale].instruction` sentences (kept in code for the
  reading view and tests, not rendered in the Notebook).
