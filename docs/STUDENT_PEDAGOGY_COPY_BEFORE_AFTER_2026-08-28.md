# Student pedagogy copy before and after

> **Historical record.** Claims of “current,” “implemented,” or “verified” below refer to this document’s dated source and environment. The November 4 [Memo workspace](MEMO_WORKSPACE_2026-11-04.md), [two-memo workflow](TWO_MEMO_WORKFLOW_2026-11-04.md) and [classification evidence](CLASSIFICATION_EVIDENCE_2026-11-04.md) govern the account application. Older screen, model-output and sphere rules do not override them; the receipts below are preserved, not rerun acceptance.

Updated: 2026-08-28

## Scope

This ledger records student-facing literal copy changed in the current working comparison for `src/App.jsx`, `src/MapListView.jsx`, and the import message in `src/domain.js`. It includes visible labels, help text, status messages, validation and recovery messages, accessible names, and student exports. Internal identifiers, code comments, test fixtures, server prompts, and Teacher Console copy are outside the main ledger. The progression optimization appendix separately records the server-prompt literals changed in that pass.

`Before` reproduces the earlier literal. `After` reproduces the current literal. `Not present` marks newly added copy; `Not present` in the After column marks removed copy. Dynamic values appear in braces. Git commit history is the durable direct diff; this ledger remains a readable copy inventory.

## Inquiry framing

| Before | After |
| --- | --- |
| Not present | `Evidence used` |
| Not present | `Name the accounts, documents, observations, or records that support this map.` |
| Not present | `Missing perspectives` |
| Not present | `Name whose account or knowledge is not represented yet.` |

## Model disclosure

| Before | After |
| --- | --- |
| `Generated guidance is retained for {count} {day or days}.` | `Classroom server retains the memo request and generated guidance for {count} {day or days}.` |
| Not present | `Your working project stays on this device unless you create a project link.` |
| `Choosing Generate guidance sends your memo and map framing to {model} via {provider}.{retention}` | `Choosing Generate guidance sends your memo and map framing to {model} via {provider}.{retention}{device-storage notice}` |
| `Guidance runs on the classroom server without sending your memo to an external model provider.{retention}` | `Guidance runs on the classroom server without sending your memo to an external model provider.{retention}{device-storage notice}` |
| `Generate guidance is optional. You can continue without sending the memo for model review.{retention}` | `Generate guidance is optional. You can continue without sending the memo for model review.{retention}{device-storage notice}` |
| Not present | `Review or redact memo` |

## Memo review

| Before | After |
| --- | --- |
| `Where your memo stands` | `Coverage and uncertainty` |
| Not present | `Coverage and uncertainty` |
| `Suggested Micro elements` | `Suggested Micro-level items` |
| `. Select the affected mapped elements at the next step.` | `. Select affected map items at the next step.` |

## Micro participation and membership

| Before | After |
| --- | --- |
| Not present | `Relation to focal person` |
| Not present | `Record whether the person at the center of the map participates directly, is affected without participating, or whether the memo is unclear.` |
| Not present | `Participates directly` |
| Not present | `Affected without participating` |
| Not present | `Unclear from the memo` |
| Not present | `Not applicable` |
| Not present | `Immediate settings for this item` |
| Not present | `Choose the Micro settings where this person, group, activity, object, or resource is encountered.` |
| Not present | `Add Micro setting…` |
| Not present | `{setting} — removed` |
| Not present | `No Micro settings are available yet.` |
| Not present | `Micro context for {item}` |
| Not present | `Relation to focal person for {item}` |
| Not present | `Remove {setting} from the immediate settings for {item}` |
| Not present | `Add an immediate setting for {item}` |
| Not present | `{participation}, {count} immediate {setting or settings}` in each Micro item’s accessible name |
| Not present | `Focal participation unclear` fallback |
| Not present | `Add each selected Micro setting for {item}, or remove the unavailable setting membership before opening the map.` |
| Not present | `Remove the immediate setting memberships before changing this item to a setting.` |

## Evidence records

