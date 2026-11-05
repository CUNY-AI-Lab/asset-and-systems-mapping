# Teacher control across Systems Mapping and STEM Splitter

Systems Mapping and STEM Splitter ask teachers to control different classroom actions. They can still share one small configuration contract.

## Current differences

| | Systems Mapping | STEM Splitter |
| --- | --- | --- |
| Student work | Memos, evidence, inquiry, nodes, relationships, ecological spheres, and graph annotations | Audio stems, mixer actions, class labels, and timestamped notes |
| Instructor role | Review a memo and write one focus without controlling map access | Set repertoire and vocabulary emphasis while students listen and describe what they hear |
| Student handoff | Independent memos add or update bounded nodes; Notebook supports student-authored relationships and optional notes while the canvas stays visible | The Listening Guide returns one listening move or question at a time |
| Current control | One published version with guidance and course material for each Part and section | One versioned class amendment appended beneath a code-owned prompt |
| Runtime effect | Account Gateway receives only applicable course context under the node-only contract; legacy Node deterministic/Ollama modes remain separate | The active amendment changes the Listening Guide prompt |
| Fixed boundary | Evaluation schema, privacy rules, evidence grounding, and graph operations | No invented timestamps, student data as data, supported mixer tools, and short turn-taking |

Systems Mapping lets the instructor redirect attention to evidence while students own the map's relationships and interpretations. Part 1 groups Micro and Meso; Part 2 groups Exo and Macro. The account model identifies local nodes in the first memo and outside settings/broader conditions in the second; it never proposes relationships. Meso relationships link the retained local nodes. Exo classification requires an outside participation setting and an indirect path; Macro distinguishes a broader condition from the organization administering it. Published material cannot make notes or relationships progression requirements, overwrite manual edits or bypass evidence validation. STEM Splitter tunes a listening conversation while students name and describe what they hear. A shared console must preserve that difference.

## Shared application contract

The reusable contract registers an application, its progression, its runtime, the fields an instructor may edit, and the rules that remain fixed. Applications do not need identical stages. They need the same way to declare what teachers may change and when those changes enter a model request.

Systems Mapping assigns two fields to each Part-and-section pair. The values are shared by the levels within that Part rather than stored once per level.

- **What guidance should students receive in this section?** lets the instructor set the pedagogical direction for that part of the activity.
- **What course material should support this section?** lets the instructor paste a relevant excerpt or reference text. The application marks this material as reference content rather than instructions that can override fixed rules.

At runtime, Systems Mapping includes only the active Part-and-section guidance and course material. Prose from another section stays out of that request. The Instructor Console keeps this manageable with compact Part and Section controls. Its separate **Preview level** selector supplies level context for a preview only; it never selects or creates another saved setting. STEM Splitter can register its listening sequence and reuse the same two fields when its current console is migrated. Its present four-part amendment remains the compatibility boundary until then.

## Draft, preview, and publish

Each application can use the same sequence.

1. Clone the published settings or an earlier version.
2. Change the guidance or course material for one or more stages.
3. Save the draft with a note.
4. Preview the saved guidance and course material for a named Part and section, with a level selected only as runtime context.
5. Publish it for new runs.

The saved preview contains only instructor guidance and course material plus the Part, section, contextual level, and revision. It never returns or displays the full effective prompt, code-owned guardrails, internal modules, or configuration fingerprints.

Publishing retires the previous version without erasing it. A teacher can clone and publish an earlier version to restore it. Existing student work retains the version, section, level, and internal provenance that governed its run. Legacy Macro and Integration settings migrate to Exosphere and Macrosphere.

## Application boundaries

The shared layer owns validation, stable identifiers, draft revisions, publication, retirement, history, runtime disclosures, and configuration fingerprints. Each application keeps its own student workflow, instructor decisions, domain records, fixed prompt, output schema, and activity-specific preview.

Systems Mapping uses this split in the Instructor Console. The portable contract lives in `shared/educator-resource-contract.js`. Its STEM Splitter adapter registers four sections and composes them into STEM Splitter's existing versioned amendment format. That adapter does not replace STEM Splitter's present console or persistence yet. It fixes the boundary for a later migration without adding another configuration matrix.

Instructor review and evaluation capacity remain separate from progression. No instructor review or outstanding legacy evaluation may block account editing or navigation. Continue requires only the current part’s successful memo submission, including an empty result; this is not an instructor approval or required-note gate. This pass removes only the course-wide active-evaluation ceiling; per-session supersession and retention purges remain unchanged.

Future applications should register only controls that a teacher can interpret, test, and reverse. Internal prompt fragments may remain modular in code, but they do not become instructor tasks by default.
