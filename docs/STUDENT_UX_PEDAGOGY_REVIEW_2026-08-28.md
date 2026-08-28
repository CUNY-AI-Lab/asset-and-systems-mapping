# Student UX and pedagogy review

Updated: 2026-08-28

## Finding

The student workflow had been asking the model to sort memo language into rings before the student had established whose experience organized the map, what question the map should answer, or where its boundary lay. That architecture made classification unstable, weakened student authorship, and encouraged entity-type shortcuts: an institution could be pushed outward simply because it was an institution. The revised workflow treats a map as a bounded, revisable claim about one focal person or group. Placement now depends on participation and the pathway of effect.

This is an application of ecological systems mapping, not a complete implementation of the later bioecological model. Bronfenbrenner and Morris describe a Process-Person-Context-Time model in which proximal processes, not concentric categories alone, are central. The application therefore collects focal person, question, time, and boundary at intake and returns to process and change in revision and synthesis. It does not add a fifth ring. [Bronfenbrenner and Morris, 2007](https://doi.org/10.1002/9780470147658.chpsy0114)

## Theoretical alignment

- **Relational placement.** A Micro-level setting contains the focal person as a participant. Meso-level names an interrelation among at least two such settings. Exo-level traces a decision from a setting in which the focal person does not participate into an immediate setting. Macro-level names a broader cultural, legal, political, historical, or economic condition. Entity kind does not decide placement.
- **Bounded models.** A system model must make its boundary and assumptions visible. The intake fields and final limitations prompt now make those choices explicit. The map key also states that a level shows contextual position, not causal strength. [NGSS Appendix G](https://www.nextgenscience.org/sites/ngss/files/Appendix%20G%20-%20Crosscutting%20Concepts%20FINAL.edited.pdf)
- **Student construction.** Model output is optional guidance. Every suggestion starts off the map, keeps model provenance, and requires an explicit student decision. The student may continue without a model, edit a suggestion, add work manually, mark it as needing evidence, or remove it.
- **Human-centred AI.** Before a hosted request, the interface names the provider and transfer. No request occurs automatically. This keeps model use subordinate to the learning task and follows UNESCO's emphasis on human agency, privacy, ethical validation, and pedagogical design. [UNESCO guidance for generative AI in education and research](https://www.unesco.org/en/articles/guidance-generative-ai-education-and-research)
- **Revisability.** Editing the memo marks model guidance as stale without deleting the graph, decisions, evidence, annotations, or history. Starting again creates a separate recoverable project instead of overwriting the previous map.

## Workflow review

| Student question | Required experience | Current implementation |
| --- | --- | --- |
| What am I mapping? | Name the focal person or group, focus question, time period, and boundary before classification. | Intake and persistent memo context. |
| Does the model decide what belongs? | No. Generation is optional; every suggestion remains off-map until the student acts. | Generate guidance and Continue without model are separate paths; Add to map is explicit. |
| Why is this institution here? | Placement follows participation, not organization type. | A clinic or college can be Micro-level when the focal person participates there; an outside office can be Exo-level when its decision reaches that setting. |
| What happens at Meso-level? | Form a mesosystem from at least two existing Micro-level settings. | Meso-level carries stable Micro-level setting IDs, uses a conventional noun label, and creates no directional relationship. |
| What is the Exo/Macro boundary? | Exo-level identifies a concrete outside decision setting and a supported pathway; Macro-level identifies a broader condition affecting several mapped elements. | Separate validators, model contracts, editors, regions, and filters. Named institutions cannot be duplicated as Macro-level conditions. |
| Does later work replace earlier work? | No. The map grows cumulatively and the student can return to any released work level. | Work at level is independent of Show layer; later levels carry earlier nodes and relationships. |
| Can I understand a dense map? | Labels remain complete; fit, zoom, pan, full screen, filtering, and a non-spatial view remain available. | Readable zoom floors, collision-aware labels, durable viewport, reversible full screen, and synchronized Canvas/List views. |
| What happens when something fails? | Preserve work and explain the recovery step in plain language. | Persistent save diagnostics, recovery export, and explicit project-link conflict choices. |
| Where is my work stored? | Distinguish device storage from an optional server link. | Shared-browser warning, full link disclosure, revision and sync metadata, expiry, conflict handling, revoke, and delete. |

## Highest-value improvements now implemented

1. Frame the unit of analysis before model review.
2. Classify by participation and supported pathway rather than entity type.
3. Keep model suggestions pending and preserve their origin until the student accepts them.
4. Preserve mapped work when a memo changes and create a separate project when starting again.
5. Separate work level from visible layer and carry the graph through Micro-level, Meso-level, Exo-level, and Macro-level.
6. Keep direct relationships at Micro-level, mesosystems at Meso-level, outside decision pathways at Exo-level, and scoped broader conditions at Macro-level.
7. Add level-specific revision prompts and a final cross-level synthesis covering the focus question, evidence, contradictions, missing perspectives, limits, and next inquiry.
8. Make dense maps navigable and supply a synchronized accessible list view.
9. Clarify device-only persistence and make shared project links conflict-safe and revocable.
10. Remove student-facing Teacher Console navigation and instructor-review promises from the current journey.

## Next pedagogical priorities

- Expand evidence records from one visible passage to an additive claim file: source passage, student interpretation, warrant, uncertainty, counterevidence, and missing voice.
- Add a compact process editor for frequency, duration, direction, conditions, and change over time on important Micro-level relationships and Exo-level decision pathways.
- Evaluate the workflow with students using task completion, classification explanations, revision quality, and recovery from errors rather than map size or model acceptance rate.

## Acceptance standard

The review is complete only when the implementation ledger, automated suite, production build, live deployment, real-browser walkthrough, and literal screenshot archive agree. Generated illustrations or reconstructed screens do not count as acceptance evidence.
