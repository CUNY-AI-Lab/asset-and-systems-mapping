import { describe, expect, it } from 'vitest';
import {
  buildStudentWorkflowEvaluationReport,
  STUDENT_WORKFLOW_EVALUATION_SCHEMA,
  validateStudentWorkflowEvaluationMetadata,
} from './student-workflow-evaluation.js';

const observation = (overrides = {}) => ({
  taskCode: 'classify_micro',
  taskOutcome: 'completed_independently',
  classificationExplanation: 'relational_with_evidence',
  revisionQuality: 'not_applicable',
  recoveryOutcome: 'not_needed',
  ...overrides,
});

describe('student workflow evaluation contract', () => {
  it('accepts only closed categories and no student-authored content', () => {
    expect(validateStudentWorkflowEvaluationMetadata(observation())).toEqual(observation());
    expect(() => validateStudentWorkflowEvaluationMetadata({
      ...observation(),
      memoText: 'Rosa attends a clinic.',
    })).toThrow('unsupported field');
    expect(() => validateStudentWorkflowEvaluationMetadata({
      ...observation(),
      taskOutcome: 'mostly finished because the map was confusing',
    })).toThrow('not a supported workflow observation category');
    expect(() => validateStudentWorkflowEvaluationMetadata({
      ...observation(),
      recoveryOutcome: undefined,
    })).toThrow('not a supported workflow observation category');
  });

  it('aggregates pedagogical outcomes without returning rows, sessions, timestamps, or map content', () => {
    const report = buildStudentWorkflowEvaluationReport([
      { metadata: JSON.stringify(observation()) },
      { metadata: observation({
        taskCode: 'revise_map',
        taskOutcome: 'completed_with_help',
        classificationExplanation: 'not_applicable',
        revisionQuality: 'evidence_or_scope_improved',
        recoveryOutcome: 'recovered_with_help',
      }) },
      { metadata: '{"memoText":"private"}' },
    ]);

    expect(report).toMatchObject({
      schemaVersion: STUDENT_WORKFLOW_EVALUATION_SCHEMA,
      observationCount: 2,
      discardedObservationCount: 1,
      measures: {
        taskCompletion: {
          overall: { completed_independently: 1, completed_with_help: 1, incomplete: 0 },
          byTask: {
            classify_micro: { completed_independently: 1 },
            revise_map: { completed_with_help: 1 },
          },
        },
        classificationExplanations: { relational_with_evidence: 1, not_applicable: 1 },
        revisionQuality: { evidence_or_scope_improved: 1, not_applicable: 1 },
        errorRecovery: { recovered_with_help: 1, not_needed: 1 },
      },
    });
    const serialized = JSON.stringify(report);
    for (const prohibited of ['memoText', 'private', 'sessionRef', 'recordedAt', 'nodeCount', 'modelAccepted']) {
      expect(serialized).not.toContain(prohibited);
    }
  });
});