| Before | After |
| --- | --- |
| Not present | `Evidence records` |
| Not present | `Add record` |
| Not present | `Evidence record {number}` |
| Not present | `{completed} of {total} fields` |
| Not present | `Separate memo language, your interpretation, and remaining questions.` |
| Not present | `No evidence records yet.` |
| Not present | `Remove record` |
| Not present | `Memo passage or evidence` |
| Not present | `Copy the memo passage or other project evidence that supports this claim.` |
| Not present | `Student interpretation` |
| Not present | `State what you think this evidence shows.` |
| Not present | `Reasoning` |
| Not present | `Explain why the passage supports your interpretation.` |
| Not present | `Uncertainty` |
| Not present | `Record what remains unclear or unsupported.` |
| Not present | `Counterevidence` |
| Not present | `Record evidence that challenges or complicates this claim.` |
| Not present | `Missing perspective` |
| Not present | `Name whose account or knowledge is absent.` |
| `Evidence` inspector disclosure and field label | `Evidence note` inspector disclosure and field label |

## Process and time

| Before | After |
| --- | --- |
| Not present | `Process and time` |
| Not present | `Micro relationship` |
| Not present | `Exo-level connection` |
| Not present | `Record how this connection operates. Leave any unknown field blank.` |
| Not present | `Frequency` |
| Not present | `Duration` |
| Not present | `Direction` |
| Not present | `Conditions` |
| Not present | `What must be true for this connection to work?` |
| Not present | `Change over time` |
| Not present | `Describe what has changed, when known.` |
| Not present | `Not recorded` |
| Not present | `Starting item to ending item` |
| Not present | `Ending item to starting item` |
| Not present | `Both directions` |
| Not present | `Direction varies` |
| Not present | `Not yet known` |
| Not present | `{source} to {target}` |
| Not present | `{target} to {source}` |

## Suggestion review

| Before | After |
| --- | --- |
| `Needs more evidence` | `Set aside — needs evidence` |
| `Model suggestions stay off the map until you choose Add to map. Editing a suggestion does not add it. Choose Needs more evidence to set one aside, or Remove to leave it off the map.` | `Model suggestions stay off the map until you choose Add to map. Editing a suggestion does not add it. Choose Set aside — needs evidence to preserve a question for later, or Remove to leave it off the map.` |
| `Add all {count} remaining to map` | Not present |
| `Review the remaining items individually before adding all of them.` | Not present |
| `Remaining nodes added to map` | Not present |
| `Remaining connections added to map` | Not present |
| Not present | `Suggestion groups` |
| Not present | `Connection suggestion groups` |
| Not present | `Suggestions {first}–{last} of {total}` |
| Not present | `Previous` |
| Not present | `Next` |

## Meso-level copy

| Before | After |
| --- | --- |
| Not present | `What passes, coordinates, or conflicts?` |
| Not present | `Describe information, resources, schedules, rules, coordination, or conflict across these settings.` |

## Exo-level copy

| Before | After |
| --- | --- |
| `Review institutional relationships` | `Review Exo-level connections` |
| `Decision pathways` | `Exo-level connections` |
| `Review decision pathways` | `Review Exo-level connections` |
| `More decision pathways` | `More Exo-level connections` |
| `Decision pathway` | `Exo-level connection` |
| `Institutional relationship` | `How institution affects Micro setting` |
| `Relationship` in the new-institution form | `How institution affects Micro setting` |
| `Name an institution whose decisions or actions affect an element already on the map. Then choose the institutional relationship and the affected element.` | `Name an institution whose decisions or actions affect an item already on the map. Then choose how it affects a Micro setting.` |
| `Choose an Exo-level outside decision setting as the pathway source.` | `Choose an Exo-level outside decision setting first.` |
| `Choose a Micro setting already carried on the map as the affected setting.` | `Choose an affected Micro setting already on the map.` |
| `Add the outside decision setting to the map before adding its pathway.` | `Add the outside decision setting before adding its Exo-level connection.` |
| `Choose a Micro setting already carried on the map.` | `Choose a Micro setting already on the map.` |
| `Choose a carried Micro setting…` | `Choose a Micro setting already on the map…` |
| `{institution} added with a decision pathway to {setting}.` | `{institution} added with an Exo-level connection to {setting}.` |
| `{institution} added. Add its decision pathway at the next step.` | `{institution} added. Add its Exo-level connection at the next step.` |
| `No decision pathways came from your memo yet. Ask the model for suggestions, or add a pathway yourself on the map.` | `No Exo-level connections came from your memo yet. Ask the model for suggestions, or add a connection on the map.` |
| `Choose one Exo-level outside decision setting and one Micro setting already carried on the map.` | `Choose one Exo-level outside decision setting and one Micro setting already on the map.` |
| `This pathway must run from one Exo-level outside decision setting to one carried Micro setting before it can return to the map.` | `This Exo-level connection must run from one outside decision setting to one Micro setting already on the map.` |
| `Connect one Exo-level outside decision setting to one carried Micro setting.` | `Connect one Exo-level outside decision setting to one Micro setting already on the map.` |
| `Choose an institutional relationship such as funds, regulates, employs, or provides.` | `Choose how the institution affects the Micro setting: funds, regulates, employs, or provides.` |
| `Repair or remove each Exo-level pathway before opening the map. Every pathway needs one outside decision setting and one carried Micro setting.` | `Repair or remove each Exo-level connection before opening the map. Every connection needs one outside decision setting and one Micro setting already on the map.` |

