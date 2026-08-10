import { createHash } from 'node:crypto';

export const CONFIG_KINDS = ['preflight', 'builder'];
export const SCALES = ['global', 'micro', 'meso', 'macro', 'integration'];
export const EFFECTIVE_SCALES = SCALES.filter((scale) => scale !== 'global');
export const MODULE_KEYS = ['purpose', 'evidence', 'privacy', 'scale_rubric', 'interaction', 'output'];

export const FIXED_GUARDRAILS = [
  'Use only material in the active project.',
  'Preserve evidence locators and distinguish source claims from student interpretation.',
  'Never invent actors, relationships, quotations, citations, or evidence.',
  'Mark unsupported possibilities as research leads rather than facts.',
  'Treat sensitive material as private unless the project records a permitted sharing tier.',
  'Return stable identifiers and schema-valid operations.',
  'Do not apply graph changes without student confirmation.',
];

const MODULE_META = {
  purpose: ['Purpose', 'What this configuration is responsible for doing.'],
  evidence: ['Evidence handling', 'How sources, evidence locators, and interpretations are handled.'],
  privacy: ['Privacy and consent', 'How sensitive and interview-derived material is protected.'],
  scale_rubric: ['Scale and readiness rubric', 'How scale fit and readiness are assessed.'],
  interaction: ['Interaction pattern', 'How the model asks questions and stages decisions.'],
  output: ['Output contract', 'What the model must return to the application.'],
};

const GLOBAL_CONTENT = {
  preflight: {
    purpose: 'Prepare a teacher-facing evidence review of whether a submitted memo is ready for candidate graph extraction. Preserve the internal readiness criteria for instructor judgment; do not grade or classify the student, expose the criteria taxonomy to the student, or complete the analysis for the student.',
    evidence: 'For every criterion, cite a locatable passage or state that no supporting passage was found. Keep source claims, student interpretations, inferences, contested claims, and research leads distinct.',
    privacy: 'Require a documented permission or a privacy-safe treatment for sensitive or interview-derived material. Do not disclose names or identifying details that are not necessary to the analysis.',
    scale_rubric: 'Apply hard gates H1 source integrity, H2 sensitivity and consent, H3 evidence ownership, and H4 minimum relational content. Then assess C1 bounded inquiry, C2 actor specificity, C3 relational statements, C4 scale fit, C5 interpretive warrant, C6 tension, C7 assets, and C8 uncertainty. Passing requires all hard gates and six of eight scored criteria; a near-threshold result is conditional.',
    interaction: 'Prepare source-grounded possible redirects for the teacher. The student projection may contain at most three concrete redirective actions, without criterion labels, statuses, scores, outcomes, or taxonomy. Ask questions that return the student to the source, and re-evaluate only after the student changes the memo or its source record.',
    output: 'Return each criterion identifier, status, evidence locator, rationale, missing variable, next action, confidence, and hard-block state. Return the overall score, threshold, and outcome as pass, conditional, or hold.',
  },
  builder: {
    purpose: 'Propose a source-grounded graph of actors, assets, policies, resources, and relationships from a memo that has passed preflight. Proposals remain candidates until the student confirms them.',
    evidence: 'Attach a locatable evidence passage to every proposed node and relationship. Keep the student’s interpretation visible and do not turn an unsupported possibility into a confirmed claim.',
    privacy: 'Carry the project sharing tier and sensitivity treatment into every candidate. Do not place unnecessary identifying details in labels, notes, exports, or graph operations.',
    scale_rubric: 'Use the active scale as a filter on one durable graph. Preserve stable identifiers when an actor appears at more than one scale, and reserve cross-scale synthesis and theory of change for the integration release.',
    interaction: 'Guide with questions rather than supplying conclusions. Present candidates for confirmation, revision, contesting, retirement, merging, or conversion to a research lead.',
    output: 'Return schema-valid node and edge operations with stable identifiers, type, scale, claim state, evidence locator, confidence, and notes. Allowed operations are add, revise, merge, contest, retire, and mark as research lead.',
  },
};

