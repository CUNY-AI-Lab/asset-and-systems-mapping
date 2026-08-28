export const STUDENT_WORKFLOW_EVALUATION_EVENT = 'workflow_observed';
export const STUDENT_WORKFLOW_EVALUATION_SCHEMA = 'systems-mapping.student-workflow-evaluation.v1';

export const STUDENT_WORKFLOW_TASKS = Object.freeze([
  'frame_inquiry',
  'classify_micro',
  'build_meso_interrelation',
  'trace_exo_pathway',
  'scope_macro_condition',
  'revise_map',
  'recover_from_error',
  'export_map',
]);

export const TASK_COMPLETION_OUTCOMES = Object.freeze([
  'completed_independently',
  'completed_with_help',
  'incomplete',
  'not_observed',
]);

export const CLASSIFICATION_EXPLANATION_OUTCOMES = Object.freeze([
  'relational_with_evidence',
  'relational_without_evidence',
  'entity_type_only',
  'unclear_or_missing',
  'not_applicable',
]);

export const REVISION_QUALITY_OUTCOMES = Object.freeze([
  'substantive_reframing',
  'evidence_or_scope_improved',
  'surface_only',
  'no_change',
  'not_applicable',
]);

export const ERROR_RECOVERY_OUTCOMES = Object.freeze([
  'recovered_independently',
  'recovered_with_help',
  'not_recovered',
  'not_needed',
  'not_observed',
]);

export const STUDENT_WORKFLOW_EVALUATION_FIELDS = Object.freeze({
  taskCode: STUDENT_WORKFLOW_TASKS,
  taskOutcome: TASK_COMPLETION_OUTCOMES,
  classificationExplanation: CLASSIFICATION_EXPLANATION_OUTCOMES,
  revisionQuality: REVISION_QUALITY_OUTCOMES,
  recoveryOutcome: ERROR_RECOVERY_OUTCOMES,
});

const REQUIRED_FIELDS = Object.freeze(Object.keys(STUDENT_WORKFLOW_EVALUATION_FIELDS));

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function validateStudentWorkflowEvaluationMetadata(value) {
  if (!isPlainObject(value)) throw new TypeError('workflow observation metadata must be a JSON object.');
  const keys = Object.keys(value);
  const unknown = keys.find((key) => !REQUIRED_FIELDS.includes(key));
  if (unknown) throw new TypeError('workflow observation metadata contains an unsupported field.');
  const missing = REQUIRED_FIELDS.find((key) => !Object.hasOwn(value, key));
  if (missing) throw new TypeError(`workflow observation metadata requires ${missing}.`);

  const validated = {};
  for (const field of REQUIRED_FIELDS) {
    const allowed = STUDENT_WORKFLOW_EVALUATION_FIELDS[field];
    if (typeof value[field] !== 'string' || !allowed.includes(value[field])) {
      throw new TypeError(`${field} is not a supported workflow observation category.`);
    }
    validated[field] = value[field];
  }
  return validated;
}

function zeroCounts(values) {
  return Object.fromEntries(values.map((value) => [value, 0]));
}

export function buildStudentWorkflowEvaluationReport(rows = []) {
  const taskCompletion = zeroCounts(TASK_COMPLETION_OUTCOMES);
  const classificationExplanations = zeroCounts(CLASSIFICATION_EXPLANATION_OUTCOMES);
  const revisionQuality = zeroCounts(REVISION_QUALITY_OUTCOMES);
  const errorRecovery = zeroCounts(ERROR_RECOVERY_OUTCOMES);
  const taskCompletionByTask = Object.fromEntries(STUDENT_WORKFLOW_TASKS.map((task) => [
    task,
    zeroCounts(TASK_COMPLETION_OUTCOMES),
  ]));
  let observationCount = 0;
  let discardedObservationCount = 0;

  for (const row of rows) {
    try {
      const parsed = typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : row?.metadata;
      const observation = validateStudentWorkflowEvaluationMetadata(parsed);
      observationCount += 1;
      taskCompletion[observation.taskOutcome] += 1;
      taskCompletionByTask[observation.taskCode][observation.taskOutcome] += 1;
      classificationExplanations[observation.classificationExplanation] += 1;
      revisionQuality[observation.revisionQuality] += 1;
      errorRecovery[observation.recoveryOutcome] += 1;
    } catch {
      discardedObservationCount += 1;
    }
  }

  return {
    schemaVersion: STUDENT_WORKFLOW_EVALUATION_SCHEMA,
    observationCount,
    discardedObservationCount,
    measures: {
      taskCompletion: {
        overall: taskCompletion,
        byTask: taskCompletionByTask,
      },
      classificationExplanations,
      revisionQuality,
      errorRecovery,
    },
  };
}
