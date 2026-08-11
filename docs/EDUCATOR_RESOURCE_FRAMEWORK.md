# Teacher control across Systems Mapping and STEM Splitter

Systems Mapping and STEM Splitter ask teachers to control different classroom actions. They can still share one small configuration contract.

## Current differences

| | Systems Mapping | STEM Splitter |
| --- | --- | --- |
| Student work | Source-backed memo, inquiry, concepts, relationships, and graph annotations | Audio stems, mixer actions, class labels, and timestamped notes |
| Instructor role | Review the source work, write one focus, decide whether mapping can begin | Set repertoire and vocabulary emphasis while students listen and describe what they hear |
| Student handoff | Instructor approval opens candidate selection | The Listening Guide returns one listening move or question at a time |
| Current control | One published version with guidance and course material for each of seven stages | One versioned class amendment appended beneath a code-owned prompt |
| Runtime effect | Deterministic rules record the version and stage as provenance; Ollama receives the relevant stages in order | The active amendment changes the Listening Guide prompt |
| Fixed boundary | Evaluation schema, privacy rules, evidence grounding, and graph operations | No invented timestamps, student data as data, supported mixer tools, and short turn-taking |

Systems Mapping places the instructor between source review and graph building because the student remains responsible for the map. STEM Splitter lets the instructor tune a listening conversation because the student remains responsible for naming and describing what they hear. A shared console should preserve that difference instead of forcing one application's workflow onto the other.

## Shared application contract

The reusable contract registers an application, its progression, its runtime, the fields an instructor may edit, and the rules that remain fixed. Applications do not need identical stages. They need the same way to declare what teachers may change and when those changes enter a model request.

Systems Mapping now assigns two fields to each stage.

- **How should the model guide this stage?** lets the instructor set the pedagogical direction for that part of the activity.
- **What course material should the model draw on?** lets the instructor paste a relevant excerpt or reference text. The application marks this material as reference content rather than instructions that can override fixed rules.

At runtime, Systems Mapping includes the current stage and the stages already completed. It excludes later-stage guidance, which prevents an endpoint from pulling later conclusions into earlier student work. STEM Splitter can register its listening sequence and reuse the same two fields when its current console is migrated. Its present four-part amendment remains the compatibility boundary until then.

## Draft, preview, and publish

Each application can use the same sequence.

1. Clone the published settings or an earlier version.
2. Change the guidance or course material for one or more stages.
3. Save the draft with a note.
4. Preview the saved prompt for a named stage and activity state.
5. Publish it for new runs.

Publishing retires the previous version without erasing it. A teacher can clone and publish an earlier version to restore it. Existing student work retains the version, stage, and fingerprint that governed its run.

## Application boundaries

The shared layer owns validation, stable identifiers, draft revisions, publication, retirement, history, runtime disclosures, and configuration fingerprints. Each application keeps its own student workflow, instructor decisions, domain records, fixed prompt, output schema, and activity-specific preview.

Systems Mapping now uses this split in the Teacher Console. The portable contract lives in `shared/educator-resource-contract.js`. Its STEM Splitter adapter registers four sections and composes them into STEM Splitter's existing versioned amendment format. That adapter does not replace STEM Splitter's present console or persistence yet. It fixes the boundary for a later migration without adding another configuration matrix.

Future applications should register only controls that a teacher can interpret, test, and reverse. Internal prompt fragments may remain modular in code, but they do not become instructor tasks by default.
