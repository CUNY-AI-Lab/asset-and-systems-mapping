# Student copy before and after

Updated: 2026-08-28

Baseline: `b3d855c0ad95d718b19ad198fbbbe9a3b19ef57e`

This ledger records the student-facing copy revision. The source commit remains the complete line-by-line comparison; this file keeps the consequential passages readable without reproducing implementation-only strings.

| Surface | Before | After |
| --- | --- | --- |
| Level titles | `Micro`; `Meso`; `Exosphere`; `Macrosphere` | `Micro-level`; `Meso-level`; `Exo-level`; `Macro-level` |
| Intake purpose | “Add a memo to begin with Micro. The map then advances to Meso, Exosphere, and Macrosphere.” | “Frame whose experience you are mapping, what you want to understand, and where this map stops. You can revise any field without losing the map.” |
| Unit of analysis | No focal-person, question, time, or boundary prompts. | `Focal person or group`; `Map question`; `Time period or episode`; `Map boundary`, each with a direct explanation. |
| Memo length | “Aim for 500–600 words.” | The live word count only. No arbitrary target. |
| Memo revision | “Changing the memo clears the current map and restarts at Micro.” | “Editing marks generated guidance as ready to refresh. Your map, decisions, and history remain.” |
| New map | No separate action from a mapped memo. | “Start a new map from this memo,” followed by a confirmation that the current project stays in Projects. |
| Model disclosure | “Generate guidance when you are ready to review the memo.” | The interface names the configured provider and model, says whether memo and framing leave the classroom server, and gives the retention period. |
| Manual route | Model generation was the only visible forward action before guidance existed. | `Generate guidance` and `Continue without model` are separate, equal actions. |
| Suggestion status | “Suggestions begin on Keep unless your teacher requires confirmation.” | “Model suggestions stay off the map until you choose Add to map. Editing a suggestion does not add it.” |
| Suggestion decisions | `Keep`; `Needs more evidence`; `Remove` | `Add to map`; `Needs more evidence`; `Remove` |
| Meso-level | “Name the connection between at least two Micro settings without writing a full sentence.” | “Give the mesosystem a short, conventional name, then select at least two Micro-level settings. Do not add a directional relationship.” |
| Exo-level | “Institutions and decision-making bodies that affect mapped elements.” | “Outside decision settings the focal person does not participate in, whose actions change what happens in a Micro-level setting.” |
| Exo pathway | Generic connection and relationship language. | `Decision pathway` identifies how a concrete outside decision reaches an immediate setting. |
| Macro-level | `Macrosphere items` and `structures` mixed across the workflow. | `Macro-level conditions` for laws, public policies, economic conditions, histories, cultural beliefs, and structures affecting at least two mapped elements. |
| Macro evidence gap | “Name the laws, policies, prices, or beliefs at work yourself — the memo does not need to name them.” | “No broader condition with enough evidence was found. Revise the memo, or add a condition yourself and mark it as needing more evidence.” |
| Manual Macro evidence | The manual Macro form had no evidence field, so a class that required evidence could not confirm the condition. | `Evidence or question` appears in the add form and every review row. If evidence is required, the form says: “Add evidence or a question for this Macro-level condition.” |
| Map key | Level names only. | Level names plus: “A level shows an element’s position relative to the focal person. It does not measure causal strength.” |
| Progression | Work level and visible layer could read as the same control. | `Work at level` changes the current analytical task; `Show layer` filters the cumulative map without changing work. |
| Storage | No shared-browser warning on the project list. | “These projects are saved in this browser. Anyone using the same browser profile may be able to open them.” |
| Project link | Link creation did not fully explain server content, sync state, conflict handling, expiry, revocation, or deletion. | The dialog names stored content, bearer-link access, last sync, expiry, conflict choices, `Revoke link`, and `Delete server copy`. |
| Save failure | Internal schema text could appear in the header or transient toast. | `Save needs attention` persists until resolved; the dialog gives a recovery step and puts technical detail behind a disclosure. |
| Instructor review | Default course prose could imply that current student work would be reviewed in Teacher Console. | No instructor-review promise or student submission field appears in the current student journey. |

## Retired language check

The student interface contains none of the following retired category or explanatory language:

- `Keep` as a suggestion category;
- `Stuck`;
- `Has Energy`;
- `Ripples Outward`;
- `pattern with no door`;
- a ring that “holds” people or things;
- `relationship verbs` as a student-facing label.

Those terms may remain only in tests or validation patterns that prevent them from returning to the interface.

## Direct comparison

The full durable comparison is the Git diff from the baseline above to the checked-out delivery tree. It can be reproduced with:

```sh
git diff b3d855c0ad95d718b19ad198fbbbe9a3b19ef57e...HEAD -- src/App.jsx src/domain.js shared/systems-mapping-parts.js shared/systems-mapping-stages.js server/config.js src/TeacherDashboard.jsx
```
