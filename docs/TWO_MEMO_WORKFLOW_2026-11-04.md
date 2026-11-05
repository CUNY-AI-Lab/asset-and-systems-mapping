# Two memos, four steps and three spheres — November 4, 2026

This is the current account-workspace contract, incorporating the user's later November 4 corrections. It supersedes the earlier two-sphere design, automatic relationship suggestions, required Field Notes and Map button. The separate Node application retains its older review workflow.

## Student progression

1. **Micro:** upload and submit the first memo. Add a small supported node set immediately. Students can edit nodes; they draw no relationships through the model.
2. **Meso:** students draw and name relationships between local nodes.
3. **Exo:** upload a separate second memo. Keep the original graph and classify new outside settings and broader conditions. Students connect Exo headings to selected local Meso relationships.
4. **Macro:** students connect broader policies, values and structural conditions to the settings or local relationships they affect. Named people and institutions are not Macro conditions.

The model returns at most six nodes per submission, with no guidance, relationships, examples, scopes or group memberships. Part 2 permits at most three Exo and three Macro nodes. Weak evidence may correctly produce no nodes. Source text is data, never authority to alter this contract. Successful processing is not certification of a student's interpretation.

People and participant roles (such as a community counselor) cannot become Exo nodes by being labeled resources. Part 2 omits those local roles; a named counseling office or an outside funding resource may still qualify. Students can correct a saved node's System and Type in the editor. Saving retains its ID, evidence, notes, position and existing relationships; a change that conflicts with a saved connection or membership is rejected without modifying the map.

The canvas and resizable Notebook remain visible together. Tools is inside that sidebar; Hide closes it explicitly. Continue, Back and selected-item actions stay above scrolling content. Field Notes are optional. Remove and Add to map reflect one saved state, and never appear together for a node. Removing a connection source or double-clicking during connection mode cancels the operation. Micro's instruction is “Select a node to edit it.” Evidence excerpts are labeled “Quote from memo.”

## Independent sources and persistence

`submission` retains Part 1. `part2Submission` has its own text, filename, revision, fingerprint and privacy declarations. The second editor starts empty; it never displays or submits Part 1 as Part 2. The previous graph provides context. Changing a source does not clear prior nodes, relationships, positions, notes or retired-item decisions. Delayed imports and model results cannot replace a newer edit or a different project.

The account node-submission path uses `student-nodes-v1` and `preflightEvaluationPayload(project, true)`. The legacy Node review contract remains separate. Existing mapped review-stage projects open their node view; pending submissions and explicit Edit retain memo entry. A successful empty result remains complete after navigation and reload.

## Map and manual groups

Three content-fitted nested regions show **Microsystem**, **Exosystem** and **Macrosystem**; Meso relationships occupy Micro space. Node type and level colors are supplemented by labels and line patterns. Relationship verbs remain attached to their routes. Auto-fit separates cards and shared route segments; unavoidable crossings have visual separation. Manual positions persist when auto-fit is off.

Region boundaries fit uneven content in both axes and enclose each inner contour and caption. This view calculation does not rewrite node coordinates. The account sidebar uses small semibold field labels and captions, readable content, compact secondary controls and one prominent content-width progression button. Desktop controls are 40 pixels high; phone and coarse-pointer controls retain 44-pixel targets. Focus states, dark-mode contrast and text wrapping remain part of the shared styling contract.

A manually created group records 1–24 exact live Meso `relationshipIds`. Its heading is an Exo or Macro node. The serialized target is a real member endpoint for compatibility; membership is defined by relationship IDs, not that anchor. Validation rejects unknown, retired, nested and out-of-scale members. Students must revise/remove a dependent group before removing its member relationship. Ordinary node-to-node links omit `relationshipIds`.

## Compatibility and verification

Schema 10 retains source texts, graph IDs, membership IDs, annotations and legacy scoped nodes. Analytical IDs and stored stage numbers remain unchanged. No Durable Object namespace or database restore is involved. Rollbacks must retain the schema-10 reader and both memo fields. Private JSON/Markdown retain both sources; CSV includes group IDs; PNG/PDF render the three regions and manual links. Audience restrictions continue to apply.

Tests must exercise the current node-only payload and zero model relationships at every step. Include independent uploads, empty and weak results, named-institution versus Macro classification, bibliography-only evidence, stale/failed jobs, manual groups, removal/resubmission, reload, exports, keyboard and phone behavior. Controlled tests establish application behavior, not live model quality.

The four supplied PDFs remain outside Git. Approved live tests cover those real inputs and fabricated Bronx, Flushing and housing continuations. Real Gateway tests require approval of data and destination; fixture identity helpers are not production authentication. Record exact source, actual runtime/model, failures, retries and retained-state comparisons separately from CI and deployment receipts.
