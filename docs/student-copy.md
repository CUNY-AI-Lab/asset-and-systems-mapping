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

| Reason | Text | Status |
| --- | --- | --- |
| heading | Left out | revised 2026-11-08, pending |
| footer | Add any of these in Tools if the memo supports it. | revised 2026-11-08, pending |
| `outside_participation` | People in the memo take part here, so it belongs at Micro | revised 2026-11-08, pending |
| `policy_operation` | The memo does not quote the rule | revised 2026-11-08, pending |
| `narrative_quote` | Not quoted from the memo | revised 2026-11-08, pending |
| `evidence_limit` | Quote longer than 500 characters | revised 2026-11-08, pending |
| `established_condition` | Stated as a wish or a question | revised 2026-11-08, pending |
| `label_format` | Name is a sentence or covers more than one thing | revised 2026-11-08, pending |
| `identity_duplicate` | Already on the map | revised 2026-11-08, pending |
| `existing_identity` | Would change a node already on the map | revised 2026-11-08, pending |
| `scale_type` | Type does not fit this level | revised 2026-11-08, pending |
| `node_shape` | Incomplete entry | revised 2026-11-08, pending |
| `unsupported` | No passage in the memo supports it | revised 2026-11-08, pending |
| fallback | Did not pass the evidence checks | revised 2026-11-08, pending |

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