## Macro-level copy

| Before | After |
| --- | --- |
| `At Macro-level, add broader laws, public policies, economic conditions, histories, or cultural beliefs that shape at least two mapped elements. Place named institutions at Exo-level.` | `At Macro-level, add broader laws, public policies, economic conditions, histories, or cultural beliefs that shape at least two map items. Place named institutions at Exo-level.` |
| `{condition} added. Choose at least two mapped elements, then decide whether to add it to the map.` | `{condition} added. Choose at least two map items, then decide whether to add it to the map.` |
| `Choose at least two mapped elements for this Macro-level condition.` | `Choose at least two map items for this Macro-level condition.` |
| `How it affects mapped elements` | `How it affects map items` |
| `How {condition} affects mapped elements` | `How {condition} affects map items` |
| `Remove {item} from the mapped elements affected by {condition}` | `Remove {item} from map items affected by {condition}` |
| `Choose at least two mapped elements this item {action}.` | `Choose at least two map items this condition {action}.` |
| `A Macro-level condition must affect at least two mapped elements.` | `A Macro-level condition must affect at least two map items.` |
| `Restore at least two affected mapped elements before returning this Macro-level condition to the map.` | `Restore at least two affected map items before returning this Macro-level condition to the map.` |
| `Add Macro-level conditions from the Choose stage so each one identifies the mapped elements it affects.` | `Add Macro-level conditions from the Choose stage so each one identifies the map items it affects.` |
| `Macro-level conditions identify the mapped elements they affect. Add direct connections at Micro-level.` | `Macro-level conditions identify the map items they affect. Add direct connections at Micro-level.` |
| `Showing mapped elements affected by {condition}.` | `Showing map items affected by {condition}.` |
| `Choose a Macro-level condition to see the mapped elements it affects.` | `Choose a Macro-level condition to see the map items it affects.` |
| `Choose at least two mapped elements.` | `Choose at least two map items.` |
| `Mapped elements affected by {condition}` | `Map items affected by {condition}` |
| `Add a mapped element affected by {condition}` | `Add a map item affected by {condition}` |
| `Name a broader law, policy, economic condition, history, or cultural belief that affects more than one mapped element. Then select the affected elements.` | `Name a broader law, policy, economic condition, history, or cultural belief that affects more than one map item. Then select the affected items.` |
| `Broader laws, public policies, economic conditions, histories, and cultural beliefs that affect more than one mapped element.` | `Broader laws, public policies, economic conditions, histories, and cultural beliefs that affect more than one map item.` |
| `The review found 1 possible Macrosphere condition affecting at least two mapped elements.` | `The review found 1 possible Macrosphere condition affecting at least two map items.` |
| `The review found {count} possible Macrosphere conditions, each affecting at least two mapped elements.` | `The review found {count} possible Macrosphere conditions, each affecting at least two map items.` |
| `No supported Macrosphere condition affecting at least two mapped elements was found. You can revise the memo or continue without adding one.` | `No supported Macrosphere condition affecting at least two map items was found. You can revise the memo or continue without adding one.` |
| `After naming the condition, choose the mapped elements it affects.` | `After naming the condition, choose the map items it affects.` |
| `The memo names {count} possible broader conditions and identifies at least two affected mapped elements for each one.` | `The memo names {count} possible broader conditions and identifies at least two affected map items for each one.` |
| `The memo names {count} new institutions and {connection count} supported connections to mapped elements.` | `The memo names {count} new institutions and {connection count} supported connections to Micro settings.` |
| `The memo describes {count} supported outside decision pathways to immediate settings already on your map.` | `The memo describes {count} supported Exo-level connections to Micro settings already on your map.` |
| `Affected map elements` | `Affected map items` |
| `The review did not suggest any new elements. Revise the memo and refresh the guidance, or add an element at the next stage.` | `The review did not suggest any new map items. Revise the memo and refresh the guidance, or add a map item at the next stage.` |
| `Name one complete map element instead of a reference, time, modifier, action, or fragment.` | `Name one complete map item instead of a reference, time, modifier, action, or fragment.` |
| `Use a direct, conventional name for the map element.` | `Use a direct, conventional name for the map item.` |
| `Add element…` | `Add map item…` |
| `Choose map elements` | `Choose map items` |
| `{condition}, {action} {count} mapped elements` | `{condition}, {action} {count} map items` |

