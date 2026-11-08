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

## Left-out reasons (`src/memoWorkflow.js`, `WITHHELD_REASON_TEXT`), shipped in `c635b9f`

Shown after a memo submission as "Left out: *label* (reason)" and in the
Notebook under "Left out of this step".

| Reason | Text | Status |
| --- | --- | --- |
| heading | Left out of this step | pending |
| footer | Add any of these yourself in Tools if your memo supports it. | pending |
| `outside_participation` | the memo describes people taking part there, or leaves their participation unknown | pending |
| `policy_operation` | no established rule and its local effect was quoted | pending |
| `narrative_quote` | its evidence was not a quote from the memo | pending |
| `evidence_limit` | its quote was longer than 500 characters | pending |
| `established_condition` | its evidence was a wish, recommendation or question, not an established condition | pending |
| `label_format` | its label was a sentence or statement, not a name | pending |
| `identity_duplicate` | it repeats a node already on the map | pending |
| `existing_identity` | it changed an existing node instead of adding evidence | pending |
| `scale_type` | its type does not belong at this level | pending |
| `node_shape` | its entry was incomplete | pending |
| `unsupported` | no supporting passage was found on a second reading | pending |
| fallback | it did not pass the evidence checks | pending |
| toast | No new nodes were added. Left out: … Use Tools to add nodes yourself. | pending |

## Removed from the Notebook sidebar (2026-11-07)

The step instruction paragraph no longer appears in the Notebook; the corner
guide carries it. Still shown there: the step title, the step buttons, "Open
Memo" while the memo is unread, and the left-out list.

- Select a node to edit it. Double-click a node to start a connection.
- Select an Exo node and connect it to the local relationships it affects.
- The `MEMO_WORKFLOW[scale].instruction` sentences (kept in code for the
  reading view and tests, not rendered in the Notebook).
