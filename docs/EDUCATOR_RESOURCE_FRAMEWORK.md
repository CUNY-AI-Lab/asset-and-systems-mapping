# Teacher control across Systems Mapping and STEM Splitter

Systems Mapping and STEM Splitter ask teachers to control different classroom actions. They can still share one small configuration contract.

## Current differences

| | Systems Mapping | STEM Splitter |
| --- | --- | --- |
| Student work | Source-backed memo, inquiry, concepts, relationships, and graph annotations | Audio stems, mixer actions, class labels, and timestamped notes |
| Instructor role | Review the source work, write one focus, decide whether mapping can begin | Set repertoire and vocabulary emphasis while students listen and describe what they hear |
| Student handoff | Instructor approval opens candidate selection | The Listening Guide returns one listening move or question at a time |
| Current control | One published course profile with five sections and versioned trials | One versioned class amendment appended beneath a code-owned prompt |
| Runtime effect | Deterministic rules record the profile as provenance; Ollama applies it | The active amendment changes the Listening Guide prompt |
| Fixed boundary | Evaluation schema, privacy rules, evidence grounding, and graph operations | No invented timestamps, student data as data, supported mixer tools, and short turn-taking |

Systems Mapping places the instructor between source review and graph building because the student remains responsible for the map. STEM Splitter lets the instructor tune a listening conversation because the student remains responsible for naming and describing what they hear. A shared console should preserve that difference instead of forcing one application's workflow onto the other.

## Shared course settings

The reusable contract registers an application, its runtime, its editable sections, and its fixed rules. Four sections work across both applications.

- **Focus** names what students should attend to.
- **Evidence** names which materials or observations may support guidance.
- **Questions** constrains how the application returns the next move to the student.
- **Privacy** governs student-authored and identifying material.

Systems Mapping adds one optional **Scale adjustments** section. STEM Splitter omits it because micro, meso, macro, and integration do not describe its listening activity. Optional context fields belong inside the same profile and do not create more teacher stages.

## One trial at a time

Each application can use the same sequence.

1. Clone the published settings or an earlier version.
2. Change a small number of named sections.
3. Save the draft with a note.
4. Preview the saved revision against one representative activity state.
5. Publish it for new runs.

Publishing retires the previous version without erasing it. A teacher can clone an earlier version and publish that clone when a trial should be reversed. Existing student work retains the version and fingerprint that governed its run.

## Application boundaries

The shared layer owns validation, stable identifiers, draft revisions, publication, retirement, history, runtime disclosures, and configuration fingerprints. Each application keeps its own student workflow, instructor decisions, domain records, fixed prompt, output schema, and activity-specific preview.

Systems Mapping now uses this split in the Teacher Console. The portable contract lives in `shared/educator-resource-contract.js`. Its STEM Splitter adapter registers four sections and composes them into STEM Splitter's existing versioned amendment format. That adapter does not replace STEM Splitter's present console or persistence yet. It fixes the boundary for a later migration without adding another configuration matrix.

Future applications should register only controls that a teacher can interpret, test, and reverse. Internal prompt fragments may remain modular in code, but they do not become instructor tasks by default.
