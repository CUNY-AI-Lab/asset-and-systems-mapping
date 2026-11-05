# Classification evidence and regression gates

## Research basis

Bronfenbrenner, *Ecological Models of Human Development* (1994), sections 3.1–3.5, distinguishes settings by the focal person's participation and the processes linking settings, not an organization's name. [Primary text hosted by Columbia University](https://www.columbia.edu/cu/psychology/courses/3615/Readings/BronfenbrennerModelofDevelopment%28short%20version%29.pdf).

Bronfenbrenner, *The Ecology of Human Development* (1979), chapter 10, requires an explanatory chain from events in an external setting to processes in an immediate setting, then to the focal person's development. [Chapter DOI](https://doi.org/10.2307/j.ctv26071r6.14). The chapter's indexed excerpt was readable; the full JSTOR chapter was not accessible during this audit.

The app adapts this developmental framework to asset mapping with focal people/groups and nodes. A graph node is a teaching representation; the theory's systems are settings and processes, not fixed lists of institution types.

## What the housing-office example must establish

| Evidence in the memo | Appropriate treatment |
| --- | --- |
| Residents meet housing-office staff weekly to discuss their own repairs | That interaction/setting belongs in their Micro map. The word “office” does not establish Exo. |
| A regional allocation board, in whose decisions residents do not participate, assigns contractors; its decisions delay repairs in residents' buildings | The external decision setting can be Exo. Show the indirect path into the local setting. |
| An office is mentioned with no account of participation or influence | Insufficient evidence for an automatic Exo classification. Withhold it; preserve the memo for manual interpretation. |
| A broad housing-finance rule distributes repair eligibility across many settings | Potential Macro condition, supported by its rule and local implications; the administrative office is not itself that condition. |
| A resident also serves on the allocation board | Reconsider classification relative to that person's participation. Do not assume the same classification for every focal person. |
| A historical policy change alters access over time | Represent the supported broader condition and temporal explanation; historical age alone does not make an item Macro. |

These are application examples inferred from the primary definitions, not quotations from those sources.

## Model acceptance requirements

- Identify the focal people/group from source/context before classifying the institution.
- Exo requires evidence of an external decision setting plus an indirect effect on a named local setting/process. A proper noun, institution type, physical distance or word such as “office” is not sufficient.
- Direct participation evidence must not be relabeled as indirect participation. Contradictory or missing evidence must produce no automatic placement for that item.
- Macro requires a supported broader rule, value, distributional structure or historical/sociological condition. Distinguish that condition from the organization administering it.
- Show a short source-grounded classification explanation. Evidence must match actual memo text; unsupported IDs, fabricated excerpts, participant roles mislabeled as external institutions and automatically generated relationships are rejected.
- Preserve manual reclassification. A new model call never silently migrates an existing map.
- Test minimal pairs using identical institution names with different participation contexts, plus ambiguity, negation, mixed participation, broad policy versus its administering office, and changed memo evidence.
- Run the same bounded pairs against the deployed Dev model. Record every failure and retry. A finite passing suite is evidence for those cases, not a guarantee that every future model interpretation is correct.

## Final regression audit

Audit the integrated build independently before production promotion: saved project/schema compatibility, two independent drafts and successful baselines, unchanged and one-word memo edits, failure/cancellation/stale responses, manual changes/removals, Undo/Redo/reload, color and export parity, both direct-connection targets, source deletion, canvas-first navigation, memo-only Continue gating, keyboard/touch behavior and narrow-screen layouts. Inspect rendered screenshots as well as test results.
