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
| footer | If your memo supports one of these, add it yourself in Tools. | revised 2026-11-08, pending |
| `outside_participation` | the memo shows local people taking part there, or does not say whether they do | revised 2026-11-08, pending |
| `policy_operation` | the memo does not quote the rule or what it changes locally | revised 2026-11-08, pending |
| `narrative_quote` | its evidence is not quoted from the memo | revised 2026-11-08, pending |
| `evidence_limit` | its quote runs past 500 characters | revised 2026-11-08, pending |
| `established_condition` | its evidence is a wish, a recommendation or a question | revised 2026-11-08, pending |
| `label_format` | its label is a whole sentence; a node needs a name | revised 2026-11-08, pending |
| `identity_duplicate` | it repeats a node already on the map | pending |
| `existing_identity` | it would change a node already on the map | revised 2026-11-08, pending |
| `scale_type` | its type does not belong at this level | pending |
| `node_shape` | its entry is incomplete | revised 2026-11-08, pending |
| `unsupported` | a second reading found no passage that supports it | revised 2026-11-08, pending |
| fallback | it did not pass the evidence checks | pending |
| toast | No new nodes were added. Left out: … Use Tools to add nodes yourself. | pending |

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