## Map legend and validation

| Before | After |
| --- | --- |
| `Layer` | `Levels` |
| Not present | `Person participates directly in this setting or interaction.` |
| Not present | `Linkage joins two or more Micro settings in which the person participates.` |
| Not present | `Person does not participate in this decision setting, but its action reaches a Micro setting.` |
| Not present | `Broader law, policy, economic condition, history, or cultural belief affects several map items.` |
| Not present | `How to read this map` |
| Not present | `Micro relationship` |
| Not present | `Direct connection between Micro-level items` |
| Not present | `Mesosystem` |
| Not present | `Linkage among settings; no directional connection is added` |
| Not present | `Exo-level connection` |
| Not present | `Outside decision setting connected to an affected Micro setting` |
| Not present | `Macro-level condition` |
| Not present | `Map items affected by a broader condition` |
| `A level shows an element’s position relative to the focal person. It does not measure causal strength.` | `Level shows how each item relates to the focal person. It does not show causal strength.` |
| `A Micro relationship must connect two Micro elements.` | `A Micro relationship must connect two Micro-level items.` |
| `Micro elements and direct relationships from your memo are ready for review.` | `Micro-level items and direct relationships from your memo are ready for review.` |

## Dependency repair

| Before | After |
| --- | --- |
| `Removed because one of its mapped scope members is no longer available. The earlier scope remains in the record for review.` | Not present |
| `Retired because one of its mapped scope members was removed during candidate review.` | Not present |
| Not present | `Review or remove connected map work before {action}: {dependent items}.` |
| Not present | `{item} (setting membership)` |
| Not present | `Review or remove {scoped item} before removing one of its map items.` |
| Not present | `Review or remove {source} {relationship} {target} before removing its node.` |
| `must reference a live mapped element` | `must reference a live map item` |
| `does not match the source passage` | `does not match the memo passage` |

## Inspector, list, sharing, and progress

| Before | After |
| --- | --- |
| `Who can receive this copy?` | `Prepare copy for` |
| `Stages` | `{current level} · {current stage}` |
| Not present | `Progress: {current level}, {current stage}` |
| `Five stages` | `Progress` |
| Not present | `{current level} · {current stage}` |
| `{final level} complete. Start another {final level} cycle when you are ready.` | `{final level} complete. Your cumulative project is ready to review or export.` |
| `Start another {final level} cycle` | `Project complete` |
| `Start another {final level} cycle` | `Complete {final level}` |
| `The Teacher Console is unavailable` | `Teacher Console unavailable` |
| `Choose a new passphrase` | `Choose new passphrase` |
| `Question from the student's earlier work` | `Question from student’s earlier work` |
| `Write to the student` | `Write to student` |
| `Set up a teacher account` | `Set up teacher account` |
| Not present | `Evidence records` |
| Not present | `Direct participation` |
| Not present | `Micro settings` |
| Not present | `How settings interact` |
| Not present | `Process and time` |

## Student exports

| Before | After |
| --- | --- |
| Not present | `Evidence record {number}` |
| Not present | `Memo passage or evidence` |
| Not present | `Student interpretation` |
| Not present | `Reasoning` |
| Not present | `Uncertainty` |
| Not present | `Counterevidence` |
| Not present | `Missing perspective` |
| Not present | `explanation` |
| Not present | `focal participation` |
| Not present | `immediate settings` |
| Not present | `process` |
| Not present | `claim_evidence_json` |
| Not present | `relationship_process_json` |
| Not present | `meso_explanation` |
| Not present | `origin` |
| Not present | `review_decision` |
| Not present | `micro_setting_ids` |
| Not present | `focal_participation` |
| Not present | `memo extraction`, `model suggestion`, `student entry`, or `legacy` provenance value |
| Not present | `pending`, `added`, `set aside`, or `removed` review-decision value |
| `This file is not a supported Systems Mapping project. Expected schemaVersion 1, 2, 3, 4, 5, or {current version}.` | `This file is not a supported Systems Mapping project. Expected schemaVersion 1, 2, 3, 4, 5, 6, or {current version}.` |

## Deferred scope

