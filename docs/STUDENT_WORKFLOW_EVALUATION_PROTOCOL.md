# Student workflow evaluation protocol

Status: implementation-ready protocol
Instrument: `systems-mapping.student-workflow-evaluation.v1`
Updated: 2026-11-04 (task wording; instrument IDs and category allowlists unchanged)

## Purpose

This protocol evaluates whether students can complete the Systems Mapping workflow and explain, revise, and recover their work. It does not evaluate success by counting nodes or connections, and it does not treat agreement with model suggestions as a learning outcome.

The application records one bounded observation event, `workflow_observed`. Each event contains five closed categories. It cannot contain memo text, node or relationship labels, annotations, names, project identifiers, teacher comments, or any other free text. The downloadable teacher report contains aggregate counts only.

## Research boundary

- Use the mechanism only under the institution's applicable consent, course-research, and accessibility procedures.
- Tell participants what is observed, how long bounded events are retained, and that declining participation must not affect course standing.
- Do not paste observations into notes or add identifying details to the event request.
- Do not combine the aggregate report with attendance, grades, account rosters, project links, or browser-storage exports.
- Use participant codes in any separately approved research record. Keep the code key outside this application.
- Stop collection and discard the session if a participant reveals sensitive information while explaining a choice. Record only a rubric category after the disclosure has passed.
- Interpret `not_observed` and `not_applicable` as missing or structurally inapplicable evidence, not as failure.

## Study tasks

Use a generic, fabricated case with enough evidence to support all four levels. Do not ask participants to enter personal experience or real client information.

| Task code | Student task | Completion evidence |
| --- | --- | --- |
| `frame_inquiry` | State the focal person/group and map boundary from the supplied memo. | Student can explain what the map includes and excludes without additional required project-detail fields. |
| `classify_micro` | Place a directly participated person, group, setting, activity, object, institution, or service at Micro-level. | Student explains placement through participation rather than entity type. |
| `build_meso_interrelation` | Draw and name a supported directional relationship between existing local nodes. | Student explains the relationship and direction while retaining the existing Micro node identities. |
| `trace_exo_pathway` | Identify an outside setting in which focal people do not directly participate, and connect its effect to a local relationship. | Student traces an evidenced indirect pathway rather than classifying by an organization name alone. |
| `scope_macro_condition` | Apply a broader cultural, legal, political, historical, or economic condition to mapped elements. | Student distinguishes a condition from a named institution and explains its scope. |
| `revise_map` | Reconsider one placement, relationship, evidence claim, or limitation. | Revision changes the model's reasoning, evidence, scope, or classification when warranted. |
| `recover_from_error` | Recover from a provided save, import, stale-link, or invalid-map error. | Student preserves work and reaches a usable state using the offered recovery path. |
| `export_map` | Review and export the cumulative map. | Student produces an export and can identify one limitation or missing perspective. |

Use a prepared project with successful memo processing when testing manual tasks without a live provider. If observing memo submission/update, record that as the workflow action rather than treating model agreement or node count as success. Continue requires the current part’s successful submission, not relationships or optional notes. Do not record whether the student accepted or rejected a suggestion. The stable task codes remain unchanged for aggregate compatibility.

## Observation rubric

Record every field for every observed task. Use `not_applicable` or `not_observed` instead of guessing.

### Task completion

| Category | Coding rule |
| --- | --- |
| `completed_independently` | Student reaches the stated completion evidence without procedural help. Clarifying the task prompt does not count as help. |
| `completed_with_help` | Student reaches the stated completion evidence after a hint, demonstration, or recovery instruction. |
| `incomplete` | Student does not reach the stated completion evidence within the session. |
| `not_observed` | The task was not attempted or could not be observed. |

### Classification explanation

| Category | Coding rule |
| --- | --- |
| `relational_with_evidence` | Explanation uses participation, interrelation, pathway, or broader-condition scope and points to case evidence. |
| `relational_without_evidence` | Explanation uses the correct relational rule but does not ground it in case evidence. |
| `entity_type_only` | Explanation relies on what an item is, such as "an institution," without tracing participation or effect. |
| `unclear_or_missing` | Explanation is absent, contradictory, or too unclear to code. |
| `not_applicable` | Observed task does not require classification. |

### Revision quality

| Category | Coding rule |
| --- | --- |
| `substantive_reframing` | Student changes the focus, boundary, causal account, contradiction, limitation, or next inquiry. |
| `evidence_or_scope_improved` | Student corrects classification, strengthens evidence, narrows a claim, or repairs relationship or scope. |
| `surface_only` | Student changes wording or layout without changing the model's claim or support. |
| `no_change` | Student reviews the work but makes no revision. |
| `not_applicable` | Observed task does not include revision. |

### Error recovery

| Category | Coding rule |
| --- | --- |
| `recovered_independently` | Student preserves work and restores a usable state without procedural help. |
| `recovered_with_help` | Student restores a usable state after a hint or demonstration. |
| `not_recovered` | Student cannot restore a usable state during the session. |
| `not_needed` | No error or recovery condition occurs during the task. |
| `not_observed` | A recovery condition occurs but the recovery process cannot be observed. |

## Recording procedure

1. Start an authorized account/course session, or a separate legacy class session when evaluating that entrypoint. Name the tested interface in the study record.
2. Present one task at a time without demonstrating the correct classification.
3. Ask the student to explain the decision aloud. Do not transcribe the explanation into the application.
4. After the task, select one category for each rubric dimension.
5. Submit the closed observation event from the active student session. The request may omit `stage`; if supplied, `stage` must be a canonical workflow-stage label.

Example request:

```js
await fetch('/api/prototype/events', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    event: 'workflow_observed',
    stage: 'Review suggestions',
    metadata: {
      taskCode: 'classify_micro',
      taskOutcome: 'completed_independently',
      classificationExplanation: 'relational_with_evidence',
      revisionQuality: 'not_applicable',
      recoveryOutcome: 'not_needed',
    },
  }),
});
```

The server rejects missing fields, unknown fields, free-text values, unsupported categories, unauthenticated requests, oversized bodies, and requests over the existing rate limit. Accepted observations use the existing bounded prototype-event retention and row cap.

## Aggregate report

An authenticated teacher can download the report at:

```text
GET /api/teacher/student-workflow-evaluation-report
```

The response uses `Content-Disposition: attachment` and returns:

- total valid observations;
- count of discarded malformed stored rows, if any;
- completion outcomes overall and by predefined task;
- classification-explanation outcomes;
- revision-quality outcomes; and
- recovery outcomes.

The report does not return event rows, session references, timestamps, stages, names, memo content, map labels, annotations, project identifiers, model metadata, or teacher identity.

## Analysis plan

1. Report task completion for each predefined task as counts and proportions across valid observations.
2. Report classification explanations across the four level-specific tasks, keeping `not_applicable` and `not_observed` visible.
3. Compare first and later revision-task observations only in a separately approved, non-identifying study record; the application report deliberately does not expose session-level joins.
4. Report recovery outcomes only for tasks in which an error was intentionally introduced or naturally encountered.
5. Review accessibility notes separately and qualitatively under an approved protocol; do not add them to application events.
6. Do not infer learning from map size, relationship count, time-on-task alone, model availability, model acceptance, or visual neatness.

## Interpretation standard

The mechanism measures observed workflow performance, not student ability, disability, effort, or course achievement. A completed map can still contain weak reasoning, and a small map can contain strong, well-supported systems analysis. Findings should therefore pair completion with explanation, revision, and recovery outcomes, while treating inaccessible interface behavior as a product defect rather than a student failure.
