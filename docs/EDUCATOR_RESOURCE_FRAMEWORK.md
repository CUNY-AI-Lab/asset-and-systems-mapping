# Teacher control across Systems Mapping and STEM Splitter

Systems Mapping and STEM Splitter ask teachers to control different classroom actions. They can still share one small configuration contract.

## Current differences

| | Systems Mapping | STEM Splitter |
| --- | --- | --- |
| Student work | Sources, inquiry, interpretation, concepts, relationships, and graph annotations | Audio stems, mixer actions, class labels, and timestamped notes |
| Instructor role | Review source use and write one focus without controlling map access | Set repertoire and vocabulary emphasis while students listen and describe what they hear |
| Student handoff | Guidance can be revisited while the map remains available | The Listening Guide returns one listening move or question at a time |
| Current control | One published version with guidance and course material for each of five repeatable stages | One versioned class amendment appended beneath a code-owned prompt |
| Runtime effect | Deterministic rules record the version and section as provenance; Ollama receives only the current section | The active amendment changes the Listening Guide prompt |
| Fixed boundary | Evaluation schema, privacy rules, evidence grounding, and graph operations | No invented timestamps, student data as data, supported mixer tools, and short turn-taking |

Systems Mapping lets the instructor redirect attention to evidence while the student remains responsible for the map and may continue working at any stage. Part 1 groups Micro and Meso; Part 2 groups Macro and Integration. STEM Splitter lets the instructor tune a listening conversation while the student remains responsible for naming and describing what they hear. A shared console should preserve that difference instead of forcing one application's workflow onto the other.

## Shared application contract

The reusable contract registers an application, its progression, its runtime, the fields an instructor may edit, and the rules that remain fixed. Applications do not need identical stages. They need the same way to declare what teachers may change and when those changes enter a model request.

Systems Mapping assigns two fields to each stage.

- **What guidance should students receive in this section?** lets the instructor set the pedagogical direction for that part of the activity.
- **What course material should support this section?** lets the instructor paste a relevant excerpt or reference text. The application marks this material as reference content rather than instructions that can override fixed rules.

At runtime, Systems Mapping includes only the current stage's guidance and course material. Earlier and later stage prose stays out of that request. This limits prompt growth over a semester and lets one stage be revised without changing the others. STEM Splitter can register its listening sequence and reuse the same two fields when its current console is migrated. Its present four-part amendment remains the compatibility boundary until then.

## Draft, preview, and publish

Each application can use the same sequence.

1. Clone the published settings or an earlier version.
2. Change the guidance or course material for one or more stages.
3. Save the draft with a note.
4. Preview the saved prompt for a named stage and activity state.
5. Publish it for new runs.

Publishing retires the previous version without erasing it. A teacher can clone and publish an earlier version to restore it. Existing student work retains the version, stage, scale, and fingerprint that governed its run.

## Application boundaries

The shared layer owns validation, stable identifiers, draft revisions, publication, retirement, history, runtime disclosures, and configuration fingerprints. Each application keeps its own student workflow, instructor decisions, domain records, fixed prompt, output schema, and activity-specific preview.

Systems Mapping now uses this split in the Teacher Console. The portable contract lives in `shared/educator-resource-contract.js`. Its STEM Splitter adapter registers four sections and composes them into STEM Splitter's existing versioned amendment format. That adapter does not replace STEM Splitter's present console or persistence yet. It fixes the boundary for a later migration without adding another configuration matrix.

Future applications should register only controls that a teacher can interpret, test, and reverse. Internal prompt fragments may remain modular in code, but they do not become instructor tasks by default.