Teacher Console workflow changes remain deferred by user direction. The only Teacher Console copy change is the global removal of standalone articles from headers; this ledger makes no claim that Teacher Console navigation or features were implemented or removed.

## Progression optimization pass

Copy below isolates the cross-level progression pass completed after the main ledger. Shared level metadata now supplies the same criteria to memo review, candidate choice, progress, and transition surfaces. CSS presentation changes introduce no literal copy and therefore do not appear as comparison rows.

### Shared level contract

#### Micro-level

| Before | After |
| --- | --- |
| `Which settings does the person participate in directly, and what people, roles, activities, objects, and resources are part of those settings?` | `Which settings does the focal person participate in directly, and what people, groups, roles, activities, objects, and resources are part of those settings?` |
| `Immediate settings, their elements, and direct interactions.` | `People, groups, roles, activities, objects, and immediate settings the focal person directly encounters, plus direct relationships among them.` |
| `Name each immediate setting and each relevant person, role, activity, object, or resource as a discrete map element.` | `Name each immediate setting and each relevant person, group, role, activity, object, or resource as a discrete map item.` |
| `Describe what happens between Micro elements with one direct verb.` | `Describe what happens between Micro-level items with one direct verb.` |
| Not present | `Find immediate settings in which the focal person participates. Then identify specific people, groups, roles, activities, objects, or resources present there and any direct interactions supported by the memo.` |
| Not present | `Each Micro-level item names one immediate setting, person, group, role, activity, object, or resource. Direct relationships describe supported interactions among those items.` |
| Not present | `Memo evidence` |
| Not present | `Immediate settings, their elements, and direct relationships` |
| Not present | `Place interrelations between two settings at Meso-level.` |

#### Meso-level

| Before | After |
| --- | --- |
| `Interrelations among two or more immediate settings already mapped in Micro.` | `Linkages among at least two immediate settings already mapped at Micro-level, without adding a directional relationship.` |
| `Use the exact names of settings already mapped in Micro.` | `Use the exact names of settings already mapped at Micro-level.` |
| Not present | `Find evidence that at least two Micro-level settings in which the focal person participates interact.` |
| Not present | `Each mesosystem uses at least two Micro-level settings already on the map and explains their interrelation without adding a directional relationship.` |
| Not present | `Micro-level settings` |
| Not present | `Mesosystems and explanations of how settings interact` |
| Not present | `Do not add people, institutions, services, or relationship edges at Meso-level.` |

#### Exo-level

| Before | After |
| --- | --- |
| `Which outside decision settings affect what happens in the person’s immediate settings?` | `Which outside decision settings affect what happens in the focal person’s immediate settings?` |
| `Outside decision settings and their effects on immediate settings.` | `Outside decision settings the focal person does not participate in, whose actions change what happens in a Micro-level setting.` |
| `Name the outside office, agency, funder, service system, or decision-making body.` | `Name the outside office, agency, employer, funder, service system, or decision-making body.` |
| `Keep institution-specific decisions separate from broader laws, public policies, beliefs, and structures.` | `Keep decisions owned by one setting separate from broader laws, public policies, beliefs, and structures.` |
| Not present | `Find a named outside decision setting, the Micro-level setting its action changes, and what changes for the focal person there.` |
| Not present | `Each Exo-level item names an outside decision setting and connects it to the Micro-level setting its action changes.` |
| Not present | `Micro-level settings` |
| Not present | `Outside decision settings and connections into Micro-level` |
| Not present | `If the focal person participates in a setting directly, place it at Micro-level. Place broader conditions at Macro-level.` |

#### Macro-level

| Before | After |
| --- | --- |
| `Broader conditions that affect more than one part of the map.` | `Broader laws, public policies, economic conditions, histories, and cultural beliefs that affect more than one map item.` |
| `Identify at least two map items affected by each item and the evidence supporting that claim.` | `Identify at least two map items affected by each condition and the evidence supporting that claim.` |
| Not present | `Find a broader law, public policy, economic condition, history, or cultural belief that affects at least two existing map items.` |
| Not present | `Each Macro-level item names one broader condition and identifies at least two existing map items it affects.` |
| Not present | `Map items from earlier levels` |
| Not present | `Broader conditions and affected map items` |
| Not present | `Place a named organization at Micro-level when the focal person participates there and at Exo-level when its decisions reach an immediate setting from outside.` |

Meso-level and Macro-level prompt literals retain their previous wording. No student-facing text changed in those two prompts.

### Review and choice bridges