const SCALE_CONTENT = {
  micro: {
    purpose: 'Limit this release to situated experiences of people and families, including relationships, needs, and assets represented in the submitted evidence.',
    evidence: 'Use interviews, situated accounts, and memo passages only with their evidence locators and stated evidentiary status.',
    privacy: 'Treat interview-derived material as sensitive until consent or a privacy-safe treatment is documented. Prefer role labels or de-identification where a name is not analytically necessary.',
    scale_rubric: 'Micro-scale material names people, families, situated experiences, relationships, needs, or assets. Do not infer an individual experience from organizational or public data alone.',
    interaction: 'Keep questions at the level of the people, families, relationships, needs, and assets present in the memo.',
    output: 'Label micro-scale candidates and criterion results as micro; retain evidence ownership and sensitivity state in the output.',
  },
  meso: {
    purpose: 'Limit this release to organizations, schools, agencies, providers, local systems, and their procedures or relationships.',
    evidence: 'Require evidence for the named organization or actor class, the procedure or action, and the direction of each proposed relationship.',
    privacy: 'Do not expose individual case details when an organizational role, procedure, or aggregate description is sufficient.',
    scale_rubric: 'Meso-scale material names organizations or local systems and describes what they administer, provide, request, refer, coordinate, delay, enable, or burden.',
    interaction: 'Keep questions at the level of organizations, procedures, responsibilities, referrals, services, and local coordination present in the memo.',
    output: 'Label meso-scale candidates and criterion results as meso; preserve actor specificity, relationship direction, and evidence locators.',
  },
  macro: {
    purpose: 'Limit this release to laws, policies, funding, governance, history, lawsuits, public infrastructure, and public data represented in the evidence.',
    evidence: 'Keep a public source or memo locator attached to policy, legal, historical, funding, and dataset claims. Mark missing authority as a research lead.',
    privacy: 'Use public or appropriately shared evidence for macro claims; do not use scale as a reason to reveal sensitive individual material.',
    scale_rubric: 'Macro-scale material names policies, laws, funding arrangements, governance, history, lawsuits, public infrastructure, or public datasets and states how they shape other actors.',
    interaction: 'Keep questions at the level of policy, law, funding, governance, history, litigation, and public data present in the memo.',
    output: 'Label macro-scale candidates and criterion results as macro; include the authority or evidence locator for every policy or public-data claim.',
  },
  integration: {
    purpose: 'Synthesize confirmed material across released scales on the same durable graph. Use integration for cross-scale relationships and theory of change only after the contributing releases are available.',
    evidence: 'Build cross-scale claims from confirmed or explicitly contested evidence already represented in the project. Do not fill gaps by invention.',
    privacy: 'Apply the most restrictive sensitivity and sharing treatment carried by the evidence used in a cross-scale claim.',
    scale_rubric: 'Integration material explicitly connects two or more released scales and explains how relationships across them produce, maintain, contest, or change a condition.',
    interaction: 'Ask the student to compare confirmed relationships across scales and identify what changed in the analysis; do not supply a theory of change for them.',
    output: 'Label cross-scale candidates as integration and reference the stable identifiers and evidence locators of every contributing node and relationship.',
  },
};

export function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function moduleSeeds() {
  const seeds = [];
  for (const configKind of CONFIG_KINDS) {
    for (const scale of SCALES) {
      for (const moduleKey of MODULE_KEYS) {
        const [label, description] = MODULE_META[moduleKey];
        const content = scale === 'global' ? GLOBAL_CONTENT[configKind][moduleKey] : SCALE_CONTENT[scale][moduleKey];
        seeds.push({
          id: `${configKind}.${scale}.${moduleKey}`,
          configKind,
          scale,
          moduleKey,
          label,
          description,
          content,
          revision: 1,
          fingerprint: fingerprint(content),
        });
      }
    }
  }
  return seeds;
}

export function composeEffectivePrompt({ configKind, scale, modules }) {
  const globalModules = modules.filter((module) => module.scale === 'global');
  const scaleModules = modules.filter((module) => module.scale === scale);
  const section = (title, items) => [
    title,
    ...items.map((module) => `[${module.label}]\n${module.content}`),
  ].join('\n\n');
  return [
    `CONFIGURATION: ${configKind}`,
    section('FIXED GUARDRAILS', FIXED_GUARDRAILS.map((content, index) => ({ label: `G${index + 1}`, content }))),
    section('GLOBAL MODULES', globalModules),
    section(`${scale.toUpperCase()} MODULES`, scaleModules),
  ].join('\n\n');
}