| Before | After |
| --- | --- |
| `Check what your memo supports and what remains uncertain.` | `Find immediate settings in which the focal person participates. Then identify specific people, groups, roles, activities, objects, or resources present there and any direct interactions supported by the memo.` at Micro-level |
| `Check what your memo supports and what remains uncertain.` | `Find evidence that at least two Micro-level settings in which the focal person participates interact.` at Meso-level |
| `Check what your memo supports and what remains uncertain.` | `Find a named outside decision setting, the Micro-level setting its action changes, and what changes for the focal person there.` at Exo-level |
| `Check what your memo supports and what remains uncertain.` | `Find a broader law, public policy, economic condition, history, or cultural belief that affects at least two existing map items.` at Macro-level |
| `Each suggested Micro node should name one person, role, group, activity, object, or immediate setting. Review the label and type, then add, rename, or remove it. Only items you add join the map.` | `Each Micro-level item names one immediate setting, person, group, role, activity, object, or resource. Direct relationships describe supported interactions among those items.` |
| `Each mesosystem shows how at least two immediate settings in which the person participates relate to one another. Give it a clear name and choose the settings involved.` | `Each mesosystem uses at least two Micro-level settings already on the map and explains their interrelation without adding a directional relationship.` |
| `At Exo-level, add a named institution, agency, office, or service whose decisions reach an immediate setting even though the focal person does not participate in that decision setting. Place broader laws, economic conditions, and cultural beliefs at Macro-level.` | `Each Exo-level item names an outside decision setting and connects it to the Micro-level setting its action changes.` |
| `At Macro-level, add broader laws, public policies, economic conditions, histories, or cultural beliefs that shape at least two map items. Place named institutions at Exo-level.` | `Each Macro-level item names one broader condition and identifies at least two existing map items it affects.` |
| Not present | `Uses` |
| Not present | `Adds now` |
| Not present | `Level boundary` |
| Not present | `Work carried forward` |
| Not present | `{count} Micro-level setting remains on the map. Use at least two to form a mesosystem.` |
| Not present | `{count} Micro-level settings remain on the map. Use at least two to form a mesosystem.` |
| Not present | `{count} Micro-level setting remains available for Exo-level connections.` |
| Not present | `{count} Micro-level settings remain available for Exo-level connections.` |
| Not present | `Map retains {Micro count} Micro-level items, {Meso count} {mesosystem or mesosystems}, and {Exo count} Exo-level decision {setting or settings}.` |

### Meso-level clarification

| Before | After |
| --- | --- |
| `What passes, coordinates, or conflicts?` | `Explain how these settings interact` |
| `Describe information, resources, schedules, rules, coordination, or conflict across these settings.` | `Describe coordination or conflict supported by the memo. Do not add a directional relationship.` |

These two revisions apply in candidate suggestion review, candidate entry, and map inspection.

### Exo-level clarification

| Before | After |
| --- | --- |
| `Suggested Exo-level institutions` | `Suggested Exo-level decision settings` |
| `Name the institution first.` | `Name the outside decision setting first.` |
| `Use the full name of an institution, agency, office, or service system.` | `Use the full name of an outside office, agency, employer, funder, or service system.` |
| `That institution is already on your list or map.` | `That decision setting is already on your list or map.` |
| `Connect each Exo-level institution to the immediate setting its decision reaches. Review the wording, then add or remove each relationship.` | `Connect each outside decision setting to the Micro-level setting its action changes. State what changes for the focal person there, then add or remove the suggestion.` |
| `How institution affects Micro setting` | `How decision reaches Micro setting` |
| `The review did not suggest any Exo-level institutions. Add a named institution whose decisions reach an immediate setting already on the map.` | `The review did not suggest any Exo-level decision settings. Add a named outside setting whose decisions reach an immediate setting already on the map.` |
| `Exo-level institutions` | `Exo-level decision settings` |
| `New institution` | `New decision setting` |
| `Name an institution whose decisions or actions affect an item already on the map. Then choose how it affects a Micro setting.` | `Name an outside setting where decisions occur, then connect it to the Micro-level setting those decisions change.` |
| `Institution name` | `Decision setting name` |
| `Institution type` | `Decision setting type` |
| `Micro setting affected by the institution` | `Micro setting affected by decision setting` |
| `Add institution` | `Add decision setting` |
| `Rename this item with the full name of an institution, agency, office, or service system before returning it to the map.` | `Rename this item with the full name of an outside office, agency, employer, funder, or service system before returning it to the map.` |
| `What changed in your account of institutions that affect the focal person indirectly?` | `What changed in your account of outside decision settings that affect the focal person indirectly?` |

The revised full-name validation also appears during candidate confirmation, map editing, direct map entry, and return-from-removal recovery.

### Revise-and-export transition

| Before | After |
| --- | --- |
| `Record what changed while you worked at this level, then export the complete project.` | `Record what changed at this level before continuing. You can export the cumulative project at any point.` |
| Not present | `Next level` |
| Not present | `Meso-level will use Micro-level settings already on the map to form mesosystems.` |
| Not present | `Exo-level will add outside decision settings and connect each one to a mapped Micro-level setting.` |
| Not present | `Macro-level will use earlier map items to identify broader conditions that affect more than one item.` |
| `relationships` in Exo-level release summary | `Exo-level connections` |

### Progress modal

| Before | After |
| --- | --- |
| Not present | `Level progression` |
| Not present | `Current · Complete` |
| Not present | `Current` |
| Not present | `Complete` |
| Not present | `Available` |
| Not present | `Not started` |

### Model review contract

| Before | After |
| --- | --- |
| `guidance must be an array of no more than 4 objects` | `guidance must be an array of no more than 3 objects` |
| Corrective retry described only Micro-level node and relationship rules. | Corrective retry separately states the Micro-level, Meso-level, Exo-level, and Macro-level output boundaries before reporting the validation failure. |
| `Every relationship endpoint must exactly match an accepted node label or supplied node ID. At Micro, never return a relationship between two immediate settings; that interrelation belongs at Meso.` | `At Micro, return discrete immediate elements and direct memo-supported actions. Never return a relationship between two immediate settings; that interrelation belongs at Meso.` |
| Not present | `At Meso, return scoped mesosystems that each use at least two supplied Micro settings. Return no relationship edge.` |
| Not present | `At Exosphere, return named outside decision settings with one supported pathway into one supplied Micro setting.` |
| Not present | `At Macrosphere, return broader conditions scoped to at least two supplied map items. Return no relationship edge.` |
| `Use only a short, plain active verb phrase for a concrete, memo-supported action or exchange that matters to the mapped situation. Omit mere co-presence, co-residence, vague collaboration, and generic planning unless the memo makes the tie analytically consequential and names what passes between the endpoints.` | `Every relationship endpoint must exactly match an accepted node label or supplied node ID. Use only a short, plain active verb phrase for a concrete, supported action or exchange.` |
| `carriedNodes must contain no more than 50 items.` | `carriedNodes must contain no more than {project node limit} items.` |
| `carriedConnections must contain no more than 100 items.` | `carriedConnections must contain no more than {project connection limit} items.` |

The review contract now enforces the same selectivity stated in its own prompt: at most three guidance items, six Exo-level decision settings with five pathways, and six Macro-level conditions. No other server-prompt literal changed in this pass.

## Map accessibility pass

No sighted interface label changed in this pass. The revisions below are complete changes to accessible names and live announcements used by screen-reader and keyboard users.

| Before | After |
| --- | --- |
| `Choose a node for details.` | `Choose a node or connection for details.` |
| `{source} {verb} {target}, {level} relationship` in a connection's accessible name | `{source} {verb} {target}, {level} connection` in a connection's accessible name |
| `Arrow keys pan the map when the canvas itself is focused.` | `Arrow keys pan the map when the canvas itself is focused. Press Escape to leave Pan mode.` |
| Not present | `Pan mode on. Use arrow keys to move the map. Press Escape when finished.` |
| Not present | `Pan mode off.` |
| Not present | `Map zoom {percent} percent.` |
| Not present | `Map fitted to view.` |
| Not present | `Map centered in view.` |
| Not present | `{level} arranged.` |
| Not present | `All layers arranged.` |
| Not present | `{level} shown.` |
| Not present | `All layers shown.` |
| Not present | `Full map shown.` |
| `Full screen map opened.` | `Full screen map opened. Press Escape to exit.` |
| Not present | `Map key opened.` |
| Not present | `Map key closed.` |

Repeated announcements now receive a new live-region revision so the same action can be announced more than once. This is a delivery change, not additional copy.

## Map navigation and control pass

This pass changes both sighted labels and assistive instructions. It removes the separate Pan mode, makes map navigation available directly from the canvas, and separates display, navigation, and map-changing actions.

### Complete visible-label comparison

| Surface | Before | After |
| --- | --- | --- |
| Map heading | `Build map` | `Systems map` |
| Pan control | `Pan` | Not present. Dragging the map pans without enabling a mode. |
| Non-dragging pan control | Not present | `Move`, opening four controls with the accessible names `Move map up`, `Move map left`, `Move map right`, and `Move map down`. |
| Ecology-map fit control | `Center map` | `Fit map` on desktop; `Fit` on phone, with the accessible name `Fit map` retained. |
| Network-map fit control | `Fit map` | `Fit map` on desktop; `Fit` on phone, with the accessible name `Fit map` retained. |
| Arrange control | `Arrange map` at every viewport | `Arrange map` on desktop; `Arrange` on phone, with the accessible name `Arrange map` retained. |
| Full-screen entry control | `Full screen map` | `Full screen`, with the accessible name `Full screen map` retained. |
| Full-screen exit control | `Exit full screen` | `Exit full screen` |
| Zoom-out control | `−`, accessible name `Zoom out` | `−`, accessible name `Zoom out` |
| Zoom-in control | `+`, accessible name `Zoom in` | `+`, accessible name `Zoom in` |
| Layer selector in phone full screen | Visible label `Show layer`; accessible name `Show map layer` | The visible label is omitted from the compact full-screen header; the select retains the accessible name `Show map layer`. |

`Map key` remains visible and keeps the accessible name `Map key`. `Details` remains available on phone and keeps the accessible name `Details`; it is no longer part of desktop canvas chrome. In full screen, the Canvas/List presentation switch is omitted because full screen is a canvas view.

### Complete control-order comparison

**Before**

`Pan · Zoom out · Zoom in · Arrange map · Center map or Fit map · Map key · Full screen map or Exit full screen · Details`

All controls appeared in one toolbar despite performing different kinds of work.

**After**

- Map display: `Map key · Full screen or Exit full screen`
- Map navigation: `Zoom out · Zoom in · Fit map · Move`
- Map actions: `Arrange map`, plus `Details` on phone

The compact visible phone sequence is `− · + · Fit · Move` and `Arrange · Details`. These shortened labels do not shorten the controls' accessible names. When a node is open in Details, `Position on map` provides four arrow controls so exact placement does not require dragging.

### Complete canvas-instruction comparison

**Before, with Pan mode off**

`{map label}. {graph summary}. Choose a node or connection for details. Arrow keys move a focused node by 8 pixels; Shift plus an arrow moves it by 24.`

**Before, with Pan mode on**

`{map label}. {graph summary}. Choose a node or connection for details. Arrow keys move a focused node by 8 pixels; Shift plus an arrow moves it by 24. Arrow keys pan the map when the canvas itself is focused. Press Escape to leave Pan mode.`

**After**

`{map label}. {graph summary}. Choose a node or connection for details. Drag the map or use arrow keys to pan. Use the mouse wheel or pinch to zoom. Arrow keys move a focused node by 8 pixels; Shift plus an arrow moves it by 24.`

The final sentence remains omitted in temporary detail views where node movement is unavailable.

### Live-announcement comparison

| Before | After |
| --- | --- |
| `Pan mode on. Use arrow keys to move the map. Press Escape when finished.` | Not present |
| `Pan mode off.` | Not present |
| Not present | `Map moved.` after a completed direct drag |
| `Map panned {direction}.` only while Pan mode was active | `Map panned {direction}.` whenever the focused canvas is moved with an arrow key |
| `Map centered in view.` for an ecology map | `Map fitted to view.` for every map |
| `Map zoom {percent} percent.` after a zoom button | `Map zoom {percent} percent.` after a zoom button, mouse-wheel zoom, or pinch zoom |

### Direct diff

```diff
- <h1>Build map</h1>
+ <h1>Systems map</h1>

- Pan · − · + · Arrange map · Center map/Fit map · Map key · Full screen map · Details
+ Map display: Map key · Full screen
+ Map navigation: − · + · Fit map · Move
+ Map actions: Arrange map · Details on phone

- Arrow keys pan the map when the canvas itself is focused. Press Escape to leave Pan mode.
+ Drag the map or use arrow keys to pan. Use the mouse wheel or pinch to zoom.

- Pan mode on. Use arrow keys to move the map. Press Escape when finished.
- Pan mode off.
+ Map moved.

- Map centered in view.
+ Map fitted to view.
```

The fit action now describes its actual contract: fit visible node cards, connection wording, and relationship fields inside the viewport. A ring contour may extend beyond the viewport when no mapped content occupies that portion of the ring; a node or connection label may not be cut off. Phone overviews use a portrait-scaled version of the same concentric levels so labels remain legible without reclassifying any map item.
