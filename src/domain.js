import { isNodeReviewScale, isRelationshipReviewScale, canConnectAtScale } from '../shared/mapping-grammar.js';
import { SYSTEMS_MAPPING_STAGE_IDS } from '../shared/systems-mapping-stages.js';
import { FIELD_NOTES_QUESTION_LIMIT } from '../shared/field-notes.js';
import { MEMO_REVIEW_SCALE_LIMITS } from '../shared/memo-review-limits.js';
import { analyzeMemoSource, bibliographyOnlyEvidence, bibliographyOnlyLabel } from '../shared/memo-source.js';
import { RELATIONSHIP_PROCESS_FIELDS, RELATIONSHIP_PROCESS_TEXT_FIELDS, RELATIONSHIP_STRENGTHS, RELATIONSHIP_STATUSES } from '../shared/relationship-process.js';
export { RELATIONSHIP_PROCESS_FIELDS, RELATIONSHIP_STRENGTHS, RELATIONSHIP_STATUSES } from '../shared/relationship-process.js';
import { SYSTEMS_MAPPING_LEVELS, SYSTEMS_MAPPING_PARTS } from '../shared/systems-mapping-parts.js';

export const SCALE_ORDER = ['micro', 'meso', 'exosphere', 'macrosphere'];
export const SCALE_PARTS = SYSTEMS_MAPPING_PARTS;

export const SCALES = Object.freeze(Object.fromEntries(SYSTEMS_MAPPING_LEVELS.map(({ id, title, ...level }) => [id, Object.freeze({
  ...level,
  label: title,
})])));

export const HARD_CRITERIA = [
  { id: 'H1', label: 'Memo detail', help: 'The memo includes enough detail to begin mapping.' },
  { id: 'H2', label: 'Sensitivity and permission', help: 'Sensitive material has documented permission or a privacy-safe treatment.' },
  { id: 'H3', label: 'Claims and interpretation', help: 'The student makes clear what the memo says and what they think it means.' },
  { id: 'H4', label: 'Map elements', help: 'The memo names enough elements for the active level. Each level uses its own map structure.' },
];

export const SCORED_CRITERIA = [
  { id: 'C1', label: 'Bounded inquiry' },
  { id: 'C2', label: 'Specific names' },
  { id: 'C3', label: 'Relational statements' },
  { id: 'C4', label: 'Level fit' },
  { id: 'C5', label: 'Interpretive warrant' },
  { id: 'C6', label: 'Tension or contradiction' },
  { id: 'C7', label: 'Assets and capacities' },
  { id: 'C8', label: 'Uncertainty is marked' },
];

export const RELATION_VOCABULARY = [
  'provides', 'funds', 'regulates', 'administers', 'requests', 'refers', 'serves', 'qualifies',
  'excludes', 'delays', 'burdens', 'enables', 'depends on', 'coordinates with',
  'reports to', 'measures', 'contests', 'litigates', 'supersedes', 'shapes',
  'located in', 'contradicts', 'corroborates',
];

// Closed relationship registers for the outer levels. An Exosphere link is a
// transactional pathway from an institution into the mapped world; the
// Macrosphere register is deontic — how a structure operates on its scope.
// Meso connects existing Micro nodes with the student's own relationship verbs.
export const SCALE_VERB_LEXICONS = Object.freeze({
  exosphere: Object.freeze([
    'funds', 'administers', 'regulates', 'employs', 'sets rules for', 'owns',
    'provides', 'serves', 'refers', 'contracts with', 'informs', 'excludes', 'delays',
  ]),
  macrosphere: Object.freeze([
    'shapes', 'mandates', 'prohibits', 'defines eligibility for', 'prices',
    'normalizes', 'frames', 'constrains', 'privileges',
  ]),
});

const SCALE_VERB_ALIASES = Object.freeze({
  exosphere: Object.freeze({
    'pays for': 'funds', finances: 'funds', subsidizes: 'funds',
    runs: 'administers', operates: 'administers', manages: 'administers',
    oversees: 'regulates', supervises: 'regulates', governs: 'sets rules for',
    controls: 'sets rules for', hires: 'employs', staffs: 'employs',
    notifies: 'informs', supplies: 'provides', delivers: 'provides',
  }),
  macrosphere: Object.freeze({
    requires: 'mandates', obliges: 'mandates', forbids: 'prohibits',
    bans: 'prohibits', restricts: 'constrains', limits: 'constrains',
    legitimizes: 'normalizes', favors: 'privileges', influences: 'shapes',
    affects: 'shapes', defines: 'frames',
  }),
});

// Resolves a proposed verb to its canonical register entry for the scale, or
// null when the verb has no place in that register. Scales without a closed
// register pass verbs through.
export function scaleLexiconVerb(scale, verb) {
  const trimmed = String(verb || '').trim();
  const lexicon = SCALE_VERB_LEXICONS[scale];
  if (!lexicon) return trimmed || null;
  if (!trimmed) return null;
  const lowered = trimmed.toLocaleLowerCase();
  return lexicon.find((entry) => entry === lowered) || SCALE_VERB_ALIASES[scale]?.[lowered] || null;
}

export const NODE_BASES = Object.freeze(['memo', 'inference']);

export const MESOSYSTEM_NODE_TYPE = 'mesosystem';
// A Meso scope must refer to actual microsystems, not merely to any Micro
// actor, group, service, or object. Micro settings therefore have an explicit
// type instead of being guessed from broad entity categories.
export const MICRO_SETTING_NODE_TYPES = Object.freeze([
  'setting', 'place', 'organization', 'institution', 'agency', 'service',
]);
export const NODE_TYPES = [
  'person', 'role', 'group', 'family', 'organization', 'institution', 'agency', 'service',
  'activity', 'object', 'policy', 'resource', 'place', 'setting', 'dataset',
  'event', 'law', 'belief', 'economic condition', 'history', 'culture', 'structure', MESOSYSTEM_NODE_TYPE,
];
// Entity kind and ecological placement are independent dimensions. An
// institution, service, or organization may be part of Micro when the focal
// person participates in it directly; the same kind belongs at Exosphere
// when its relevant decisions occur outside the person's immediate settings.
export const MICRO_NODE_TYPES = Object.freeze([
  'person', 'role', 'group', 'family', 'organization', 'institution', 'agency',
  'service', 'activity', 'object', 'resource', 'place', 'setting',
]);
export const EXOSPHERE_NODE_TYPES = Object.freeze(['organization', 'institution', 'agency', 'service', 'policy', 'resource', 'law', 'belief', 'economic condition', 'history', 'culture', 'structure']);
export const MACROSPHERE_NODE_TYPES = Object.freeze(['policy', 'law', 'belief', 'economic condition', 'history', 'culture', 'structure']);

export function isNodeTypeAllowedAtScale(type, scale) {
  if (scale === 'meso') return type === MESOSYSTEM_NODE_TYPE;
  if (scale === 'exosphere') return EXOSPHERE_NODE_TYPES.includes(type);
  if (scale === 'macrosphere') return MACROSPHERE_NODE_TYPES.includes(type);
  if (scale === 'micro') return MICRO_NODE_TYPES.includes(type);
  return false;
}

const UNAMBIGUOUS_INSTITUTION_LABEL = /(?:\bc\W*u\W*n\W*y\b|\bMTA\b|\bOPWDD\b|\bACCES-?VR\b|\bNYC\s+(?:DOE|HRA|DSS)\b)/i;
const OFFICIAL_INSTITUTION_ACRONYM = /^(?=[A-Z0-9.-]{3,16}$)(?=.*[B-DF-HJ-NP-TV-Z]{2})[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/;
const OFFICIAL_PUBLIC_BENEFIT_PROGRAM = /^(?:Medicaid|Medicare|Social Security|Supplemental Security Income|Social Security Disability Insurance|SNAP|TANF|WIC|Section 8)$/i;
const HYPHENATED_SERVICE_BRAND = /^(?=.{4,80}$)(?:[A-Z][A-Za-z0-9&.'’]*)(?:-[A-Z][A-Za-z0-9&.'’]*)+$/;
const SERVICE_BRAND_SIGNAL = /(?:^|-)(?:Access|Ride|Care|Aid|Health|Housing|Benefits?|Transit|Transportation|Mobility|Paratransit|Legal|Food|Support|Services?)(?:-|$)/i;
const MIXED_CASE_ORGANIZATION_BRAND = /^[A-Z][a-z]{2,}[A-Z][a-z]{1,4}$/;
const INSTITUTION_SCOPED_POLICY = /^(.+?)\s+(?:(?:[A-Za-z][A-Za-z-]*\s+){0,4})(?:polic(?:y|ies)|rules?|requirements?|offices?|divisions?|contracts?|schedules?|blocks?|holds?|programs?|services?)$/i;
const GENERIC_INSTITUTION_HEAD = /^(?:agency|board|center|clinic|college|committee|council|department|hospital|institution|office|organization|program|school|service|university)$/i;
const SOCIAL_HANDLE_LABEL = /^(?:r|u)\/[A-Za-z0-9_-]+$/i;
const GENERIC_INSTITUTION_LABEL = /^(?:(?:parent|student|family|youth|community|local|public|private|disability|advocacy|support|service)\s+){1,4}(?:organizations?|programs?|services?|agencies|offices?|institutions?|schools?|clinics?|centers?)$/i;
const NAMED_INSTITUTION_PATTERN = /^(?:the\s+)?(?:(?:[A-Z][A-Za-z0-9&.'’-]*\s+){1,8}(?:Universit(?:y|ies)|Colleges?|Offices?|Departments?|Committees?|Agenc(?:y|ies)|Authorit(?:y|ies)|Boards?|Bureaus?|Commissions?|Councils?|Corporations?|Organizations?|Associations?|Societ(?:y|ies)|Foundations?|Institutes?|Administrations?|Librar(?:y|ies)|Centers?|Clinics?|Schools?|Hospitals?|Programs?|Services?|Service Providers?|Networks?)\b|(?:Offices?|Departments?|Committees?|Agenc(?:y|ies)|Authorit(?:y|ies)|Boards?|Bureaus?|Commissions?|Councils?)\s+(?:of|for|on)\s+[A-Z][A-Za-z0-9&.'’-]*(?:\s+(?:(?:of|for|and|the|in|at|on|with)\s+)?[A-Z][A-Za-z0-9&.'’-]*){0,10}\b)/;

// Earlier interface drafts used figurative category names that do not name a
// map element or give a student a clear instruction. Keep close variants out
// of model suggestions and editable labels without excluding ordinary terms
// such as "energy costs", "meeting room", or "transition planning".
const RETIRED_SYSTEMS_LANGUAGE = Object.freeze([
  /\bstuck\b/i,
  /\b(?:has|have|had|having)\s+(?:some\s+)?energy\b/i,
  /\benergy\s+for\s+change\b/i,
  /\bripples?\s+(?:out|outward)\b/i,
  /\bin\s+the\s+room\s+with\b/i,
  /\b(?:never|not)\s+in\s+the\s+room\b/i,
  /\b(?:this|that|the)\s+ring\s+(?:holds?|contains?|shows?|includes?)\b/i,
  /\b(?:patterns?\s+(?:(?:with\s+no|without)\s+(?:a\s+)?doors?|(?:that\s+)?(?:has|have)\s+no\s+doors?)|(?:doorless|no[\s–—-]?door)\s+patterns?)\b/i,
  /\b(?:the\s+)?test\s+for\s+(?:this|that|the)\s+ring\b/i,
  /\bif\s+you\s+could\s+visit\s+it\b/i,
  /\b(?:it\s+)?could\s+(?:e[ -]?mail|message|contact)\s+you\b/i,
  /\bbelongs?\s+(?:farther|further)\s+in\b/i,
]);

export function containsRetiredSystemsLanguage(value) {
  if (typeof value !== 'string') return false;
  const text = value.replace(/\s+/g, ' ').trim();
  return Boolean(text && RETIRED_SYSTEMS_LANGUAGE.some((pattern) => pattern.test(text)));
}

function normalizedEntityLabel(value) {
  return String(value || '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, ' ').trim().toLocaleLowerCase();
}

export function institutionLabelAliases(value) {
  const raw = String(value || '').trim();
  const aliases = new Set();
  const normalized = normalizedEntityLabel(raw);
  if (normalized) aliases.add(normalized);
  for (const match of raw.matchAll(/\(([A-Z][A-Z0-9-]{1,15})\)/g)) aliases.add(normalizedEntityLabel(match[1]));
  const words = raw.match(/[A-Za-z0-9]+/g) || [];
  const significant = words.filter((word) => !/^(?:a|an|and|at|for|in|of|on|the|to|with)$/i.test(word));
  if (significant.length >= 2 && significant.length <= 8) aliases.add(significant.map((word) => word[0]).join('').toLocaleLowerCase());
  return [...aliases].filter((alias) => alias.length >= 3);
}

export function isNamedInstitutionLabel(value) {
  if (typeof value !== 'string') return false;
  const label = value.trim();
  if (!label) return false;
  if (containsRetiredSystemsLanguage(label)) return false;
  // Platform handles name a person or an immediate online setting, even when
  // the handle contains an institutional acronym (for example `r/CUNY`).
  // The institution itself (`CUNY`) can be placed only after its relationship
  // to the focal person is known; the label alone does not determine a level.
  if (SOCIAL_HANDLE_LABEL.test(label)) return false;
  if (/\b(?:digital-first|online-only|automated)\b/i.test(label)) return false;
  if (isTemporalOnlyMapElementLabel(label, true) || GENERIC_INSTITUTION_HEAD.test(label)) return false;
  if (GENERIC_INSTITUTION_LABEL.test(label)) return false;
  if (UNAMBIGUOUS_INSTITUTION_LABEL.test(label)) return true;
  if (OFFICIAL_INSTITUTION_ACRONYM.test(label) || OFFICIAL_PUBLIC_BENEFIT_PROGRAM.test(label)) return true;
  if (HYPHENATED_SERVICE_BRAND.test(label) && SERVICE_BRAND_SIGNAL.test(label)) return true;
  if (MIXED_CASE_ORGANIZATION_BRAND.test(label)) return true;
  const institutionScopedPolicy = label.match(INSTITUTION_SCOPED_POLICY);
  if (institutionScopedPolicy && isNamedInstitutionLabel(institutionScopedPolicy[1])) return true;
  // Generic phrases such as "school segregation policy" and "program
  // eligibility rules" name broad conditions, not named institutions. The
  // generic institutional word is only decisive when it appears in a proper
  // name with at least one preceding capitalized term.
  return NAMED_INSTITUTION_PATTERN.test(label);
}

export function isInstitutionScopedPolicyLabel(value) {
  if (typeof value !== 'string') return false;
  const match = value.trim().match(INSTITUTION_SCOPED_POLICY);
  return Boolean(match && isNamedInstitutionLabel(match[1]));
}

export function labelRepeatsInstitution(value, institutions) {
  if (isNamedInstitutionLabel(value)) return true;
  const normalized = normalizedEntityLabel(value);
  if (!normalized) return false;
  return (Array.isArray(institutions) ? institutions : []).some((node) => institutionLabelAliases(node?.label).some((alias) => (
    normalized === alias || normalized.startsWith(`${alias} `) || normalized.endsWith(` ${alias}`) || normalized.includes(` ${alias} `)
  )));
}
export const CLAIM_STATES = ['confirmed', 'student interpretation', 'inference', 'contested', 'research lead', 'retired'];
export const NODE_ORIGINS = Object.freeze(['memo extraction', 'model suggestion', 'student entry', 'legacy']);
export const REVIEW_DECISIONS = Object.freeze(['pending', 'added', 'set aside', 'removed']);
export const FOCAL_PARTICIPATION_STATES = Object.freeze(['direct', 'indirect', 'unclear', 'not applicable']);

export const PROJECT_SCHEMA_VERSION = 9;

export const PROJECT_LIMITS = Object.freeze({
  importBytes: 8 * 1024 * 1024,
  sourceText: 500_000,
  sourceSentences: 10_000,
  evidenceExcerpt: 32_000,
  nodes: 500,
  edges: 1_000,
  events: 2_000,
  evidenceRefs: 50,
  claimEvidenceRecords: 50,
  claimEvidenceText: 20_000,
  relationshipProcessText: 1_000,
  configHistory: 100,
  relationVocabulary: 100,
  annotationText: 4_000,
  reviewText: 20_000,
  focusedQuestion: 1_000,
  redirectAction: 500,
  redirectEvidence: 280,
  memoGuidanceItems: 8,
  memoGuidanceText: 500,
  memoGuidanceEvidence: 500,
  memoReviewNodes: 20,
  memoReviewConnections: 12,
  memoReviewExample: 1000,
  scopeMembers: 24,
  noteText: 4_000,
  rationaleText: 8_000,
  eventText: 8_000,
  promptText: 64_000,
  metadataText: 8_000,
  metadataCollection: 1_000,
  metadataKeys: 100,
  metadataDepth: 10,
  metadataWork: 5_000,
  genericText: 500_000,
  objectKeys: 200,
  genericCollection: 5_000,
  nestingDepth: 20,
  traversalWork: 50_000,
  coordinateMin: -10_000,
  coordinateMax: 10_000,
  panMin: -10_000,
  panMax: 10_000,
  zoomMin: 0.15,
  zoomMax: 4,
});

export const DEFAULT_VIEWPORT = Object.freeze({ panX: 0, panY: 0, zoom: 1 });

export const CLAIM_EVIDENCE_FIELDS = Object.freeze([
  'sourcePassage',
  'studentInterpretation',
  'warrant',
  'uncertainty',
  'counterevidence',
  'missingVoice',
]);

const DEFAULT_CANVAS = Object.freeze({ width: 840, height: 540, radiusX: 290, radiusY: 190 });

export const BASE_GUARDRAILS = `Use only material in the active project. Keep track of where each piece of evidence appears. Never invent people, organizations, connections, quotations, or citations. Mark unsupported possibilities as needing more evidence. Keep what the memo says separate from the student's interpretation. Sensitive material stays local unless the instructor explicitly changes the sharing tier. Return stable IDs and schema-valid operations only.`;

export const DEFAULT_MEMO = `How do New York City special-education systems shape a family's ability to secure services? A family requests an evaluation from its school. The school refers the student to the Committee on Special Education, which determines eligibility. NYC Public Schools administers services and is regulated by the New York State Education Department. Parent advocacy organizations provide guidance, but delayed evaluations burden families. Public data may undercount informal support and should be checked against published case reports.`;

export function stableId(prefix, value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

// Claim evidence is additive: a map item may have several records, and each
// record keeps the source passage, the student's reading, and the reasoning
// between them distinct. Existing evidence IDs and locators remain available
// on the record so the new fields do not replace provenance already captured.
export function createClaimEvidenceRecord(overrides = {}, { ownerId = 'claim', index = 0 } = {}) {
  const provenanceSeed = [
    overrides.evidenceId,
    overrides.sourceId,
    overrides.evidenceHash,
    overrides.evidenceLocator,
    overrides.sourcePassage,
    index,
  ].filter((value) => value !== undefined && value !== null).join(':');
  const record = {
    id: overrides.id || stableId('claim_evidence', `${ownerId}:${provenanceSeed}`),
    sourcePassage: '',
    studentInterpretation: '',
    warrant: '',
    uncertainty: '',
    counterevidence: '',
    missingVoice: '',
  };
  CLAIM_EVIDENCE_FIELDS.forEach((field) => {
    if (typeof overrides[field] === 'string') record[field] = overrides[field];
  });
  ['evidenceId', 'sourceId', 'evidenceLocator', 'evidenceHash'].forEach((field) => {
    if (typeof overrides[field] === 'string') record[field] = overrides[field];
  });
  return record;
}

export function normalizeClaimEvidenceRecords(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
  const ownerId = typeof record.id === 'string' && record.id ? record.id : 'claim';
  if (Array.isArray(record.claimEvidence)) {
    return record.claimEvidence.map((item, index) => createClaimEvidenceRecord(
      item && typeof item === 'object' && !Array.isArray(item) ? item : {},
      { ownerId, index },
    ));
  }
  const references = Array.isArray(record.evidenceRefs) && record.evidenceRefs.length
    ? record.evidenceRefs
    : (record.evidenceExcerpt !== undefined
      || record.evidenceId !== undefined
      || record.sourceId !== undefined
      || record.evidenceLocator !== undefined
      || record.evidenceHash !== undefined)
      ? [record]
      : [];
  return references.map((reference, index) => createClaimEvidenceRecord({
    sourcePassage: typeof reference.evidenceExcerpt === 'string' ? reference.evidenceExcerpt : '',
    evidenceId: reference.evidenceId,
    sourceId: reference.sourceId,
    evidenceLocator: reference.evidenceLocator,
    evidenceHash: reference.evidenceHash,
  }, { ownerId, index }));
}

export function createRelationshipProcess(overrides = {}) {
  return {
    ...Object.fromEntries(RELATIONSHIP_PROCESS_TEXT_FIELDS.map(field => [field, typeof overrides?.[field] === 'string' ? overrides[field] : ''])),
    strength: RELATIONSHIP_STRENGTHS.includes(overrides?.strength) ? overrides.strength : 'unknown',
    familyCount: Number.isSafeInteger(overrides?.familyCount) && overrides.familyCount >= 0 ? overrides.familyCount : null,
    connectionStatus: RELATIONSHIP_STATUSES.includes(overrides?.connectionStatus) ? overrides.connectionStatus : 'unknown',
  };
}

export function hasRelationshipProcessDetails(edgeOrProcess) {
  const process = edgeOrProcess?.relationshipProcess || edgeOrProcess;
  return Boolean(process && (RELATIONSHIP_PROCESS_TEXT_FIELDS.some(field => typeof process[field] === 'string' && process[field].trim())
    || (process.strength && process.strength !== 'unknown') || (process.connectionStatus && process.connectionStatus !== 'unknown')
    || Number.isSafeInteger(process.familyCount)));
}

export function createLevelProgress({
  activeScale = 'micro',
  stage = 0,
  reflection = '',
  completedScales = [],
} = {}) {
  const safeStage = Number.isInteger(stage) && stage >= 0 && stage <= 4 ? stage : 0;
  const safeReflection = typeof reflection === 'string' ? reflection : '';
  const completed = new Set(Array.isArray(completedScales) ? completedScales : []);
  return Object.fromEntries(SCALE_ORDER.map((scale) => [scale, scale === activeScale
    ? { stage: safeStage, reflection: safeReflection }
    : { stage: completed.has(scale) ? 4 : 1, reflection: '' }]));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])]));
}

export function configFingerprint(config) {
  const { fingerprint: _fingerprint, history: _history, ...effectiveConfig } = config;
  return stableId('cfg', JSON.stringify(canonicalize(effectiveConfig)));
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// Node labels identify bounded map elements. References, dates, and timetable
// fragments belong in evidence; letting them become nodes produces unstable
// endpoints that cannot survive a reread of the memo.
const MAP_ELEMENT_STANDALONE_REFERENCE = /^(?:he|she|they|him|her|them|his|hers|their|theirs|it|its|we|us|our|ours|i|me|my|mine|you|your|yours|this|that|these|those)$/i;
const MAP_ELEMENT_REFERENCE_TOKEN = /\b(?:he|she|they|him|her|them|his|hers|their|theirs|it|its|we|us|our|ours|i|me|my|mine|you|your|yours|this|that|these|those)\b/i;
const MAP_ELEMENT_DANGLING_ARTIFACT = /(?:^|\s)(?:a|also|an|and|at|before|between|but|by|during|either|for|from|in|into|near|neither|of|on|or|over|respectively|the|through|to|too|under|with|without)$/i;
const MAP_ELEMENT_LEADING_QUANTIFIER = /^(?:all|both|each|either|every|few|many|neither|other|several|some)\b/i;
const MAP_ELEMENT_ENTITY_HEAD = /\b(?:association|board|bureau|center|centre|church|class|classroom|clinic|coalition|college|committee|community|council|department|family|foundation|group|hospital|institute|institution|journal|lab|library|magazine|network|newspaper|office|organization|person|platform|program|school|service|society|student|team|university|workplace)\b/i;
const MAP_ELEMENT_SCHEDULE_HEAD = /\b(?:availability|appointments?|hours?|schedules?|shifts?|workdays?|workweeks?)$/i;
const MAP_ELEMENT_ACTION_START = /^(?:administer(?:s|ed|ing)?|attend(?:s|ed|ing)?|connect(?:s|ed|ing)?|coordinate(?:s|d|ing)?|deliver(?:s|ed|ing)?|facilitat(?:e|es|ed|ing)|fund(?:s|ed|ing)?|help(?:s|ed|ing)?|manage(?:s|d|ing)?|offer(?:s|ed|ing)?|provide(?:s|d|ing)?|receive(?:s|d|ing)?|refer(?:s|red|ring)?|request(?:s|ed|ing)?|serve(?:s|d|ing)?|support(?:s|ed|ing)?|supervis(?:e|es|ed|ing)|use(?:s|d|ing)?|visit(?:s|ed|ing)?|work(?:s|ed|ing)?)\b/i;
const MAP_ELEMENT_WEEKDAY = /^(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|mons?|tues?|weds?|thurs?|fris?|sats?|suns?)$/i;
const MAP_ELEMENT_MONTH = /^(?:januarys?|februarys?|march(?:es)?|aprils?|mays?|junes?|julys?|augusts?|septembers?|octobers?|novembers?|decembers?|jans?|febs?|mars?|aprs?|juns?|juls?|augs?|septs?|octs?|novs?|decs?)$/i;
const MAP_ELEMENT_TEMPORAL_ATOM = /^(?:days?|weeks?|months?|years?|hours?|minutes?|mornings?|afternoons?|evenings?|nights?|noon|midnight|dawn|dusk|weekdays?|weekends?|semesters?|terms?|spring|summer|fall|autumn|winter|daily|weekly|biweekly|fortnightly|monthly|quarterly|annually|yearly|hourly|nightly)$/i;
const MAP_ELEMENT_TEMPORAL_CONNECTOR = /^(?:a|about|after|an|and|around|at|before|between|during|each|every|from|on|once|other|per|the|through|thru|till|times?|to|twice|until)$/i;
const MAP_ELEMENT_CLOCK_TOKEN = /^(?:(?:[01]?\d|2[0-3])(?::[0-5]\d)?(?:a\.?m\.?|p\.?m\.?)?|(?:[1-9]|1[0-2])(?::[0-5]\d)?|a\.?m\.?|p\.?m\.?)$/i;

function isTemporalOnlyMapElementLabel(label, rejectScheduleHead = false) {
  if (rejectScheduleHead && MAP_ELEMENT_SCHEDULE_HEAD.test(label)) return true;
  // A named setting can legitimately contain a day or time word: “Tuesday
  // Night Clinic” and “Tuesday peer support group” remain map elements.
  if (MAP_ELEMENT_ENTITY_HEAD.test(label)) return false;
  const tokens = label
    .replace(/[\u2013\u2014/,-]/g, ' ')
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, '$1')
    .split(/\s+/)
    .filter(Boolean);
  let sawTemporal = false;
  let numericTokens = 0;
  let rangeConnector = false;
  for (const token of tokens) {
    if (MAP_ELEMENT_WEEKDAY.test(token) || MAP_ELEMENT_MONTH.test(token) || MAP_ELEMENT_TEMPORAL_ATOM.test(token)) {
      sawTemporal = true;
      continue;
    }
    if (MAP_ELEMENT_CLOCK_TOKEN.test(token)) {
      sawTemporal = true;
      continue;
    }
    if (/^\d{1,4}$/.test(token)) {
      numericTokens += 1;
      continue;
    }
    if (MAP_ELEMENT_TEMPORAL_CONNECTOR.test(token)) {
      if (/^(?:to|through|thru|until|till)$/i.test(token)) rangeConnector = true;
      continue;
    }
    return false;
  }
  return sawTemporal || (numericTokens >= 2 && rangeConnector);
}

// Validation rejects the whole generated batch; it never trims a sentence
// into an invented actor or silently drops individual model suggestions.
const MAP_ELEMENT_CLAUSE = /(?:\b(?:who|which|that)\s+(?:is|are|was|were|has|have|can|will|brings|carries|needs|does)\b|\s+(?:is|are|was|were|has|have|had|can|could|must|should|will|would|does|did)\s+|\s+(?:brings?|brought|carries|carried|needs?|needed|requires?|required|books?|booked|pads?|padded|reminds?|reminded|cooks?|cooked|watches|watched|handles?|handled|commutes?|commuted|sleeps?|slept|sits|cut|cuts|lost|pays?|paid|drives?|drove|presumes?|presumed|decides?|decided|limits?|limited|plans?|planned|sends?|sent|keeps?|kept|waits?|waited|appeals?|appealed)\s+\S+)/iu;

export function isStatementMapElementLabel(value) {
  return typeof value === 'string' && (MAP_ELEMENT_CLAUSE.test(value)
    || /^(?:when|because|although|while|if|unless)\s+/iu.test(value));
}

export function normalizeMapElementLabel(value, { micro = false } = {}) {
  if (typeof value !== 'string') return null;
  let label = normalizeWhitespace(value).replace(/^["'“”‘’\s]+|["'“”‘’\s.!?;,]+$/g, '');
  if (!label || label.length < 2 || label.length > 200 || !/[a-z]/i.test(label)) return null;
  if (containsRetiredSystemsLanguage(label)) return null;
  // “both” is a distributive quantifier, not part of the actor's name. This
  // cleanup is deterministic and happens before label de-duplication.
  if (/\s+both$/i.test(label)) label = label.replace(/\s+both$/i, '').trim();
  if (!label || MAP_ELEMENT_STANDALONE_REFERENCE.test(label)) return null;
  if (MAP_ELEMENT_REFERENCE_TOKEN.test(label) && !isNamedInstitutionLabel(label)) return null;
  if (MAP_ELEMENT_DANGLING_ARTIFACT.test(label) || MAP_ELEMENT_LEADING_QUANTIFIER.test(label)) return null;
  if (isTemporalOnlyMapElementLabel(label, micro)) return null;
  // A verb-shaped first token joined into a compound can be a noun modifier
  // (for example, a work–school mesosystem label), not a finite predicate.
  if (MAP_ELEMENT_ACTION_START.test(label) && !MAP_ELEMENT_ENTITY_HEAD.test(label) && !/^[^\s]+[–—-]/u.test(label)) return null;
  return label;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MICRO_NODE_PREDICATE = /\s+(?:(?:who|that|which)\s+)?(?:am|is|are|was|were|be|been|has|have|had|do|does|did|can|could|may|might|must|shall|should|will|would|provides?|provided|facilitat(?:e|es|ed)|funds?|funded|regulates?|regulated|administers?|administered|requests?|requested|refers?|referred|serves?|served|sets?|supports|supported|partners|partnered|shares|shared|employs|employed|supervises|supervised|qualifies?|qualified|excludes?|excluded|delays?|delayed|enables?|enabled|depends?|depended|coordinates?|coordinated|reports?|reported|measures?|measured|contests?|contested|litigates?|litigated|supersedes?|superseded|shapes?|shaped|mandates?|mandated|prohibits?|prohibited|prices?|priced|normalizes?|normalized|frames?|framed|constrains?|constrained|privileges?|privileged|defines?|defined|contradicts?|contradicted|corroborates?|corroborated|faces?|faced|experiences?|experienced|meets?|met|interacts?|interacted|connects?|connected|receives?|received|uses?|used|attends?|attended|visits?|visited|works?|worked|helps?|helped|offers?|offered|manages?|managed|delivers?|delivered|lives?|lived)\b/i;
const MICRO_NODE_LEADING_CLAUSE = /^(?:when|where|because|while|although|if|unless|once|after|before)\s+/i;
const MICRO_NODE_ADDITIONAL_ENTITY = /\b(?:adults?|famil(?:y|ies)|people|persons?|participants?|students?|parents?|caregivers?|teachers?|residents?|children|workers?|navigators?|classrooms?|schools?|centers?|clinics?|homes?|neighbou?rhoods?|programs?|organizations?|agenc(?:y|ies)|offices?|departments?|committees?|services?|supports?|resources?|funding|transportation|access)\b/i;
const MICRO_NODE_NAMED_ENTITY = /(?:^|\s)(?:the\s+)?(?:[A-Z][A-Za-z0-9'’.-]*)(?:\s+(?:(?:of|for|and|the|in|at|on|with)\s+)?[A-Z][A-Za-z0-9'’.-]*)+/;
const MICRO_NODE_COORDINATED_ENTITY_NOUNS = /\b(?:famil(?:y|ies)|people|persons?|participants?|students?|parents?|caregivers?|teachers?|workers?|navigators?|classrooms?|schools?|centers?|clinics?|homes?|workplaces?|rooms?|labs?|libraries|groups?|programs?|organizations?|agenc(?:y|ies)|offices?|services?|tablets?|wheelchairs?|schedules?)\b\s+(?:and|&)\s+(?:(?:a|an|the)\s+)?(?:\b(?:famil(?:y|ies)|people|persons?|participants?|students?|parents?|caregivers?|teachers?|workers?|navigators?|classrooms?|schools?|centers?|clinics?|homes?|workplaces?|rooms?|labs?|libraries|groups?|programs?|organizations?|agenc(?:y|ies)|offices?|services?|tablets?|wheelchairs?|schedules?)\b|[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,3})/i;
const MICRO_NODE_COORDINATED_PEOPLE = /^(?:[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2})\s+(?:and|&)\s+(?:[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2})$/u;
const MICRO_NODE_ABSTRACT_LABEL = /^(?:access|data|evidence|eligibility|funding|guidance|resources?|services?|support|uncertainty)$/i;

function cleanMicroNodeLabel(value) {
  const label = normalizeMapElementLabel(value, { micro: true });
  if (!label) return null;
  if (/^(?:something|anything)$/i.test(label)) return null;
  if (/\b(?:who|that|which)$/i.test(label)) return null;
  return label;
}

const MICRO_NODE_AUXILIARY = /^(?:am|is|are|was|were|be|been|has|have|had|do|does|did|can|could|may|might|must|shall|should|will|would)$/i;
const MICRO_NODE_FINAL_CONTENT_NAME = /^(?:(?:(?:annual|case|daily|financial|monthly|progress|published|quarterly|research|status|weekly)\s+){1,3}reports?|(?:[A-Z][\p{L}0-9&.'’-]*\s+){0,8}(?:community|education|literacy|public|relief|scholarship|student)\s+fund|(?:[A-Z][\p{L}0-9&.'’-]*\s+){0,8}(?:department|bureau|office|ministry)\s+(?:of\s+)?(?:[A-Z][\p{L}0-9&.'’-]*\s+){0,6}works)$/iu;

export function normalizeMicroNodeLabel(value) {
  const label = cleanMicroNodeLabel(value);
  if (!label) return null;
  const predicate = MICRO_NODE_PREDICATE.exec(label);
  if (!predicate) return label;
  // A small closed set of explicit content-name forms may end in a word that
  // is also a verb ("Department of Public Works", "Annual Reports"). Do not
  // generalize that exception to actor-plus-predicate fragments such as
  // "Rosa Works", "Group Meets", or "Center Supports".
  const matchedWord = predicate[0].trim();
  if (
    predicate.index + predicate[0].length >= label.length
    && !/^(?:who|that|which)\b/i.test(matchedWord)
    && !MICRO_NODE_AUXILIARY.test(matchedWord)
    && MICRO_NODE_FINAL_CONTENT_NAME.test(label)
  ) return label;
  const remainder = label.slice(predicate.index + predicate[0].length).trim();
  if (MICRO_NODE_ADDITIONAL_ENTITY.test(remainder) || MICRO_NODE_NAMED_ENTITY.test(remainder)) return null;
  let candidate = label.slice(0, predicate.index).trim();
  const hadLeadingClause = MICRO_NODE_LEADING_CLAUSE.test(candidate);
  if (hadLeadingClause) candidate = candidate.replace(MICRO_NODE_LEADING_CLAUSE, '').trim();
  if (hadLeadingClause || predicate) candidate = candidate.replace(/^(?:a|an|the)\s+/i, '').trim();
  return cleanMicroNodeLabel(candidate);
}

export function isDiscreteMicroNodeLabel(value) {
  const label = cleanMicroNodeLabel(value);
  return Boolean(label && label === normalizeWhitespace(value).replace(/^["'“”‘’\s]+|["'“”‘’\s.!?;,]+$/g, '')
    && !MAP_ELEMENT_CLAUSE.test(label)
    && !/^(?:when|because|although|while|if|unless)\s+/iu.test(label)
    && normalizeMicroNodeLabel(label) === label
    && !MICRO_NODE_ABSTRACT_LABEL.test(label)
    && !MICRO_NODE_COORDINATED_ENTITY_NOUNS.test(label)
    && !MICRO_NODE_COORDINATED_PEOPLE.test(label));
}

// A model-assigned Macrosphere type is not enough to make a lower-level item
// into a broad condition. These deliberately narrow patterns catch forms that
// are unambiguously about an immediate actor or timetable while leaving broad
// conditions such as "Student debt" and "Unpredictable work schedules"
// available for review.
const LOWER_LEVEL_MACRO_ROLE_LABEL = /^(?:(?:working|home|center|school|community|care|case|service|support|peer|personal|family|student|teacher|classroom|workplace)\s+){0,3}(?:aides?|attendants?|caregivers?|counselors?|employees?|facilitators?|instructors?|librarians?|managers?|navigators?|parents?|participants?|people|persons?|residents?|social\s+workers?|students?|supervisors?|teachers?|therapists?|workers?)$/i;
const LOWER_LEVEL_MACRO_POSSESSIVE_SCHEDULE = /^(?:[\p{L}0-9.'’-]+(?:\s+[\p{L}0-9.'’-]+){0,3})['’]s\s+(?:availability|appointments?|hours?|schedules?|shifts?|workdays?|workweeks?)$/iu;
const LOWER_LEVEL_MACRO_ROLE_SCHEDULE = /^(?:(?:home|center|school|community|care|case|service|support|peer|personal)\s+){0,2}(?:aides?|attendants?|caregivers?|counselors?|employees?|facilitators?|instructors?|navigators?|students?|teachers?|therapists?|workers?)\s+(?:availability|appointments?|hours?|schedules?|shifts?|workdays?|workweeks?)$/i;
const LOWER_LEVEL_MACRO_IMMEDIATE_SCHEDULE = /^(?:care|class|course|home|service|therapy|workplace)\s+(?:appointments?|hours?|schedules?|shifts?)$/i;
const LOWER_LEVEL_MACRO_CLAUSE = /\S+\s+(?:am|are|can|could|did|does|facilitat(?:e|es|ed)|funds?|had|has|have|helps?|is|manages?|may|meets?|might|must|offers?|provides?|receives?|refers?|requests?|serves?|shall|should|supervises?|supports?|uses?|visits?|was|were|will|would)\s+\S+/i;

function obviousLowerLevelMacroKind(value) {
  if (typeof value !== 'string') return null;
  const label = normalizeWhitespace(value).replace(/^["'“”‘’\s]+|["'“”‘’\s.!?;,]+$/g, '');
  if (!label) return null;
  if (LOWER_LEVEL_MACRO_POSSESSIVE_SCHEDULE.test(label)
    || LOWER_LEVEL_MACRO_ROLE_SCHEDULE.test(label)
    || LOWER_LEVEL_MACRO_IMMEDIATE_SCHEDULE.test(label)) return 'schedule';
  if (LOWER_LEVEL_MACRO_ROLE_LABEL.test(label)) return 'role';
  if (LOWER_LEVEL_MACRO_CLAUSE.test(label)) return 'clause';
  return null;
}

export function isObviousLowerLevelMacroLabel(value) {
  return obviousLowerLevelMacroKind(value) !== null;
}

// A mesosystem label names the interrelation among immediate settings, not an
// institution, actor, or action. Requiring an explicit relational noun keeps
// entity-like phrases such as "CUNY administrative systems" from being
// accepted merely because they contain two words.
const MESOSYSTEM_RELATION_NOUN = /\b(?:alignment|breakdown|collaboration|communication|conflict|connection|coordination|cooperation|disconnect|exchange|gap|interface|interaction|interrelation|linkage|mesosystem|overlap|pattern|planning|plan|relationship|scheduling|tension|transition)\b/i;
const MESOSYSTEM_ENTITY_NOUN = /\b(?:administrative systems?|administrative units?|administrators?|agenc(?:y|ies)|bursars?|caregivers?|departments?|employers?|funders?|institutions?|instructors?|offices?|organizations?|parents?|people|persons?|programs?|registrars?|service providers?|service systems?|services?|students?|supervisors?|teachers?|workers?)\b/i;

export function isMesosystemLabel(value) {
  const label = cleanMicroNodeLabel(value);
  if (!label || normalizeMicroNodeLabel(label) !== label) return false;
  if (/(?:->|→|<-|←)/.test(label)) return false;
  if (isNamedInstitutionLabel(label) || MESOSYSTEM_ENTITY_NOUN.test(label)) return false;
  return label.split(/\s+/).length >= 2 && MESOSYSTEM_RELATION_NOUN.test(label);
}

function sentenceRecords(text) {
  assertString(text, 'submission.text', true, PROJECT_LIMITS.sourceText);
  const records = [];
  const occurrences = new Map();
  const pattern = /[^.!?]+[.!?]?/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const excerpt = normalizeWhitespace(match[0]);
    if (excerpt) {
      if (records.length >= PROJECT_LIMITS.sourceSentences) invalidProject('submission.text', `must contain no more than ${PROJECT_LIMITS.sourceSentences} sentence records`);
      const occurrence = (occurrences.get(excerpt) || 0) + 1;
      occurrences.set(excerpt, occurrence);
      records.push({ excerpt, occurrence, number: records.length + 1, start: match.index, end: match.index + match[0].length });
    }
  }
  return records;
}

function evidenceForSentence(submission, sentence) {
  if (!sentence) return null;
  const sourceId = submission.id || stableId('submission', `${submission.title || ''}:${submission.location || ''}`);
  const evidenceExcerpt = sentence.excerpt.length > PROJECT_LIMITS.evidenceExcerpt
    ? sentence.excerpt.slice(0, PROJECT_LIMITS.evidenceExcerpt)
    : sentence.excerpt;
  const evidenceHash = stableId('evh', evidenceExcerpt);
  return {
    evidence: `Memo sentence ${sentence.number}`,
    evidenceLocator: `Memo sentence ${sentence.number}`,
    evidenceExcerpt,
    evidenceHash,
    evidenceId: stableId('evidence', `${sourceId}:${evidenceHash}:${sentence.occurrence}`),
    sourceId,
  };
}

function locateEvidence(submission, pattern) {
  const sentence = sentenceRecords(submission.text || '').find((record) => {
    const matcher = new RegExp(pattern.source, pattern.flags.replace('g', ''));
    return matcher.test(record.excerpt);
  });
  return evidenceForSentence(submission, sentence);
}

function result(id, status, evidence, rationale, nextAction, hardBlock = false) {
  const evidenceRecord = evidence && typeof evidence === 'object' ? evidence : { evidence };
  return {
    id,
    status,
    ...evidenceRecord,
    evidence: evidenceRecord.evidence || 'No supporting passage located',
    rationale,
    missingVariable: status === 'met' ? null : rationale,
    nextAction,
    confidence: status === 'met' ? 0.92 : 0.58,
    hardBlock,
  };
}

const RELATION_DEFINITIONS = [
  { verb: 'depends on', pattern: '\\bdepends?\\s+on\\b' },
  { verb: 'coordinates with', pattern: '\\bcoordinates?\\s+with\\b' },
  { verb: 'works with', pattern: '\\bworks?\\s+with\\b' },
  { verb: 'reports to', pattern: '\\breports?\\s+to\\b' },
  { verb: 'located in', pattern: '\\b(?:is|are|was|were)?\\s*located\\s+in\\b' },
  { verb: 'regulates', pattern: '\\b(?:is|are|was|were)\\s+regulated\\s+by\\b', passive: true },
  { verb: 'corroborates', pattern: '\\b(?:is|are|was|were|should\\s+be|can\\s+be|may\\s+be)?\\s*checked\\s+against\\b' },
  { verb: 'provides', pattern: '\\bprovid(?:e|es)\\b' },
  { verb: 'funds', pattern: '\\bfunds?\\b' },
  { verb: 'regulates', pattern: '\\bregulat(?:e|es)\\b' },
  { verb: 'administers', pattern: '\\badministers?\\b' },
  { verb: 'requests', pattern: '\\brequests?\\b' },
  { verb: 'refers', pattern: '\\brefers?\\b' },
  { verb: 'serves', pattern: '\\bserves?\\b' },
  { verb: 'informs', pattern: '\\binforms?\\b' },
  { verb: 'sets rules for', pattern: '\\bsets?\\s+rules?\\s+for\\b' },
  { verb: 'qualifies', pattern: '\\bqualif(?:y|ies)\\b' },
  { verb: 'excludes', pattern: '\\bexcludes?\\b' },
  { verb: 'delays', pattern: '\\bdelays?\\b', nominalAfter: /\b(?:face|faces|faced|experience|experiences|experienced)\s+$/i },
  { verb: 'burdens', pattern: '\\bburdens?\\b' },
  { verb: 'enables', pattern: '\\benables?\\b' },
  { verb: 'measures', pattern: '\\bmeasures?\\b' },
  { verb: 'contests', pattern: '\\bcontests?\\b' },
  { verb: 'litigates', pattern: '\\blitigates?\\b' },
  { verb: 'supersedes', pattern: '\\bsupersedes?\\b' },
  { verb: 'defines eligibility for', pattern: '\\bdefines?\\s+eligibility\\s+for\\b' },
  { verb: 'mandates', pattern: '\\bmandates?\\b' },
  { verb: 'prohibits', pattern: '\\bprohibits?\\b' },
  { verb: 'prices', pattern: '\\bprices?\\b' },
  { verb: 'normalizes', pattern: '\\bnormalizes?\\b' },
  { verb: 'frames', pattern: '\\bframes?\\b' },
  { verb: 'constrains', pattern: '\\bconstrains?\\b' },
  { verb: 'privileges', pattern: '\\bprivileges?\\b' },
  { verb: 'shapes', pattern: '\\bshapes?\\b' },
  { verb: 'contradicts', pattern: '\\bcontradicts?\\b' },
  { verb: 'corroborates', pattern: '\\bcorroborates?\\b' },
  { verb: 'meets', pattern: '\\bmeets?\\b' },
  { verb: 'helps', pattern: '\\bhelps?\\b' },
  { verb: 'reviews', pattern: '\\breviews?\\b' },
  { verb: 'adjusts', pattern: '\\badjusts?\\b' },
  { verb: 'uses', pattern: '\\buses?\\b' },
  { verb: 'attends', pattern: '\\battends?\\b' },
  { verb: 'visits', pattern: '\\bvisits?\\b' },
  { verb: 'supervises', pattern: '\\bsupervises?\\b' },
];

function relationMatches(sentence) {
  const matches = RELATION_DEFINITIONS.flatMap((definition) => [...sentence.matchAll(new RegExp(definition.pattern, 'gi'))].map((match) => ({
    ...definition,
    index: match.index,
    end: match.index + match[0].length,
  })).filter((match) => !match.nominalAfter?.test(sentence.slice(0, match.index)))
    // A verb-shaped word with nothing after it is the tail of a name
    // ("City Adult Literacy Fund."), not a relationship claim.
    .filter((match) => /[a-z]{2,}/i.test(sentence.slice(match.end))))
    .sort((left, right) => left.index - right.index || right.end - right.index - (left.end - left.index));
  const nonOverlapping = [];
  matches.forEach((match) => {
    if (!nonOverlapping.some((accepted) => match.index < accepted.end && match.end > accepted.index)) nonOverlapping.push(match);
  });
  return nonOverlapping.sort((left, right) => left.index - right.index);
}

function displayLabel(value) {
  let label = normalizeWhitespace(value)
    .replace(/^(?:how|why|what|when|where)\s+(?:do|does|did|can|could|should|would|will|may|might|are|is|were|was)\s+/i, '')
    .replace(/^(?:and|or|but|while|whereas|although|because|that|which|who)\s+/i, '')
    .replace(/^(?:a|an|the|its|their|his|her|my|our|your|this|these|those)\s+/i, '')
    .replace(/\s+(?:and|or|but|which|that|who|is|are|was|were|may|might|can|could|should|would)$/i, '')
    .replace(/^[.!?,;:\-\s]+|[.!?,;:\-\s]+$/g, '');
  if (/^families$/i.test(label)) label = 'Family';
  return label.split(' ').map((word, index) => {
    if (/^[A-Z0-9]{2,}$/.test(word)) return word;
    if (index > 0 && /^(?:a|an|the|and|or|of|to|in|on|with|for|from|by)$/i.test(word)) return word.toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

function plausibleLabel(label) {
  if (!label || label.length < 2 || label.length > 200 || label.split(/\s+/).length > 24 || !/[a-z]/i.test(label)) return false;
  if (/\b(?:word|term|verb|phrase|token|list|relational claim)\b/i.test(label)) return false;
  return Boolean(normalizeMapElementLabel(label)) && !/^(?:something|anything)$/i.test(label);
}

function subjectsFromPrefix(prefix, fallback) {
  const clauses = prefix.split(/[,;:]\s*|\b(?:but|while|whereas|although|however)\b/i);
  const candidate = (clauses.at(-1) || '').trim();
  const distributed = candidate.match(/^(.+?)\s+(?:and|&)\s+(.+?)\s+both$/i);
  if (distributed) {
    const labels = distributed.slice(1).map((part) => normalizeMicroNodeLabel(displayLabel(part))).filter(Boolean);
    if (labels.length === 2 && labels[0].toLocaleLowerCase() !== labels[1].toLocaleLowerCase()) return labels;
  }
  const subject = subjectFromPrefix(prefix, fallback);
  return subject ? [subject] : [];
}

function stripTrailingTemporalAdjunct(value) {
  const candidate = String(value || '');
  const temporalAdjunct = candidate.match(/^\s*(.+?)\s+(?:on|at|during|every|each)\s+(.+?)\s*$/i);
  return temporalAdjunct && isTemporalOnlyMapElementLabel(displayLabel(temporalAdjunct[2]), true)
    ? temporalAdjunct[1]
    : candidate;
}

function subjectFromPrefix(prefix, fallback) {
  const clauses = prefix.split(/[,;:]\s*|\b(?:but|while|whereas|although|however)\b/i);
  let candidate = clauses.at(-1) || '';
  if (fallback && /\b(?:and|or)\s*$/i.test(candidate)) return fallback;
  const coordinated = candidate.match(/\b(?:and|or)\s+(.+)$/i);
  if (coordinated?.[1]) candidate = coordinated[1];
  const label = displayLabel(candidate);
  return plausibleLabel(label) ? label : fallback;
}

function objectFromSegment(segment, verb) {
  let candidate = segment.split(/[,;:]\s*(?:but|while|whereas|although|however)?/i)[0] || '';
  if (verb === 'refers' && /\bto\b/i.test(candidate)) candidate = candidate.split(/\bto\b/i).at(-1);
  if (verb === 'requests' && /\bfrom\b/i.test(candidate)) candidate = candidate.split(/\bfrom\b/i).at(-1);
  if (verb === 'informs' && /\babout\b/i.test(candidate)) candidate = candidate.split(/\babout\b/i)[0];
  // Time phrases qualify the interaction; they are not part of the actor,
  // setting, object, or resource at either endpoint. Keep place adjuncts such
  // as "Center on Lexington" while reducing "BMCC on Tuesdays" to "BMCC".
  candidate = stripTrailingTemporalAdjunct(candidate);
  const personWithSettingAdjunct = candidate.match(/^\s*([A-Z][\p{L}'’.-]+\s+[A-Z][\p{L}'’.-]+)\s+(?:at|in)\s+(?:the\s+)?[^,;:]+$/u);
  if (personWithSettingAdjunct) candidate = personWithSettingAdjunct[1];
  const label = displayLabel(candidate);
  return plausibleLabel(label) ? label : null;
}

function inferNodeType(label) {
  if (/^u\/[A-Za-z0-9_-]+$/i.test(label)) return 'person';
  if (/^r\/[A-Za-z0-9_-]+$/i.test(label)) return 'setting';
  if (UNAMBIGUOUS_INSTITUTION_LABEL.test(label) || OFFICIAL_INSTITUTION_ACRONYM.test(label)) return 'institution';
  if (/\b(?:digital-first|administrative structure|service-delivery structure)\b/i.test(label)) return 'structure';
  if (/\b(?:ableis[mt]|assumptions?|beliefs?|norms?)\b/i.test(label)) return 'belief';
  if (/\b(?:acts?|statutes?|ordinances?)\b/i.test(label)) return 'law';
  if (/\b(?:agenc(?:y|ies)|departments?|committees?|authorit(?:y|ies)|administrations?)\b/i.test(label)) return 'agency';
  if (/\b(?:classrooms?|campuses|campus|homes?|workplaces?|consultation rooms?|rooms?|digital labs?|labs?|libraries|peer groups?|peer-support groups?|online forums?|subreddits?)\b/i.test(label)) return 'setting';
  if (/\b(?:groups?|communities|peers?)\b/i.test(label)) return 'group';
  if (/\b(?:universit(?:y|ies)|colleges?|authorit(?:y|ies)|offices?|boards?|institutions?)\b/i.test(label)) return 'institution';
  if (/\b(?:organizations?|schools?|associations?|coalitions?)\b/i.test(label)) return 'organization';
  if (/\b(?:providers?|services?|programs?|clinics?|centers?)\b/i.test(label)) return 'service';
  if (/\b(?:polic(?:y|ies)|laws?|regulations?|statutes?|ordinances?|rules?)\b/i.test(label)) return 'policy';
  if (/\b(?:data|datasets?|surveys?|records?|reports?|evidence)\b/i.test(label)) return 'dataset';
  if (/\b(?:costs?|prices?|affordability|unemployment|labor market|housing market|economic pressure)\b/i.test(label)) return 'economic condition';
  if (/^(?:East Harlem|West Harlem|Central Harlem|The Bronx|Brooklyn|Queens|Manhattan|Staten Island)$/i.test(label)) return 'place';
  if (/\b(?:cities|city|counties|county|states?|neighbou?rhoods?|boroughs?|districts?|places?|regions?)\b/i.test(label)) return 'place';
  if (/\b(?:histor(?:y|ies|ical)|disinvestment|segregation)\b/i.test(label)) return 'history';
  if (/\b(?:culture|cultural norms?|public narratives?)\b/i.test(label)) return 'culture';
  if (/\b(?:registration|testing|scheduling|billing|processing|instruction|teaching|learning|employment|work)\b/i.test(label)) return 'activity';
  if (/\b(?:diplomas?|forms?|documents?|devices?|computers?|phones?|tablets?|wheelchairs?|schedules?|applications?|plans?|objects?)\b/i.test(label)) return 'object';
  if (/\b(?:abilit(?:y|ies)|supports?|funding|funds?|resources?|capacit(?:y|ies)|assets?|guidance|evaluations?|interviews?|eligibility|access|transit pass(?:es)?|fare cards?)\b/i.test(label)) return 'resource';
  if (/\bfamil(?:y|ies)\b/i.test(label)) return 'family';
  if (/\b(?:students?|caregivers?|parents?|teachers?|workers?|instructors?|registrars?|advisers?|advisors?)\b/i.test(label)) return 'role';
  if (/\b(?:adults?|persons?|people|participants?|residents?|children|child)\b/i.test(label)) return 'person';
  if (/^(?![A-Z]{2,}$)[A-Z][\p{L}'’-]{2,}$/u.test(label)) return 'person';
  if (/^[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){1,3}$/u.test(label)) return 'person';
  return 'event';
}

function inferScale(label, fallback = 'micro') {
  if (SOCIAL_HANDLE_LABEL.test(label)) return fallback;
  // Entity kind does not determine ecological placement. A college, clinic,
  // service, or agency can be an immediate Micro setting when the focal
  // person participates there, or an Exosphere decision setting when its
  // relevant action happens outside that person's immediate settings.
  if (isInstitutionScopedPolicyLabel(label)) return 'exosphere';
  if (/\b(?:culture|ideolog(?:y|ies)|capitalism|racism|structural|structures?|digital-first|public narratives?|histor(?:y|ies|ical)|rights?|laws?|acts?|regulations?|public polic(?:y|ies)|eligibility rules?|economic conditions?|costs?|ableis[mt]|assumptions?)\b/i.test(label)) return 'macrosphere';
  return fallback;
}

const DIRECT_PARTICIPATION_VERBS = new Set([
  'attends', 'visits', 'uses', 'meets', 'helps', 'receives', 'works with',
]);
const DIRECT_SERVICE_INTERACTION_VERBS = new Set(['provides', 'serves', 'refers', 'informs']);
const DIRECT_PARTICIPANT_NODE_TYPES = new Set(['person', 'role', 'group', 'family']);

function relationshipEndpointScales(sourceLabel, targetLabel, verb) {
  const sourceType = inferNodeType(sourceLabel);
  const targetType = inferNodeType(targetLabel);
  let sourceScale = inferScale(sourceLabel, 'micro');
  let targetScale = inferScale(targetLabel, 'micro');
  const normalizedVerb = String(verb || '').toLocaleLowerCase();
  const hasDirectParticipant = DIRECT_PARTICIPANT_NODE_TYPES.has(sourceType)
    || DIRECT_PARTICIPANT_NODE_TYPES.has(targetType);
  if (DIRECT_PARTICIPATION_VERBS.has(normalizedVerb)
    || (DIRECT_SERVICE_INTERACTION_VERBS.has(normalizedVerb) && hasDirectParticipant)) {
    if (sourceScale !== 'macrosphere') sourceScale = 'micro';
    if (targetScale !== 'macrosphere') targetScale = 'micro';
  } else if (scaleLexiconVerb('exosphere', verb)) {
    if (isNamedInstitutionLabel(sourceLabel)
      && ['organization', 'institution', 'agency', 'service', 'policy'].includes(sourceType)) sourceScale = 'exosphere';
    if (isNamedInstitutionLabel(targetLabel)
      && ['organization', 'institution', 'agency', 'service', 'policy'].includes(targetType)) targetScale = 'exosphere';
  }
  return { sourceScale, targetScale };
}

function extractedNodeClassification(label, fallbackScale) {
  let type = inferNodeType(label);
  let scale = inferScale(label, fallbackScale);
  if (scale === 'micro' && !MICRO_NODE_TYPES.includes(type)) {
    if (type === 'event') type = 'activity';
    else type = 'object';
  }
  if (scale === 'micro' && !isDiscreteMicroNodeLabel(label)) return null;
  if (scale === 'exosphere') {
    if (!isNamedInstitutionLabel(label)) return null;
    if (!EXOSPHERE_NODE_TYPES.includes(type)) type = 'institution';
  }
  if (scale === 'macrosphere' && !MACROSPHERE_NODE_TYPES.includes(type)) return null;
  return { type, scale };
}

export function extractRelationships(submission) {
  const relationships = [];
  sentenceRecords(submission.text || '').forEach((sentence) => {
    // A question frames the inquiry; it does not assert actors or claims, so
    // it never mints nodes or relationships ("How do programs shape access?").
    if (sentence.excerpt.trim().endsWith('?')) return;
    const matches = relationMatches(sentence.excerpt);
    let previousMatch = null;
    let currentSubject = null;
    matches.forEach((match, index) => {
      const prefix = sentence.excerpt.slice(previousMatch?.end || 0, match.index);
      const subjects = subjectsFromPrefix(prefix, currentSubject);
      const nextMatch = matches[index + 1];
      const rawObject = sentence.excerpt.slice(match.end, nextMatch?.index ?? sentence.excerpt.length);
      const object = objectFromSegment(rawObject, match.verb);
      const evidence = evidenceForSentence(submission, sentence);
      const normalizedObject = normalizeMicroNodeLabel(object);
      let acceptedSubject = null;
      subjects.forEach((subject) => {
        const normalizedSubject = normalizeMicroNodeLabel(subject);
        let sourceLabel = normalizedSubject;
        let targetLabel = normalizedObject;
        if (match.passive && normalizedSubject && normalizedObject) {
          sourceLabel = normalizedObject;
          targetLabel = normalizedSubject;
        }
        if (!sourceLabel || !targetLabel || sourceLabel.toLocaleLowerCase() === targetLabel.toLocaleLowerCase()) return;
        if (relationships.length >= PROJECT_LIMITS.edges) invalidProject('submission.text', `produces more than ${PROJECT_LIMITS.edges} relationship records`);
        const { sourceScale, targetScale } = relationshipEndpointScales(sourceLabel, targetLabel, match.verb);
        // Extraction keeps the endpoint classification. The active review
        // decides whether to propose nodes at Micro or relationships at Meso.
        const inferredScale = targetScale === 'exosphere' || targetScale === 'macrosphere' ? targetScale : sourceScale;
        relationships.push({
          sourceLabel,
          targetLabel,
          sourceScale,
          targetScale,
          verb: match.verb,
          scale: inferredScale,
          ...evidence,
        });
        acceptedSubject = normalizedSubject;
      });
      if (acceptedSubject) currentSubject = acceptedSubject;
      previousMatch = match;
    });
  });
  return relationships;
}

export function evaluateSubmission(submission, activeScale = 'micro', threshold = 6) {
  const text = (submission.text || '').trim();
  const relationships = extractRelationships({ ...submission, text });
  const mappedNodes = extractCandidates({ ...submission, text }).nodes;
  const hasRelational = relationships.length >= 2;
  const hasMicroNodes = mappedNodes.length >= 2;
  const hasMesoRelationships = relationships.length >= 1;
  const evidenceBoundary = locateEvidence({ ...submission, text }, /(according|data|interview|memo|reports?|shows?|evidence|testimony|should be checked)/i)
    || (submission.evidenceOwnership ? 'Memo and interpretation are tracked separately' : null);
  const hard = [
    result('H1', text.length >= 80 ? 'met' : 'unmet', text ? 'Memo text' : null, 'A usable memo needs enough detail to review.', 'Add more detail to the memo.', true),
    result('H2', !submission.sensitive || submission.consent ? 'met' : 'unmet', submission.sensitive ? 'Sensitivity declaration' : 'Marked non-sensitive', 'Sensitive material needs documented permission or a privacy-safe treatment.', 'Document permission or remove identifying details.', true),
    result('H3', evidenceBoundary ? 'met' : 'unmet', evidenceBoundary, 'At least one important point should name the evidence behind it.', 'Name the evidence behind one important point.', true),
    activeScale === 'micro'
      ? { ...result('H4', hasMicroNodes ? 'met' : 'unmet', mappedNodes[0]?.evidence || mappedNodes[0]?.evidenceLocator || null, 'Micro begins with at least two clearly named people, roles, activities, objects, or immediate settings.', 'Name at least two people, roles, activities, objects, or immediate settings that belong in the map.', true), nodeCount: mappedNodes.length }
      : activeScale === 'meso'
        ? { ...result('H4', hasMesoRelationships ? 'met' : 'unmet', hasMesoRelationships ? 'Memo describes a relationship between mapped elements' : null, 'Meso connects existing Micro nodes with evidence-backed relationships.', 'Name two mapped elements, their relationship, and its direction.', true), relationshipCount: relationships.length }
        : { ...result('H4', hasRelational ? 'met' : 'unmet', relationships[0] || null, 'This level needs at least two clear connections between map elements.', 'Add two statements naming what connects and how.', true), relationshipCount: relationships.length },
  ];

  const scalePatterns = {
    micro: /(family|person|student|experience|interview|caregiver)/i,
    meso: /(school|organization|agency|provider|committee|procedure)/i,
    exosphere: /(agency|office|department|service system|funding|funder|city|state)/i,
    macrosphere: /(policy|law|history|culture|belief|narrative|racism|capitalism|structure)/i,
  };

  const checks = [
    [/[?]|\b(how|why|what)\b/i, 'The memo states a question to explore.', 'State the question your memo helps you explore.'],
    [/(NYC Public Schools|New York State Education Department|Committee on Special Education|family|school|organization|agency)/i, 'Specific people, groups, or organizations are named.', 'Replace general labels with specific people, roles, groups, or organizations.'],
    [/(provides?|regulates?|administers?|refers?|delays?|burdens?|enables?|shapes?)/i, 'Clear verbs make connections visible.', 'Use a clear verb for each connection.'],
    [scalePatterns[activeScale], `The memo contains ${activeScale}-scale material.`, `Add evidence that belongs to the ${activeScale} scale.`],
    [/(according|data|interview|memo|reports?|shows?|evidence|testimony|should be checked)/i, 'Interpretation is tied to evidence.', 'Name what evidence supports the interpretation.'],
    [/(but|however|although|contradict|exclude|delay|burden|tension|despite)/i, 'A tension or contradiction is visible.', 'Name a tension, exclusion, or competing account.'],
    [/(resource|support|guidance|capacity|asset|provide|enable|organization)/i, 'The memo includes an asset or capacity.', 'Identify a resource, capacity, or enabling relationship.'],
    [/(may|might|could|uncertain|unknown|needs? research|should be checked|undercount|research lead)/i, 'Uncertainty is explicitly marked.', 'Mark what is uncertain or needs further research.'],
  ];

  const scored = SCORED_CRITERIA.map((criterion, index) => {
    const [pattern, rationale, nextAction] = checks[index];
    const evidence = locateEvidence(submission, pattern);
    return result(criterion.id, evidence ? 'met' : 'unmet', evidence, rationale, nextAction, false);
  });
  const hardPass = hard.every((criterion) => criterion.status === 'met');
  const score = scored.filter((criterion) => criterion.status === 'met').length;
  const outcome = !hardPass ? 'hold' : score >= threshold ? 'pass' : 'conditional';
  return { hard, scored, hardPass, score, threshold, outcome, evaluatedAt: new Date().toISOString() };
}

function defaultAnnotation(owner, kind) {
  return { id: stableId('annotation', `${owner}:${kind}`), text: '' };
}

function defaultNodeAnnotations(nodeId) {
  return {
    analytical: defaultAnnotation(`node:${nodeId}`, 'analytical'),
    evidence: defaultAnnotation(`node:${nodeId}`, 'evidence'),
  };
}

function defaultEdgeAnnotation(edgeId) {
  return defaultAnnotation(`edge:${edgeId}`, 'relationship');
}

function deterministicPositions(nodes) {
  const uniqueIds = [...new Set(nodes.map((node, index) => String(node?.id ?? `missing-${index}`)))].sort();
  const count = uniqueIds.length;
  return new Map(uniqueIds.map((id, index) => {
    if (count === 1) return [id, { x: DEFAULT_CANVAS.width / 2, y: DEFAULT_CANVAS.height / 2 }];
    const angle = (-Math.PI / 2) + (index / count) * Math.PI * 2;
    const radiusX = count < 4 ? 210 : DEFAULT_CANVAS.radiusX;
    const radiusY = count < 4 ? 130 : DEFAULT_CANVAS.radiusY;
    return [id, {
      x: Math.round(DEFAULT_CANVAS.width / 2 + Math.cos(angle) * radiusX),
      y: Math.round(DEFAULT_CANVAS.height / 2 + Math.sin(angle) * radiusY),
    }];
  }));
}

function layoutCandidates() {
  const columns = 4;
  const rows = 6;
  return Array.from({ length: columns * rows }, (_, index) => ({
    x: 75 + (index % columns) * 230,
    y: 45 + Math.floor(index / columns) * 90,
  }));
}

function positionsOverlap(a, b) {
  return Math.abs(a.x - b.x) < 218 && Math.abs(a.y - b.y) < 82;
}

export function withDefaultNodeLayout(nodes) {
  if (!Array.isArray(nodes)) invalidProject('nodes', 'must be an array');
  const positions = deterministicPositions(nodes);
  const hasExistingLayout = nodes.some((node) => Number.isFinite(node?.x) && Number.isFinite(node?.y));
  const candidates = hasExistingLayout ? layoutCandidates() : [];
  const occupied = [];
  return nodes.map((node, index) => {
    const nodeId = String(node?.id ?? `missing-${index}`);
    const currentPosition = Number.isFinite(node?.x) && Number.isFinite(node?.y)
      ? { x: node.x, y: node.y }
      : null;
    const position = !hasExistingLayout
      ? positions.get(nodeId)
      : currentPosition && !occupied.some((item) => positionsOverlap(currentPosition, item))
        ? currentPosition
        : candidates.find((candidate) => !occupied.some((item) => positionsOverlap(candidate, item)))
          || positions.get(nodeId);
    occupied.push(position);
    let annotations = node?.annotations;
    if (annotations === undefined) {
      annotations = defaultNodeAnnotations(nodeId);
    } else if (annotations && typeof annotations === 'object' && !Array.isArray(annotations)) {
      annotations = {
        ...annotations,
        analytical: annotations.analytical === undefined ? defaultAnnotation(`node:${nodeId}`, 'analytical') : annotations.analytical,
        evidence: annotations.evidence === undefined ? defaultAnnotation(`node:${nodeId}`, 'evidence') : annotations.evidence,
      };
    }
    return {
      ...node,
      ...(node?.scale === 'meso' && node?.mesoExplanation === undefined
        ? { mesoExplanation: '' }
        : {}),
      x: position.x,
      y: position.y,
      annotations,
    };
  });
}

function withDefaultEdgeAnnotations(edges) {
  if (!Array.isArray(edges)) return edges;
  return edges.map((edge, index) => {
    const edgeId = String(edge?.id ?? `missing-${index}`);
    return { ...edge, annotation: edge?.annotation === undefined ? defaultEdgeAnnotation(edgeId) : edge.annotation };
  });
}

const NODE_ONLY_COMMON_NOUN = /\b(?:famil(?:y|ies)|students?|parents?|caregivers?|teachers?|residents?|children|case\s+workers?|social\s+workers?|community\s+members?|classrooms?|schools?|community\s+centers?|clinics?|homes?|neighbou?rhoods?|programs?|organizations?|published\s+case\s+reports?)\b/gi;
const NODE_ONLY_PROPER_NOUN = /\b(?:[A-Z][A-Za-z'’.-]*|[A-Z]{2,}|\d+(?:st|nd|rd|th)?)(?:\s+(?:(?:of|for|and|the|in|at|on|with)\s+)?(?:[A-Z][A-Za-z'’.-]*|[A-Z]{2,}|\d+(?:st|nd|rd|th)?)){1,16}\b/g;
const NODE_ONLY_IGNORED_LABEL = /^(?:According to|Course Memo|Memo Sentence|This Memo|The Memo|What Evidence|No Evidence|Broader Conditions|Several Parts of the Map At Once|Institutions|One Another)$/i;

function nodeOnlyLabels(excerpt) {
  const properMatches = [...excerpt.matchAll(NODE_ONLY_PROPER_NOUN)];
  const commonMatches = [...excerpt.matchAll(NODE_ONLY_COMMON_NOUN)].filter((common) => !properMatches.some((proper) => (
    common.index >= proper.index && common.index + common[0].length <= proper.index + proper[0].length
  )));
  const labels = [...properMatches, ...commonMatches].map((match) => displayLabel(stripTrailingTemporalAdjunct(match[0])));
  return [...new Map(labels
    .filter((label) => plausibleLabel(label) && !NODE_ONLY_IGNORED_LABEL.test(label))
    .map((label) => [label.toLocaleLowerCase(), label])).values()];
}

export function extractCandidates(submission) {
  const nodeMap = new Map();
  const rawRelationships = extractRelationships(submission);
  const relationships = rawRelationships.flatMap((relationship) => {
    const sourceLabel = normalizeMicroNodeLabel(relationship.sourceLabel);
    const targetLabel = normalizeMicroNodeLabel(relationship.targetLabel);
    if (!sourceLabel || !targetLabel || sourceLabel.toLocaleLowerCase() === targetLabel.toLocaleLowerCase()) return [];
    return [{ ...relationship, sourceLabel, targetLabel }];
  });
  rawRelationships.forEach((relationship) => {
    [
      [relationship.sourceLabel, relationship.sourceScale],
      [relationship.targetLabel, relationship.targetScale],
    ].forEach(([rawLabel, endpointScale]) => {
      const label = normalizeMicroNodeLabel(rawLabel);
      if (!label) return;
      const key = label.toLowerCase();
      const evidenceRef = {
        evidenceId: relationship.evidenceId,
        sourceId: relationship.sourceId,
        evidenceLocator: relationship.evidenceLocator,
        evidenceExcerpt: relationship.evidenceExcerpt,
        evidenceHash: relationship.evidenceHash,
      };
      if (!nodeMap.has(key)) {
        // A cross-scale relationship keeps each endpoint in its own sphere:
        // an institutional target must not pull its Micro actors outward.
        const classification = extractedNodeClassification(label, endpointScale || relationship.scale);
        if (!classification) return;
        nodeMap.set(key, {
          id: stableId('node', label), label, ...classification,
          status: 'pending', claimState: 'inference', evidence: relationship.evidence,
          ...evidenceRef, evidenceRefs: [evidenceRef], notes: '',
        });
      } else {
        const node = nodeMap.get(key);
        if (!node.evidenceRefs.some((item) => item.evidenceId === evidenceRef.evidenceId)) node.evidenceRefs.push(evidenceRef);
      }
    });
  });
  // Node-only sentences and named elements that sit beside a relationship are
  // still eligible. This pass also prevents a whole clause from becoming a
  // node merely because another sentence contained a usable relationship.
  sentenceRecords(submission.text || '').forEach((sentence) => {
      if (sentence.excerpt.trim().endsWith('?')) return;
      const evidence = evidenceForSentence(submission, sentence);
      const evidenceRef = {
        evidenceId: evidence.evidenceId,
        sourceId: evidence.sourceId,
        evidenceLocator: evidence.evidenceLocator,
        evidenceExcerpt: evidence.evidenceExcerpt,
        evidenceHash: evidence.evidenceHash,
      };
      nodeOnlyLabels(sentence.excerpt).filter(isDiscreteMicroNodeLabel).forEach((label) => {
        const key = label.toLocaleLowerCase();
        if (!nodeMap.has(key)) {
          // A proper institutional name alone does not establish either
          // direct participation (Micro) or an outside decision pathway
          // (Exosphere). Keep it out of deterministic suggestions until a
          // memo-supported relationship supplies that placement evidence.
          const classification = extractedNodeClassification(label, 'micro');
          if (!classification) return;
          if (isNamedInstitutionLabel(label)
            && ['organization', 'institution', 'agency', 'service', 'policy'].includes(classification.type)) return;
          nodeMap.set(key, {
            id: stableId('node', label),
            label,
            ...classification,
            status: 'pending',
            claimState: 'inference',
            evidence: evidence.evidence,
            ...evidenceRef,
            evidenceRefs: [evidenceRef],
            notes: '',
          });
          return;
        }
        const node = nodeMap.get(key);
        const nodeOnlyClassification = extractedNodeClassification(label, 'micro');
        if (nodeOnlyClassification?.type === 'setting') {
          node.type = 'setting';
          node.scale = 'micro';
        }
        if (!node.evidenceRefs.some((item) => item.evidenceId === evidenceRef.evidenceId)) node.evidenceRefs.push(evidenceRef);
      });
    });
  if (nodeMap.size > PROJECT_LIMITS.nodes) invalidProject('submission.text', `produces more than ${PROJECT_LIMITS.nodes} node records`);
  const candidateNodes = [...nodeMap.values()];
  const nodes = withDefaultNodeLayout(candidateNodes.filter((candidate) => {
    if (candidate.label.trim().split(/\s+/).length !== 1 || ['institution', 'agency', 'organization'].includes(candidate.type)) return true;
    const token = candidate.label.trim().toLocaleLowerCase();
    return !candidateNodes.some((other) => other !== candidate && other.label.toLocaleLowerCase().split(/[^a-z0-9]+/).includes(token));
  }));
  const finalNodeIds = new Set(nodes.map((node) => node.id));
  const edgeMap = new Map();
  relationships.forEach((relationship) => {
    const sourceId = stableId('node', relationship.sourceLabel);
    const targetId = stableId('node', relationship.targetLabel);
    if (!finalNodeIds.has(sourceId) || !finalNodeIds.has(targetId)) return;
    const semanticKey = `${relationship.sourceLabel.toLowerCase()}:${relationship.verb}:${relationship.targetLabel.toLowerCase()}`;
    const evidenceRef = {
      evidenceId: relationship.evidenceId,
      sourceId: relationship.sourceId,
      evidenceLocator: relationship.evidenceLocator,
      evidenceExcerpt: relationship.evidenceExcerpt,
      evidenceHash: relationship.evidenceHash,
    };
    if (!edgeMap.has(semanticKey)) {
      edgeMap.set(semanticKey, {
        id: stableId('edge', `${relationship.sourceLabel}:${relationship.verb}:${relationship.targetLabel}`),
        source: sourceId,
        target: targetId,
        sourceLabel: relationship.sourceLabel,
        targetLabel: relationship.targetLabel,
        verb: relationship.verb,
        scale: relationship.scale,
        status: 'pending',
        claimState: 'student interpretation',
        directed: true,
        confidence: 0.82,
        rationale: `The memo states that ${relationship.sourceLabel} ${relationship.verb} ${relationship.targetLabel}.`,
        evidence: relationship.evidence,
        ...evidenceRef,
        evidenceRefs: [evidenceRef],
        notes: '',
        annotation: defaultEdgeAnnotation(stableId('edge', `${relationship.sourceLabel}:${relationship.verb}:${relationship.targetLabel}`)),
      });
    } else {
      const edge = edgeMap.get(semanticKey);
      if (!edge.evidenceRefs.some((item) => item.evidenceId === evidenceRef.evidenceId)) edge.evidenceRefs.push(evidenceRef);
    }
  });
  const edges = [...edgeMap.values()].map((edge) => ({
    ...edge,
    claimEvidence: normalizeClaimEvidenceRecords(edge),
  }));
  if (edges.length > PROJECT_LIMITS.edges) invalidProject('submission.text', `produces more than ${PROJECT_LIMITS.edges} relationship records`);
  return {
    nodes: nodes.map((node) => ({
      ...node,
      ...(node.scale === 'micro' ? {
        focalParticipation: node.focalParticipation || 'direct',
        settingNodeIds: Array.isArray(node.settingNodeIds) ? node.settingNodeIds : [],
      } : {}),
      claimEvidence: normalizeClaimEvidenceRecords(node),
    })),
    edges,
  };
}

const DETERMINISTIC_REVIEW_SCALE_LIMITS = MEMO_REVIEW_SCALE_LIMITS;

export function isMicroSettingNode(node) {
  return Boolean(node && node.scale === 'micro' && MICRO_SETTING_NODE_TYPES.includes(node.type));
}

export function isExosphereDecisionPathway(sourceNode, targetNode) {
  return Boolean(sourceNode?.scale === 'exosphere' && (isMicroSettingNode(targetNode) || targetNode?.scale === 'exosphere')
    && !(sourceNode.id && targetNode?.id && sourceNode.id === targetNode.id));
}

export function deterministicMemoReview(submission, activeScale = 'micro', { carriedNodes = [], carriedConnections = [] } = {}) {
  const scaleLimits = DETERMINISTIC_REVIEW_SCALE_LIMITS[activeScale] || DETERMINISTIC_REVIEW_SCALE_LIMITS.micro;
  const extracted = extractCandidates(submission);
  const memoSource = analyzeMemoSource(submission.text);
  const nodes = extracted.nodes.filter(node => !bibliographyOnlyLabel(node.label, memoSource) && !bibliographyOnlyEvidence(node.evidenceExcerpt, memoSource));
  const edges = extracted.edges.filter(edge => !bibliographyOnlyEvidence(edge.evidenceExcerpt, memoSource));
  const carriedNodeByLabel = new Map(carriedNodes.map((node) => [String(node.label || '').trim().toLocaleLowerCase(), node]));
  const carriedConnectionKeys = new Set(carriedConnections
    .map((connection) => `${connection.source}::${String(connection.verb || '').trim().toLocaleLowerCase()}::${connection.target}`));
  const activeTypePriority = (node) => {
    if (activeScale === 'micro') {
      if (node.type === 'person' && /^(?:adults?|people|persons?|participants?|residents?|children)$/i.test(node.label)) return 1;
      return { setting: 12, place: 11, institution: 10, organization: 9, service: 8, agency: 8, person: 7, role: 6, resource: 5, object: 4, activity: 3, group: 2, family: 1 }[node.type] || 0;
    }
    if (activeScale === 'exosphere') return Number(isNamedInstitutionLabel(node.label)) * 20 + ({ institution: 8, agency: 7, organization: 6, service: 5, policy: 4, resource: 3 }[node.type] || 0);
    if (activeScale === 'macrosphere') return { law: 8, policy: 7, 'economic condition': 6, history: 5, belief: 4, culture: 3, structure: 2 }[node.type] || 0;
    return 0;
  };
  const orderedNodes = [...nodes].sort((left, right) => (
    Number(right.scale === activeScale) - Number(left.scale === activeScale)
    || activeTypePriority(right) - activeTypePriority(left)
  ));
  // Elements already on the student's map never come back as new proposals;
  // later levels surface only what the memo adds beyond the carried graph.
  let reviewNodes = isRelationshipReviewScale(activeScale)
    ? []
    : orderedNodes
      .filter((node) => node.scale === activeScale || activeScale === 'exosphere' && node.scale === 'macrosphere')
      .filter((node) => !carriedNodeByLabel.has(node.label.trim().toLocaleLowerCase()))
      .filter((node) => isNodeTypeAllowedAtScale(node.type, activeScale))
      .filter((node) => activeScale !== 'micro' || (isDiscreteMicroNodeLabel(node.label) && !NODE_ONLY_IGNORED_LABEL.test(node.label)))
      .filter((node) => activeScale !== 'macrosphere' || (!labelRepeatsInstitution(node.label, carriedNodes) && !isObviousLowerLevelMacroLabel(node.label)))
      .map((node) => ({
        label: node.label,
        type: node.type,
        scale: activeScale,
        evidence: truncateCollapsedText(node.evidenceExcerpt || node.evidence || '', PROJECT_LIMITS.memoGuidanceEvidence),
        // The local reader only ever surfaces what the memo names.
        ...(activeScale === 'exosphere' || activeScale === 'macrosphere' ? { basis: 'memo' } : {}),
        ...(activeScale === 'macrosphere' ? {
          deontic: scaleLexiconVerb('macrosphere', relationMatches(String(node.evidenceExcerpt || ''))[0]?.verb) || 'shapes',
          scope: carriedNodes
            .filter((member) => member?.scale !== 'macrosphere' && String(node.evidenceExcerpt || '').toLocaleLowerCase().includes(String(member?.label || '').trim().toLocaleLowerCase()))
            .map(({ id, label }) => ({ id, label })),
        } : {}),
      }))
      .filter((node) => activeScale !== 'macrosphere' || node.scope.length >= 2)
      .slice(0, Math.min(scaleLimits.nodes, PROJECT_LIMITS.memoReviewNodes));
  const nodeLabels = new Set(reviewNodes.map((node) => node.label));
  const endpointFor = (label) => {
    const carried = carriedNodeByLabel.get(label.trim().toLocaleLowerCase());
    if (carried) return { reference: carried.id, label: carried.label, carried: true, node: carried };
    const proposed = reviewNodes.find((node) => node.label === label);
    return nodeLabels.has(label) && proposed ? { reference: label, label, carried: false, node: proposed } : null;
  };
  const connectionDetails = isNodeReviewScale(activeScale) ? [] : edges
    .filter((edge) => edge.scale === activeScale || (activeScale === 'meso' && edge.scale === 'micro') || activeScale === 'macrosphere')
    .map((edge) => {
      const source = endpointFor(edge.sourceLabel);
      const target = endpointFor(edge.targetLabel);
      if (!source || !target || source.reference === target.reference) return null;
      if (isRelationshipReviewScale(activeScale) && (!source.carried || !target.carried || !canConnectAtScale(activeScale, source.node) || !canConnectAtScale(activeScale, target.node))) return null;
      // An Exosphere connection is an influence pathway from an outside
      // decision setting into one immediate setting in which the focal person
      // participates. It is not a general institution-to-anything edge.
      if (activeScale === 'exosphere') {
        const sourceIsDecisionSetting = source.node?.scale === 'exosphere';
        const targetIsDecisionSetting = target.node?.scale === 'exosphere';
        const sourceIsImmediateSetting = source.carried && isMicroSettingNode(source.node);
        const targetIsImmediateSetting = target.carried && isMicroSettingNode(target.node);
        if (!((sourceIsDecisionSetting && targetIsImmediateSetting)
          || (targetIsDecisionSetting && sourceIsImmediateSetting)
          || (sourceIsDecisionSetting && targetIsDecisionSetting))) return null;
      }
      const verb = edge.verb;
      if (!verb) return null;
      return { edge, source: { id: source.reference, label: source.label }, target: { id: target.reference, label: target.label }, verb };
    })
    .filter(Boolean)
    // Relationships already on the student's map are settled; the review only
    // surfaces what this memo pass adds.
    .filter(({ edge, source, target, verb }) => !carriedConnectionKeys.has(`${source.id}::${(verb || edge.verb).trim().toLocaleLowerCase()}::${target.id}`))
    .slice(0, Math.min(scaleLimits.connections || PROJECT_LIMITS.memoReviewConnections, PROJECT_LIMITS.memoReviewConnections))
    .map(({ edge, source, target, verb }) => ({
      source: source.id,
      target: target.id,
      sourceLabel: source.label,
      targetLabel: target.label,
      verb: verb || edge.verb,
      rationale: truncateCollapsedText(edge.evidenceExcerpt || edge.rationale || '', PROJECT_LIMITS.rationaleText),
    }));
  const connections = connectionDetails.map(({ sourceLabel, targetLabel, ...connection }) => connection);
  const guidance = activeScale === 'micro'
    ? [...(reviewNodes.length ? [{
      point: 'Check these items against the memo',
      ...(reviewNodes[0].evidence ? { evidenceExcerpt: truncateCollapsedText(reviewNodes[0].evidence, PROJECT_LIMITS.memoGuidanceEvidence) } : {}),
    }] : []), ...connectionDetails.slice(0, 2).map((connection) => ({
      point: truncateCollapsedText(`${connection.sourceLabel} ${connection.verb} ${connection.targetLabel}`, PROJECT_LIMITS.memoGuidanceText),
      ...(connection.rationale ? { evidenceExcerpt: truncateCollapsedText(connection.rationale, PROJECT_LIMITS.memoGuidanceEvidence) } : {}),
    }))]
    : activeScale === 'meso'
      ? connectionDetails.slice(0, 3).map((connection) => ({
        point: truncateCollapsedText(`${connection.sourceLabel} ${connection.verb} ${connection.targetLabel}`, PROJECT_LIMITS.memoGuidanceText),
        ...(connection.rationale ? { evidenceExcerpt: truncateCollapsedText(connection.rationale, PROJECT_LIMITS.memoGuidanceEvidence) } : {}),
      }))
      : connectionDetails.slice(0, 2).map((connection) => ({
      point: truncateCollapsedText(`${connection.sourceLabel} ${connection.verb} ${connection.targetLabel}`, PROJECT_LIMITS.memoGuidanceText),
      ...(connection.rationale ? { evidenceExcerpt: truncateCollapsedText(connection.rationale, PROJECT_LIMITS.memoGuidanceEvidence) } : {}),
      }));
  // The outer levels are produced by elicitation, not extraction: the memo
  // rarely names the institutions and structures behind it, so the review
  // walks the standard categories the way an eco-map instrument does.
  if (activeScale === 'exosphere') {
    guidance.push({ point: 'Identify outside decisions affecting mapped settings' });
  }
  if (activeScale === 'macrosphere') {
    guidance.push({ point: 'Connect broader conditions to affected map items' });
  }
  if (!guidance.length) {
    guidance.push({ point: activeScale === 'micro'
      ? 'Add an item supported by the memo'
      : activeScale === 'meso'
        ? 'Connect two mapped settings'
        : 'Add a supported connection' });
  }
  const first = connectionDetails[0] || null;
  const example = first
    ? truncateCollapsedText(`${first.sourceLabel} ${first.verb} ${first.targetLabel}. ${first.rationale || ''}`, PROJECT_LIMITS.memoReviewExample)
    : null;
  // Carried map elements count toward readiness at Exosphere. A Macrosphere
  // item is ready only when the memo supports at least two affected elements.
  const ready = activeScale === 'meso'
    ? connections.length >= 1
    : activeScale === 'micro'
      ? reviewNodes.length + carriedNodes.length >= 2
      : activeScale === 'macrosphere'
        ? reviewNodes.length >= 1
        : (reviewNodes.length + carriedNodes.length) >= 2 && connections.length >= 1;
  const readiness = {
    ready,
    note: ready ? 'Map is ready' : 'Review needs more evidence',
  };
  return { guidance, nodes: reviewNodes, connections, example: null, readiness };
}

export function createEvent(action, detail, actor = 'student', metadata = {}) {
  return {
    ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
    id: stableId('evt', `${Date.now()}:${Math.random()}:${action}:${detail}`),
    action,
    detail,
    actor,
    at: new Date().toISOString(),
  };
}

const preflightConfig = {
  id: 'preflight-grounded-v1',
  profileVersion: '1.0.0',
  outputSchemaVersion: 'systems-mapping.preflight-result.v1',
  label: 'Grounded suggestion model',
  provider: 'local-deterministic',
  baseModel: 'STEM Splitter',
  fixedPrompt: BASE_GUARDRAILS,
  customInstructions: 'Ask one focused question at a time. Treat sensitive material as private until documented otherwise.',
  contextLimit: 32000,
  confidenceThreshold: 0.72,
  relationVocabulary: [...RELATION_VOCABULARY],
  revision: 1,
  changeNote: 'CALI 2026 starting configuration',
  history: [],
};

const builderConfig = {
  id: 'graph-builder-v1',
  profileVersion: '1.0.0',
  outputSchemaVersion: 'systems-mapping.graph-operations.v1',
  label: 'Map builder',
  provider: 'local-deterministic',
  baseModel: 'STEM Splitter',
  fixedPrompt: `${BASE_GUARDRAILS}\nBuild one cumulative map. Micro identifies local people, groups, resources and settings as nodes. Meso connects existing Micro nodes with directional relationships. Exo adds larger-scale institutions, resources, policies and conditions as nodes. Macro connects those larger-scale nodes and may connect them to earlier local nodes. Preserve carried IDs, positions, evidence and notes. Propose nodes only at Micro and Exo, relationships only at Meso and Macro. Never add suggestions without the student's explicit decision.`,
  customInstructions: 'Use Ecological Systems Theory as an organizing lens. Guide with questions rather than supplying conclusions.',
  contextLimit: 32000,
  confidenceThreshold: 0.72,
  relationVocabulary: [...RELATION_VOCABULARY],
  revision: 1,
  changeNote: 'Legacy Systems and Assets Builder profile, privacy hardened',
  history: [],
};

export function createDefaultProject() {
  const now = new Date().toISOString();
  const preflight = cloneProject(preflightConfig);
  const builder = cloneProject(builderConfig);
  const submission = {
    id: 'submission_demo_01',
    title: 'Access to special-education services in NYC',
    author: 'Student researcher',
    date: '2026-08-05',
    sourceType: 'course material',
    location: 'CALI Thinkering 2026 / local demonstration',
    rights: 'Course use only',
    sensitive: false,
    consent: false,
    evidenceOwnership: 'What the memo says and what the student thinks it means are labeled separately',
    text: DEFAULT_MEMO,
  };
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: 'project_cali_demo',
    title: 'NYC systems and assets map',
    participantName: '',
    inquiry: 'How do systems shape access to special-education services in NYC?',
    activeScale: 'micro',
    releasedScales: ['micro'],
    completedScales: [],
    stage: 0,
    levelProgress: createLevelProgress({ activeScale: 'micro', stage: 0, reflection: '' }),
    sharingTier: 'private',
    createdAt: now,
    updatedAt: now,
    submission,
    configs: {
      preflight: { ...preflight, fingerprint: configFingerprint(preflight) },
      builder: { ...builder, fingerprint: configFingerprint(builder) },
    },
    instructor: {
      readinessThreshold: 6,
      hardGatesRequired: true,
      evidenceRequired: true,
      maxSharingTier: 'course',
      releaseMode: 'open',
      requireStudentConfirmation: false,
      allowResearchLeads: true,
    },
    preflight: null,
    candidates: { nodes: [], edges: [] },
    graph: { nodes: [], edges: [] },
    viewport: { ...DEFAULT_VIEWPORT },
    mapAnnotation: defaultAnnotation('project_cali_demo', 'map'),
    reflection: '',
    events: [createEvent('project.created', 'Started from the CALI 2026 local demonstration')],
  };
}

const SHARING_TIERS = ['private', 'course', 'CUNY', 'public'];
const CANDIDATE_STATUSES = ['pending', 'confirmed', 'research lead', 'rejected'];
const PREFLIGHT_REVIEW_STATUSES = ['pending', 'approved', 'rejected'];
const PREFLIGHT_REVIEW_DECISIONS = ['approve', 'revise_and_approve', 'reject'];
const PREFLIGHT_RUNTIME_PROVIDERS = ['deterministic', 'source-check', 'ollama-cloud', 'openrouter', 'cail-gateway'];
const PREFLIGHT_RUNTIME_INTEGER_FIELDS = [
  'totalDurationNs', 'loadDurationNs', 'promptEvalCount', 'promptEvalDurationNs',
  'evalCount', 'evalDurationNs', 'correctiveRetries', 'evidenceRepairAttempts',
];
const FORBIDDEN_PROJECT_KEYS = new Set([
  'password', 'passwordhash', 'passwordsalt', 'passphrase', 'apikey', 'secret', 'secrettoken',
  'accesstoken', 'refreshtoken', 'authorization', 'cookie', 'sessiontoken', 'accessgrant',
  'oauth', 'userid', 'accountid', 'emailaddress', 'classcode', 'studentcode',
]);

const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const EVIDENCE_KEYS = ['evidence', 'evidenceLocator', 'evidenceExcerpt', 'evidenceHash', 'evidenceId', 'sourceId', 'evidenceRefs'];
const CLAIM_EVIDENCE_PROVENANCE_FIELDS = ['evidenceId', 'sourceId', 'evidenceLocator', 'evidenceHash'];
const CLAIM_EVIDENCE_KEYS = ['id', ...CLAIM_EVIDENCE_FIELDS, ...CLAIM_EVIDENCE_PROVENANCE_FIELDS];
const PROJECT_KEYS = ['schemaVersion', 'id', 'title', 'participantName', 'inquiry', 'activeScale', 'releasedScales', 'completedScales', 'stage', 'furthestStage', 'levelProgress', 'sharingTier', 'createdAt', 'updatedAt', 'submission', 'configs', 'instructor', 'teacherGovernance', 'preflight', 'candidates', 'graph', 'viewport', 'layout', 'mapAnnotation', 'reflection', 'events', 'exportedAt', 'portableExport'];
const SUBMISSION_KEYS = ['id', 'title', 'author', 'date', 'sourceType', 'location', 'rights', 'sensitive', 'consent', 'evidenceOwnership', 'text', 'fileName', 'fileSize', 'revision', 'fingerprint'];
const CONFIG_KEYS = ['id', 'profileVersion', 'outputSchemaVersion', 'label', 'provider', 'baseModel', 'fixedPrompt', 'customInstructions', 'contextLimit', 'confidenceThreshold', 'relationVocabulary', 'revision', 'changeNote', 'history', 'fingerprint'];
const NODE_KEYS = ['id', 'label', 'type', 'scale', 'status', 'claimState', 'notes', 'x', 'y', 'annotations', 'sourceFingerprint', 'basis', 'deontic', 'scopeNodeIds', 'mesoExplanation', 'claimEvidence', 'origin', 'reviewDecision', 'settingNodeIds', 'focalParticipation', ...EVIDENCE_KEYS];
const EDGE_KEYS = ['id', 'source', 'target', 'sourceLabel', 'targetLabel', 'verb', 'scale', 'status', 'claimState', 'notes', 'directed', 'confidence', 'rationale', 'annotation', 'sourceFingerprint', 'claimEvidence', 'relationshipProcess', 'origin', 'reviewDecision', ...EVIDENCE_KEYS];

function invalidProject(path, expectation) {
  throw new Error(`Invalid Systems Mapping project: ${path} ${expectation}.`);
}

function assertObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidProject(path, 'must be an object');
}

function assertKnownKeys(value, allowed, path) {
  const allowedKeys = new Set(allowed);
  Object.keys(value).forEach((key) => {
    if (!allowedKeys.has(key)) invalidProject(`${path}.${key}`, 'is not an allowed schema field');
  });
}

function assertString(value, path, allowEmpty = true, maximum = PROJECT_LIMITS.metadataText) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) invalidProject(path, `must be ${allowEmpty ? 'a string' : 'a non-empty string'}`);
  if (value.length > maximum) invalidProject(path, `must contain no more than ${maximum} characters`);
}

function assertTimestamp(value, path) {
  assertString(value, path, false, 100);
  if (Number.isNaN(Date.parse(value))) invalidProject(path, 'must be a valid timestamp string');
}

function assertBoolean(value, path) {
  if (typeof value !== 'boolean') invalidProject(path, 'must be a boolean');
}

function assertFiniteNumber(value, path, minimum = -Infinity, maximum = Infinity) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) invalidProject(path, `must be a finite number from ${minimum} to ${maximum}`);
}

function assertInteger(value, path, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) invalidProject(path, `must be an integer from ${minimum} to ${maximum}`);
}

function assertEnum(value, allowed, path) {
  if (!allowed.includes(value)) invalidProject(path, `must be one of: ${allowed.join(', ')}`);
}

function assertUniqueIds(records, path) {
  const ids = new Set();
  records.forEach((record, index) => {
    assertObject(record, `${path}[${index}]`);
    assertString(record.id, `${path}[${index}].id`, false, 200);
    if (ids.has(record.id)) invalidProject(`${path}[${index}].id`, `duplicates ${record.id}`);
    ids.add(record.id);
  });
  return ids;
}

function assertSafeProjectStructure(value) {
  const stack = [{ value, path: 'project', depth: 0, ancestors: [] }];
  let work = 0;
  while (stack.length) {
    const current = stack.pop();
    work += 1;
    if (work > PROJECT_LIMITS.traversalWork) invalidProject('project', `must contain no more than ${PROJECT_LIMITS.traversalWork} traversed values`);
    if (current.depth > PROJECT_LIMITS.nestingDepth) invalidProject(current.path, `must not exceed ${PROJECT_LIMITS.nestingDepth} levels of nesting`);
    if (typeof current.value === 'string') {
      if (current.value.length > PROJECT_LIMITS.genericText) invalidProject(current.path, `must contain no more than ${PROJECT_LIMITS.genericText} characters`);
      continue;
    }
    if (typeof current.value === 'number' && !Number.isFinite(current.value)) invalidProject(current.path, 'must be a finite number');
    if (!current.value || typeof current.value !== 'object') continue;
    if (current.ancestors.includes(current.value)) invalidProject(current.path, 'must not contain cyclic object references');
    const ancestors = [...current.ancestors, current.value];
    if (Array.isArray(current.value)) {
      if (current.value.length > PROJECT_LIMITS.genericCollection) invalidProject(current.path, `must contain no more than ${PROJECT_LIMITS.genericCollection} items`);
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value[index], path: `${current.path}[${index}]`, depth: current.depth + 1, ancestors });
      }
      continue;
    }
    const entries = Object.entries(current.value);
    if (entries.length > PROJECT_LIMITS.objectKeys) invalidProject(current.path, `must contain no more than ${PROJECT_LIMITS.objectKeys} keys`);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      if (key.length > 100) invalidProject(current.path, 'contains an oversized key');
      const childPath = `${current.path}.${key}`;
      if (DANGEROUS_OBJECT_KEYS.has(key)) invalidProject(childPath, 'contains an unsafe object key');
      const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
      if (FORBIDDEN_PROJECT_KEYS.has(normalized)) invalidProject(childPath, 'contains a credential or unrelated account field');
      stack.push({ value: child, path: childPath, depth: current.depth + 1, ancestors });
    }
  }
}

function validateEvidence(record, path, referenceOnly = false) {
  if (referenceOnly) assertKnownKeys(record, EVIDENCE_KEYS, path);
  ['evidence', 'evidenceLocator', 'evidenceExcerpt', 'evidenceHash', 'evidenceId', 'sourceId'].forEach((field) => {
    if (record[field] !== undefined) {
      const maximum = field === 'evidenceExcerpt' ? PROJECT_LIMITS.evidenceExcerpt : field.endsWith('Id') || field === 'evidenceHash' ? 200 : PROJECT_LIMITS.metadataText;
      assertString(record[field], `${path}.${field}`, true, maximum);
    }
  });
  if (record.evidenceExcerpt && record.evidenceHash && stableId('evh', record.evidenceExcerpt) !== record.evidenceHash) {
    invalidProject(`${path}.evidenceHash`, 'does not match the evidence excerpt');
  }
  if (record.evidenceRefs !== undefined) {
    if (!Array.isArray(record.evidenceRefs)) invalidProject(`${path}.evidenceRefs`, 'must be an array');
    if (record.evidenceRefs.length > PROJECT_LIMITS.evidenceRefs) invalidProject(`${path}.evidenceRefs`, `must contain no more than ${PROJECT_LIMITS.evidenceRefs} items`);
    record.evidenceRefs.forEach((reference, index) => {
      assertObject(reference, `${path}.evidenceRefs[${index}]`);
      validateEvidence(reference, `${path}.evidenceRefs[${index}]`, true);
    });
  }
}

function validateClaimEvidence(records, path) {
  if (records === undefined) return;
  if (!Array.isArray(records)) invalidProject(path, 'must be an array');
  if (records.length > PROJECT_LIMITS.claimEvidenceRecords) {
    invalidProject(path, `must contain no more than ${PROJECT_LIMITS.claimEvidenceRecords} claim evidence records`);
  }
  const ids = new Set();
  records.forEach((record, index) => {
    const itemPath = `${path}[${index}]`;
    assertObject(record, itemPath);
    assertKnownKeys(record, CLAIM_EVIDENCE_KEYS, itemPath);
    assertString(record.id, `${itemPath}.id`, false, 200);
    if (ids.has(record.id)) invalidProject(`${itemPath}.id`, `duplicates ${record.id}`);
    ids.add(record.id);
    CLAIM_EVIDENCE_FIELDS.forEach((field) => {
      const maximum = field === 'sourcePassage'
        ? PROJECT_LIMITS.evidenceExcerpt
        : PROJECT_LIMITS.claimEvidenceText;
      assertString(record[field], `${itemPath}.${field}`, true, maximum);
    });
    CLAIM_EVIDENCE_PROVENANCE_FIELDS.forEach((field) => {
      if (record[field] !== undefined) {
        const maximum = field === 'evidenceLocator' ? PROJECT_LIMITS.metadataText : 200;
        assertString(record[field], `${itemPath}.${field}`, true, maximum);
      }
    });
    if (record.sourcePassage && record.evidenceHash
      && stableId('evh', record.sourcePassage) !== record.evidenceHash) {
      invalidProject(`${itemPath}.evidenceHash`, 'does not match the memo passage');
    }
  });
}

function validateRelationshipProcess(process, path) {
  if (process === undefined) return;
  assertObject(process, path);
  assertKnownKeys(process, RELATIONSHIP_PROCESS_FIELDS, path);
  RELATIONSHIP_PROCESS_TEXT_FIELDS.forEach((field) => {
    if (process[field] !== undefined) assertString(process[field], `${path}.${field}`, true, PROJECT_LIMITS.relationshipProcessText);
  });
  if (process.strength !== undefined) assertEnum(process.strength, RELATIONSHIP_STRENGTHS, `${path}.strength`);
  if (process.connectionStatus !== undefined) assertEnum(process.connectionStatus, RELATIONSHIP_STATUSES, `${path}.connectionStatus`);
  if (process.familyCount !== undefined && process.familyCount !== null) assertInteger(process.familyCount, `${path}.familyCount`, 0, Number.MAX_SAFE_INTEGER);
}

function validateLevelProgress(levelProgress, path) {
  assertObject(levelProgress, path);
  assertKnownKeys(levelProgress, SCALE_ORDER, path);
  SCALE_ORDER.forEach((scale) => {
    const itemPath = `${path}.${scale}`;
    if (!Object.hasOwn(levelProgress, scale)) invalidProject(itemPath, 'is required');
    assertObject(levelProgress[scale], itemPath);
    assertKnownKeys(levelProgress[scale], ['stage', 'reflection'], itemPath);
    assertInteger(levelProgress[scale].stage, `${itemPath}.stage`, 0, 4);
    assertString(levelProgress[scale].reflection, `${itemPath}.reflection`, true, PROJECT_LIMITS.promptText);
  });
}

function validateAnnotation(annotation, path, owner, annotationOwners) {
  assertObject(annotation, path);
  assertKnownKeys(annotation, ['id', 'text'], path);
  assertString(annotation.id, `${path}.id`, false, 200);
  assertString(annotation.text, `${path}.text`, true, PROJECT_LIMITS.annotationText);
  const priorOwner = annotationOwners.byId.get(annotation.id);
  if (priorOwner && priorOwner !== owner) invalidProject(`${path}.id`, `duplicates an annotation owned by ${priorOwner}`);
  const priorId = annotationOwners.byOwner.get(owner);
  if (priorId && priorId !== annotation.id) invalidProject(`${path}.id`, `must remain ${priorId} for ${owner}`);
  annotationOwners.byId.set(annotation.id, owner);
  annotationOwners.byOwner.set(owner, annotation.id);
}

function validateNodeCollection(nodes, path, annotationOwners) {
  if (!Array.isArray(nodes)) invalidProject(path, 'must be an array');
  if (nodes.length > PROJECT_LIMITS.nodes) invalidProject(path, `must contain no more than ${PROJECT_LIMITS.nodes} nodes`);
  const ids = assertUniqueIds(nodes, path);
  nodes.forEach((node, index) => {
    const itemPath = `${path}[${index}]`;
    assertKnownKeys(node, NODE_KEYS, itemPath);
    assertString(node.label, `${itemPath}.label`, false, 200);
    assertEnum(node.type, NODE_TYPES, `${itemPath}.type`);
    assertEnum(node.scale, SCALE_ORDER, `${itemPath}.scale`);
    if (node.scale === 'meso' && node.type !== MESOSYSTEM_NODE_TYPE) invalidProject(`${itemPath}.type`, `must be ${MESOSYSTEM_NODE_TYPE} for a Meso node`);
    if (node.type === MESOSYSTEM_NODE_TYPE && node.scale !== 'meso') invalidProject(`${itemPath}.scale`, 'must be Meso for a mesosystem node');
    if (!isNodeTypeAllowedAtScale(node.type, node.scale)) invalidProject(`${itemPath}.type`, `is not allowed at ${SCALES[node.scale]?.label || node.scale}`);
    if (node.type === MESOSYSTEM_NODE_TYPE && !isMesosystemLabel(node.label)) invalidProject(`${itemPath}.label`, 'must be a noun label without a relationship verb');
    assertEnum(node.status, CANDIDATE_STATUSES, `${itemPath}.status`);
    assertEnum(node.claimState, CLAIM_STATES, `${itemPath}.claimState`);
    assertString(node.notes ?? '', `${itemPath}.notes`, true, PROJECT_LIMITS.noteText);
    assertFiniteNumber(node.x, `${itemPath}.x`, PROJECT_LIMITS.coordinateMin, PROJECT_LIMITS.coordinateMax);
    assertFiniteNumber(node.y, `${itemPath}.y`, PROJECT_LIMITS.coordinateMin, PROJECT_LIMITS.coordinateMax);
    assertObject(node.annotations, `${itemPath}.annotations`);
    assertKnownKeys(node.annotations, ['analytical', 'evidence'], `${itemPath}.annotations`);
    validateAnnotation(node.annotations.analytical, `${itemPath}.annotations.analytical`, `node:${node.id}:analytical`, annotationOwners);
    validateAnnotation(node.annotations.evidence, `${itemPath}.annotations.evidence`, `node:${node.id}:evidence`, annotationOwners);
    if (node.sourceFingerprint !== undefined) assertString(node.sourceFingerprint, `${itemPath}.sourceFingerprint`, false, 200);
    if (node.basis !== undefined) assertEnum(node.basis, NODE_BASES, `${itemPath}.basis`);
    if (node.origin !== undefined) assertEnum(node.origin, NODE_ORIGINS, `${itemPath}.origin`);
    if (node.reviewDecision !== undefined) assertEnum(node.reviewDecision, REVIEW_DECISIONS, `${itemPath}.reviewDecision`);
    if (node.focalParticipation !== undefined) assertEnum(node.focalParticipation, FOCAL_PARTICIPATION_STATES, `${itemPath}.focalParticipation`);
    if (node.settingNodeIds !== undefined) {
      if (!Array.isArray(node.settingNodeIds) || node.settingNodeIds.length > PROJECT_LIMITS.scopeMembers) {
        invalidProject(`${itemPath}.settingNodeIds`, `must be an array of no more than ${PROJECT_LIMITS.scopeMembers} node ids`);
      }
      const seenSettings = new Set();
      node.settingNodeIds.forEach((memberId, memberIndex) => {
        assertString(memberId, `${itemPath}.settingNodeIds[${memberIndex}]`, false, 200);
        if (seenSettings.has(memberId)) invalidProject(`${itemPath}.settingNodeIds[${memberIndex}]`, 'must be unique');
        seenSettings.add(memberId);
        if (memberId === node.id) invalidProject(`${itemPath}.settingNodeIds[${memberIndex}]`, 'cannot include the item itself');
      });
    }
    if (node.deontic !== undefined) assertString(node.deontic, `${itemPath}.deontic`, true, 60);
    if (node.deontic !== undefined && node.scale !== 'macrosphere') invalidProject(`${itemPath}.deontic`, 'is only allowed on a Macrosphere item');
    if (node.mesoExplanation !== undefined) {
      assertString(node.mesoExplanation, `${itemPath}.mesoExplanation`, true, PROJECT_LIMITS.noteText);
      if (node.scale !== 'meso' && node.mesoExplanation.trim()) {
        invalidProject(`${itemPath}.mesoExplanation`, 'is only allowed on a Meso item unless empty');
      }
    }
    if (node.scopeNodeIds !== undefined && !['meso', 'macrosphere'].includes(node.scale)) invalidProject(`${itemPath}.scopeNodeIds`, 'is only allowed on Meso and Macrosphere items');
    if (node.scopeNodeIds !== undefined) {
      if (!Array.isArray(node.scopeNodeIds) || node.scopeNodeIds.length > PROJECT_LIMITS.scopeMembers) {
        invalidProject(`${itemPath}.scopeNodeIds`, `must be an array of no more than ${PROJECT_LIMITS.scopeMembers} node ids`);
      }
      const seenScope = new Set();
      node.scopeNodeIds.forEach((memberId, memberIndex) => {
        assertString(memberId, `${itemPath}.scopeNodeIds[${memberIndex}]`, false, 200);
        if (seenScope.has(memberId)) invalidProject(`${itemPath}.scopeNodeIds[${memberIndex}]`, 'must be unique');
        seenScope.add(memberId);
        if (memberId === node.id) invalidProject(`${itemPath}.scopeNodeIds[${memberIndex}]`, 'cannot include the structure itself');
      });
    }
    const nodeIsLive = (node.status === 'confirmed' || node.status === 'research lead') && node.claimState !== 'retired';
    if (nodeIsLive && containsRetiredSystemsLanguage(node.label)) invalidProject(`${itemPath}.label`, 'must use a literal, conventional name for the map element');
    const canonicalLabel = normalizeMapElementLabel(node.label, { micro: node.scale === 'micro' });
    if (nodeIsLive && canonicalLabel !== node.label) invalidProject(`${itemPath}.label`, 'must name a complete, concrete map element rather than a reference, modifier, action fragment, or time expression');
    if (nodeIsLive && node.scale === 'micro' && !isDiscreteMicroNodeLabel(node.label)) invalidProject(`${itemPath}.label`, 'must name one discrete Micro element');

    if (nodeIsLive && node.scale === 'macrosphere' && isNamedInstitutionLabel(node.label)) invalidProject(`${itemPath}.label`, 'names a concrete institution and must be placed at Micro or Exosphere according to participation');
    if (nodeIsLive && node.scale === 'macrosphere' && isObviousLowerLevelMacroLabel(node.label)) invalidProject(`${itemPath}.label`, 'names an immediate person, role, activity, or schedule and belongs at Micro');
    if (node.type === MESOSYSTEM_NODE_TYPE && nodeIsLive && (!Array.isArray(node.scopeNodeIds) || node.scopeNodeIds.length < 2)) {
      invalidProject(`${itemPath}.scopeNodeIds`, 'must identify at least two Micro settings for a mesosystem node');
    }
    if (node.scale === 'macrosphere' && nodeIsLive && (!Array.isArray(node.scopeNodeIds) || node.scopeNodeIds.length < 2)) {
      invalidProject(`${itemPath}.scopeNodeIds`, 'must identify at least two map items for a live Macrosphere item');
    }
    validateEvidence(node, itemPath);
    validateClaimEvidence(node.claimEvidence, `${itemPath}.claimEvidence`);
  });
  return ids;
}

function validateScopedNodeReferences(nodes, availableNodes, path) {
  const availableById = new Map(availableNodes.map((node) => [node.id, node]));
  nodes.forEach((node, index) => {
    if (!Array.isArray(node.scopeNodeIds)) return;
    const scopedNodeIsLive = (node.status === 'confirmed' || node.status === 'research lead') && node.claimState !== 'retired';
    node.scopeNodeIds.forEach((memberId, memberIndex) => {
      const memberPath = `${path}[${index}].scopeNodeIds[${memberIndex}]`;
      const member = availableById.get(memberId);
      if (!member) invalidProject(memberPath, `references unknown node ${memberId}`);
      if (node.type === MESOSYSTEM_NODE_TYPE) {
        if (member.scale !== 'micro') invalidProject(memberPath, 'must reference a Micro node');
        if (!isMicroSettingNode(member)) invalidProject(memberPath, 'must reference an immediate setting mapped in Micro');
        if (scopedNodeIsLive && (member.status === 'rejected' || member.claimState === 'retired')) invalidProject(memberPath, 'must reference a live Micro setting');
      }
      if (node.scale === 'macrosphere') {
        if (member.scale === 'macrosphere') invalidProject(memberPath, 'must reference an inner map item');
        if (scopedNodeIsLive && (member.status === 'rejected' || member.claimState === 'retired')) invalidProject(memberPath, 'must reference a live map item');
      }
    });
  });
}

function validateSettingNodeReferences(nodes, availableNodes, path) {
  const availableById = new Map(availableNodes.map((node) => [node.id, node]));
  nodes.forEach((node, index) => {
    if (!Array.isArray(node.settingNodeIds)) return;
    node.settingNodeIds.forEach((memberId, memberIndex) => {
      const memberPath = `${path}[${index}].settingNodeIds[${memberIndex}]`;
      const member = availableById.get(memberId);
      if (!member) invalidProject(memberPath, `references unknown node ${memberId}`);
      if (!isMicroSettingNode(member)) invalidProject(memberPath, 'must reference a stable Micro setting node');
    });
  });
}

function validateEdgeCollection(edges, nodes, nodeIds, path, annotationOwners, carriedNodeIds = nodeIds) {
  if (!Array.isArray(edges)) invalidProject(path, 'must be an array');
  if (edges.length > PROJECT_LIMITS.edges) invalidProject(path, `must contain no more than ${PROJECT_LIMITS.edges} relationships`);
  assertUniqueIds(edges, path);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  edges.forEach((edge, index) => {
    const itemPath = `${path}[${index}]`;
    assertKnownKeys(edge, EDGE_KEYS, itemPath);
    assertString(edge.source, `${itemPath}.source`, false, 200);
    assertString(edge.target, `${itemPath}.target`, false, 200);
    if (!nodeIds.has(edge.source)) invalidProject(`${itemPath}.source`, `references unknown node ${edge.source}`);
    if (!nodeIds.has(edge.target)) invalidProject(`${itemPath}.target`, `references unknown node ${edge.target}`);
    if (edge.source === edge.target) invalidProject(itemPath, 'cannot be a self-loop');
    assertString(edge.sourceLabel, `${itemPath}.sourceLabel`, false, 200);
    assertString(edge.targetLabel, `${itemPath}.targetLabel`, false, 200);
    if (nodesById.get(edge.source)?.label !== edge.sourceLabel) invalidProject(`${itemPath}.sourceLabel`, 'does not match its source node');
    if (nodesById.get(edge.target)?.label !== edge.targetLabel) invalidProject(`${itemPath}.targetLabel`, 'does not match its target node');
    assertString(edge.verb, `${itemPath}.verb`, true, 100);
    assertEnum(edge.scale, SCALE_ORDER, `${itemPath}.scale`);

    assertEnum(edge.status, CANDIDATE_STATUSES, `${itemPath}.status`);
    assertEnum(edge.claimState, CLAIM_STATES, `${itemPath}.claimState`);
    const sourceNode = nodesById.get(edge.source), targetNode = nodesById.get(edge.target);
    if ((edge.status === 'confirmed' || edge.status === 'research lead') && edge.claimState !== 'retired' && (!canConnectAtScale(edge.scale, sourceNode) || !canConnectAtScale(edge.scale, targetNode))) invalidProject(itemPath, 'must use nodes available at this level');
    const live = edge.status !== 'rejected' && edge.claimState !== 'retired';
    const needsLiveEndpoints = live && !(path === 'project.candidates.edges' && edge.status === 'pending');
    if (needsLiveEndpoints && [sourceNode, targetNode].some(node => node.status === 'rejected' || node.claimState === 'retired')) invalidProject(itemPath, 'must reference live nodes');
    assertString(edge.notes ?? '', `${itemPath}.notes`, true, PROJECT_LIMITS.noteText);
    if (edge.directed !== undefined) assertBoolean(edge.directed, `${itemPath}.directed`);
    if (edge.confidence !== undefined) assertFiniteNumber(edge.confidence, `${itemPath}.confidence`, 0, 1);
    if (edge.rationale !== undefined) assertString(edge.rationale, `${itemPath}.rationale`, true, PROJECT_LIMITS.rationaleText);
    validateAnnotation(edge.annotation, `${itemPath}.annotation`, `edge:${edge.id}:relationship`, annotationOwners);
    if (edge.sourceFingerprint !== undefined) assertString(edge.sourceFingerprint, `${itemPath}.sourceFingerprint`, false, 200);
    if (edge.origin !== undefined) assertEnum(edge.origin, NODE_ORIGINS, `${itemPath}.origin`);
    if (edge.reviewDecision !== undefined) assertEnum(edge.reviewDecision, REVIEW_DECISIONS, `${itemPath}.reviewDecision`);
    validateEvidence(edge, itemPath);
    validateClaimEvidence(edge.claimEvidence, `${itemPath}.claimEvidence`);
    validateRelationshipProcess(edge.relationshipProcess, `${itemPath}.relationshipProcess`);
  });
}

function validateEventMetadata(event, path) {
  const metadata = Object.fromEntries(Object.entries(event).filter(([key]) => !['id', 'action', 'detail', 'actor', 'at'].includes(key)));
  const stack = [{ value: metadata, path, depth: 0 }];
  let work = 0;
  while (stack.length) {
    const current = stack.pop();
    work += 1;
    if (work > PROJECT_LIMITS.metadataWork) invalidProject(path, `metadata must contain no more than ${PROJECT_LIMITS.metadataWork} values`);
    if (current.depth > PROJECT_LIMITS.metadataDepth) invalidProject(current.path, `must not exceed ${PROJECT_LIMITS.metadataDepth} metadata levels`);
    if (typeof current.value === 'string') {
      assertString(current.value, current.path, true, PROJECT_LIMITS.metadataText);
      continue;
    }
    if (typeof current.value === 'number') {
      assertFiniteNumber(current.value, current.path);
      continue;
    }
    if (current.value === null || typeof current.value === 'boolean') continue;
    if (!current.value || typeof current.value !== 'object') invalidProject(current.path, 'must contain JSON-compatible metadata');
    const entries = Array.isArray(current.value)
      ? current.value.map((child, index) => [index, child])
      : Object.entries(current.value);
    const maximum = Array.isArray(current.value) ? PROJECT_LIMITS.metadataCollection : PROJECT_LIMITS.metadataKeys;
    if (entries.length > maximum) invalidProject(current.path, `must contain no more than ${maximum} metadata entries`);
    entries.forEach(([key, child]) => stack.push({ value: child, path: Array.isArray(current.value) ? `${current.path}[${key}]` : `${current.path}.${key}`, depth: current.depth + 1 }));
  }
}

function validateConfig(config, path) {
  assertObject(config, path);
  assertKnownKeys(config, CONFIG_KEYS, path);
  ['id', 'profileVersion', 'outputSchemaVersion', 'label', 'provider', 'baseModel', 'fixedPrompt', 'customInstructions', 'changeNote', 'fingerprint'].forEach((field) => {
    const maximum = field === 'fixedPrompt' || field === 'customInstructions' ? PROJECT_LIMITS.promptText : field === 'changeNote' ? PROJECT_LIMITS.rationaleText : 500;
    assertString(config[field], `${path}.${field}`, field === 'customInstructions' || field === 'changeNote', maximum);
  });
  assertInteger(config.revision, `${path}.revision`, 1, Number.MAX_SAFE_INTEGER);
  assertFiniteNumber(config.contextLimit, `${path}.contextLimit`, 1);
  assertFiniteNumber(config.confidenceThreshold, `${path}.confidenceThreshold`, 0, 1);
  if (!Array.isArray(config.relationVocabulary) || !config.relationVocabulary.length) invalidProject(`${path}.relationVocabulary`, 'must be a non-empty array');
  if (config.relationVocabulary.length > PROJECT_LIMITS.relationVocabulary) invalidProject(`${path}.relationVocabulary`, `must contain no more than ${PROJECT_LIMITS.relationVocabulary} relationships`);
  config.relationVocabulary.forEach((verb, index) => assertString(verb, `${path}.relationVocabulary[${index}]`, false, 100));
  if (new Set(config.relationVocabulary).size !== config.relationVocabulary.length) invalidProject(`${path}.relationVocabulary`, 'must not contain duplicates');
  if (!Array.isArray(config.history)) invalidProject(`${path}.history`, 'must be an array');
  if (config.history.length > PROJECT_LIMITS.configHistory) invalidProject(`${path}.history`, `must contain no more than ${PROJECT_LIMITS.configHistory} revisions`);
  config.history.forEach((entry, index) => {
    const entryPath = `${path}.history[${index}]`;
    assertObject(entry, entryPath);
    assertKnownKeys(entry, ['revision', 'fingerprint', 'changeNote', 'snapshot', 'at'], entryPath);
    assertInteger(entry.revision, `${entryPath}.revision`, 1, Number.MAX_SAFE_INTEGER);
    assertString(entry.fingerprint, `${entryPath}.fingerprint`, false, 500);
    assertString(entry.changeNote, `${entryPath}.changeNote`, true, PROJECT_LIMITS.rationaleText);
    assertString(entry.at, `${entryPath}.at`, false, 100);
    if (entry.snapshot !== undefined) {
      assertObject(entry.snapshot, `${entryPath}.snapshot`);
      validateConfig({ ...entry.snapshot, history: entry.snapshot.history ?? [] }, `${entryPath}.snapshot`);
    }
  });
  if (configFingerprint(config) !== config.fingerprint) invalidProject(`${path}.fingerprint`, 'does not match the effective configuration');
}

function validatePreflightEvaluation(evaluation, path) {
  assertObject(evaluation, path);
  assertKnownKeys(evaluation, ['evaluationId', 'runtime', 'createdAt', 'expiresAt'], path);
  assertString(evaluation.evaluationId, `${path}.evaluationId`, false, 200);
  if (!/^[A-Za-z0-9_-]{32}$/.test(evaluation.evaluationId) && !['[redacted]', '[unavailable]'].includes(evaluation.evaluationId)) {
    invalidProject(`${path}.evaluationId`, 'must be a server-issued capability or an explicit redaction marker');
  }
  assertTimestamp(evaluation.createdAt, `${path}.createdAt`);
  assertTimestamp(evaluation.expiresAt, `${path}.expiresAt`);
  if (Date.parse(evaluation.expiresAt) <= Date.parse(evaluation.createdAt)) invalidProject(`${path}.expiresAt`, 'must be later than createdAt');
  assertObject(evaluation.runtime, `${path}.runtime`);
  assertKnownKeys(evaluation.runtime, [
    'provider', 'model', 'createdAt', 'maxSourceBytes', 'requestedModel', 'doneReason',
    ...PREFLIGHT_RUNTIME_INTEGER_FIELDS,
  ], `${path}.runtime`);
  assertEnum(evaluation.runtime.provider, PREFLIGHT_RUNTIME_PROVIDERS, `${path}.runtime.provider`);
  assertString(evaluation.runtime.model, `${path}.runtime.model`, false, 200);
  assertTimestamp(evaluation.runtime.createdAt, `${path}.runtime.createdAt`);
  if (evaluation.runtime.createdAt !== evaluation.createdAt) invalidProject(`${path}.runtime.createdAt`, 'must match evaluation.createdAt');
  if (evaluation.runtime.provider === 'deterministic' && evaluation.runtime.model !== 'STEM Splitter') invalidProject(`${path}.runtime.model`, 'must be STEM Splitter for deterministic evaluation');
  if (evaluation.runtime.provider === 'source-check' && evaluation.runtime.model !== 'Meso role coverage') invalidProject(`${path}.runtime.model`, 'must identify the Meso role coverage check');
  if (evaluation.runtime.provider === 'ollama-cloud' && evaluation.runtime.maxSourceBytes !== 131_072) invalidProject(`${path}.runtime.maxSourceBytes`, 'must be 131072 for Ollama Cloud evaluation');
  if (evaluation.runtime.provider === 'deterministic' && evaluation.runtime.maxSourceBytes !== undefined) invalidProject(`${path}.runtime.maxSourceBytes`, 'is not allowed for deterministic evaluation');
  if (evaluation.runtime.maxSourceBytes !== undefined) assertInteger(evaluation.runtime.maxSourceBytes, `${path}.runtime.maxSourceBytes`, 1, PROJECT_LIMITS.sourceText * 4);
  if (evaluation.runtime.requestedModel !== undefined) assertString(evaluation.runtime.requestedModel, `${path}.runtime.requestedModel`, false, 200);
  if (evaluation.runtime.doneReason !== undefined) assertString(evaluation.runtime.doneReason, `${path}.runtime.doneReason`, false, 100);
  PREFLIGHT_RUNTIME_INTEGER_FIELDS.forEach((field) => {
    if (evaluation.runtime[field] !== undefined) assertInteger(evaluation.runtime[field], `${path}.runtime.${field}`, 0, Number.MAX_SAFE_INTEGER);
  });
}

function validateMemoReview(review, path) {
  assertObject(review, path);
  assertKnownKeys(review, ['guidance', 'nodes', 'connections', 'example', 'readiness'], path);
  ['guidance', 'nodes', 'connections', 'example', 'readiness'].forEach((field) => {
    if (!Object.hasOwn(review, field)) invalidProject(`${path}.${field}`, 'is required');
  });
  if (!Array.isArray(review.guidance) || review.guidance.length > PROJECT_LIMITS.memoGuidanceItems) {
    invalidProject(`${path}.guidance`, `must be an array of no more than ${PROJECT_LIMITS.memoGuidanceItems} items`);
  }
  review.guidance.forEach((item, index) => {
    const itemPath = `${path}.guidance[${index}]`;
    assertObject(item, itemPath);
    assertKnownKeys(item, ['point', 'evidenceExcerpt', 'evidenceMatch'], itemPath);
    assertString(item.point, `${itemPath}.point`, false, PROJECT_LIMITS.memoGuidanceText);
    if (containsRetiredSystemsLanguage(item.point)) invalidProject(`${itemPath}.point`, 'must use literal, conventional instructional language');
    if (item.evidenceExcerpt !== undefined) assertString(item.evidenceExcerpt, `${itemPath}.evidenceExcerpt`, false, PROJECT_LIMITS.memoGuidanceEvidence);
    // Absent means the quotation is verbatim. The marker only accompanies a quotation.
    if (item.evidenceMatch !== undefined && (item.evidenceExcerpt === undefined || !['normalized', 'elided'].includes(item.evidenceMatch))) {
      invalidProject(`${itemPath}.evidenceMatch`, 'must be normalized or elided and accompany an evidence excerpt');
    }
  });
  if (!Array.isArray(review.nodes) || review.nodes.length > PROJECT_LIMITS.memoReviewNodes) {
    invalidProject(`${path}.nodes`, `must be an array of no more than ${PROJECT_LIMITS.memoReviewNodes} nodes`);
  }
  review.nodes.forEach((node, index) => {
    const nodePath = `${path}.nodes[${index}]`;
    assertObject(node, nodePath);
    assertKnownKeys(node, ['label', 'type', 'scale', 'evidence', 'basis', 'deontic', 'scope'], nodePath);
    assertString(node.label, `${nodePath}.label`, false, 200);
    if (normalizeMapElementLabel(node.label, { micro: node.scale === 'micro' }) !== node.label || isStatementMapElementLabel(node.label)) invalidProject(`${nodePath}.label`, 'must name a complete map element rather than a statement, reference, modifier, action fragment, or time expression');
    if (containsRetiredSystemsLanguage(node.label)) invalidProject(`${nodePath}.label`, 'must use a literal, conventional name for the map element');
    assertEnum(node.type, NODE_TYPES, `${nodePath}.type`);
    assertEnum(node.scale, SCALE_ORDER, `${nodePath}.scale`);
    if (node.scale === 'meso' && node.type !== MESOSYSTEM_NODE_TYPE) invalidProject(`${nodePath}.type`, `must be ${MESOSYSTEM_NODE_TYPE} for a Meso suggestion`);
    if (node.type === MESOSYSTEM_NODE_TYPE && node.scale !== 'meso') invalidProject(`${nodePath}.scale`, 'must be Meso for a mesosystem suggestion');
    if (!isNodeTypeAllowedAtScale(node.type, node.scale)) invalidProject(`${nodePath}.type`, `is not allowed at ${SCALES[node.scale]?.label || node.scale}`);
    if (node.scale === 'micro' && !isDiscreteMicroNodeLabel(node.label)) invalidProject(`${nodePath}.label`, 'must name one discrete Micro element');

    if (node.type === MESOSYSTEM_NODE_TYPE && !isMesosystemLabel(node.label)) invalidProject(`${nodePath}.label`, 'must be a noun label without a relationship verb');
    if (node.scale === 'macrosphere' && isNamedInstitutionLabel(node.label)) invalidProject(`${nodePath}.label`, 'names a concrete institution and must be placed at Micro or Exosphere according to participation');
    if (node.scale === 'macrosphere' && isObviousLowerLevelMacroLabel(node.label)) invalidProject(`${nodePath}.label`, 'names an immediate person, role, activity, or schedule and belongs at Micro');
    assertString(node.evidence, `${nodePath}.evidence`, true, PROJECT_LIMITS.memoGuidanceEvidence);
    if (node.basis !== undefined) assertEnum(node.basis, NODE_BASES, `${nodePath}.basis`);
    if (node.deontic !== undefined) assertString(node.deontic, `${nodePath}.deontic`, true, 60);
    if (node.scope !== undefined) {
      if (!Array.isArray(node.scope) || node.scope.length > PROJECT_LIMITS.scopeMembers) {
        invalidProject(`${nodePath}.scope`, `must be an array of no more than ${PROJECT_LIMITS.scopeMembers} members`);
      }
      node.scope.forEach((member, memberIndex) => {
        const memberPath = `${nodePath}.scope[${memberIndex}]`;
        assertObject(member, memberPath);
        assertKnownKeys(member, ['id', 'label'], memberPath);
        assertString(member.id, `${memberPath}.id`, false, 200);
        assertString(member.label, `${memberPath}.label`, false, 200);
        if (containsRetiredSystemsLanguage(member.label)) invalidProject(`${memberPath}.label`, 'must use a literal, conventional name for the map element');
      });
    }
    if (node.type === MESOSYSTEM_NODE_TYPE && (!Array.isArray(node.scope) || node.scope.length < 2)) {
      invalidProject(`${nodePath}.scope`, 'must identify at least two Micro settings for a mesosystem suggestion');
    }
    if (node.scale === 'macrosphere' && (!Array.isArray(node.scope) || node.scope.length < 2)) {
      invalidProject(`${nodePath}.scope`, 'must identify at least two map items for a Macrosphere suggestion');
    }
  });
  if (!Array.isArray(review.connections) || review.connections.length > PROJECT_LIMITS.memoReviewConnections) {
    invalidProject(`${path}.connections`, `must be an array of no more than ${PROJECT_LIMITS.memoReviewConnections} connections`);
  }
  review.connections.forEach((connection, index) => {
    const connectionPath = `${path}.connections[${index}]`;
    assertObject(connection, connectionPath);
    assertKnownKeys(connection, ['source', 'target', 'sourceLabel', 'targetLabel', 'verb', 'rationale', 'relationshipProcess'], connectionPath);
    assertString(connection.source, `${connectionPath}.source`, false, 200);
    assertString(connection.target, `${connectionPath}.target`, false, 200);
    if (connection.sourceLabel !== undefined) assertString(connection.sourceLabel, `${connectionPath}.sourceLabel`, false, 200);
    if (connection.targetLabel !== undefined) assertString(connection.targetLabel, `${connectionPath}.targetLabel`, false, 200);
    const sourceEndpointLabel = connection.sourceLabel || connection.source;
    const targetEndpointLabel = connection.targetLabel || connection.target;
    if (normalizeMapElementLabel(sourceEndpointLabel, { micro: true }) !== sourceEndpointLabel) invalidProject(`${connectionPath}.sourceLabel`, 'must resolve to a complete, concrete map element');
    if (normalizeMapElementLabel(targetEndpointLabel, { micro: true }) !== targetEndpointLabel) invalidProject(`${connectionPath}.targetLabel`, 'must resolve to a complete, concrete map element');
    if (containsRetiredSystemsLanguage(connection.sourceLabel)) invalidProject(`${connectionPath}.sourceLabel`, 'must use a literal, conventional name for the map element');
    if (containsRetiredSystemsLanguage(connection.targetLabel)) invalidProject(`${connectionPath}.targetLabel`, 'must use a literal, conventional name for the map element');
    if (connection.source === connection.target) invalidProject(`${connectionPath}.target`, 'must differ from source');
    assertString(connection.verb, `${connectionPath}.verb`, false, 100);
    assertString(connection.rationale, `${connectionPath}.rationale`, true, PROJECT_LIMITS.rationaleText);
    validateRelationshipProcess(connection.relationshipProcess, `${connectionPath}.relationshipProcess`);
  });
  if (review.example !== null) {
    assertString(review.example, `${path}.example`, false, PROJECT_LIMITS.memoReviewExample);
    if (containsRetiredSystemsLanguage(review.example)) invalidProject(`${path}.example`, 'must use literal, conventional instructional language');
  }
  assertObject(review.readiness, `${path}.readiness`);
  assertKnownKeys(review.readiness, ['ready', 'note'], `${path}.readiness`);
  assertBoolean(review.readiness.ready, `${path}.readiness.ready`);
  assertString(review.readiness.note, `${path}.readiness.note`, true, PROJECT_LIMITS.memoGuidanceText);
  if (containsRetiredSystemsLanguage(review.readiness.note)) invalidProject(`${path}.readiness.note`, 'must use literal, conventional instructional language');
}

function validateStudentPreflight(preflight, path) {
  assertObject(preflight, path);
  assertKnownKeys(preflight, ['memoReview', 'configurationSnapshot', 'evaluation', 'sourceFingerprint'], path);
  ['memoReview', 'configurationSnapshot', 'evaluation', 'sourceFingerprint'].forEach((field) => {
    if (!Object.hasOwn(preflight, field)) invalidProject(`${path}.${field}`, 'is required');
  });
  if (preflight.memoReview !== null) validateMemoReview(preflight.memoReview, `${path}.memoReview`);
  if (preflight.sourceFingerprint !== null) assertString(preflight.sourceFingerprint, `${path}.sourceFingerprint`, false, 200);
  if (preflight.configurationSnapshot !== null) {
    validateConfigurationSnapshot(preflight.configurationSnapshot, `${path}.configurationSnapshot`);
    if (preflight.configurationSnapshot.kind !== 'preflight') invalidProject(`${path}.configurationSnapshot.kind`, 'must be preflight');
  }
  if (preflight.evaluation !== null) validatePreflightEvaluation(preflight.evaluation, `${path}.evaluation`);
  if (preflight.evaluation && preflight.configurationSnapshot === null) invalidProject(`${path}.configurationSnapshot`, 'is required for an authoritative evaluation');
  if (preflight.evaluation && preflight.configurationSnapshot.capturedAt !== preflight.evaluation.createdAt) {
    invalidProject(`${path}.configurationSnapshot.capturedAt`, 'must match the authoritative evaluation timestamp');
  }
}

function validateModuleVersions(moduleVersions, path) {
  if (!Array.isArray(moduleVersions)) invalidProject(path, 'must be an array');
  if (moduleVersions.length > PROJECT_LIMITS.relationVocabulary) invalidProject(path, `must contain no more than ${PROJECT_LIMITS.relationVocabulary} modules`);
  moduleVersions.forEach((moduleVersion, index) => {
    const itemPath = `${path}[${index}]`;
    assertObject(moduleVersion, itemPath);
    assertKnownKeys(moduleVersion, ['id', 'revision', 'fingerprint'], itemPath);
    assertString(moduleVersion.id, `${itemPath}.id`, false, 200);
    // An unpublished course appendix is explicitly revision 0. Preserve that
    // provenance in saved maps and evaluations; ordinary modules start at 1.
    assertInteger(moduleVersion.revision, `${itemPath}.revision`, moduleVersion.id === 'course-appendix' ? 0 : 1, Number.MAX_SAFE_INTEGER);
    assertString(moduleVersion.fingerprint, `${itemPath}.fingerprint`, false, 500);
  });
}

function validateCourseParts(courseParts, path) {
  if (!Array.isArray(courseParts) || courseParts.length !== SYSTEMS_MAPPING_PARTS.length) {
    invalidProject(path, `must contain ${SYSTEMS_MAPPING_PARTS.length} course parts`);
  }
  const partsById = new Map();
  courseParts.forEach((part, index) => {
    const itemPath = `${path}[${index}]`;
    assertObject(part, itemPath);
    assertKnownKeys(part, ['id', 'label', 'scaleIds'], itemPath);
    assertString(part.id, `${itemPath}.id`, false, 100);
    assertString(part.label, `${itemPath}.label`, false, 120);
    if (!Array.isArray(part.scaleIds)) invalidProject(`${itemPath}.scaleIds`, 'must be an array');
    part.scaleIds.forEach((scale, scaleIndex) => assertEnum(scale, SCALE_ORDER, `${itemPath}.scaleIds[${scaleIndex}]`));
    if (new Set(part.scaleIds).size !== part.scaleIds.length) invalidProject(`${itemPath}.scaleIds`, 'must not contain duplicates');
    if (partsById.has(part.id)) invalidProject(`${itemPath}.id`, `duplicates ${part.id}`);
    partsById.set(part.id, part);
  });
  SYSTEMS_MAPPING_PARTS.forEach((definition) => {
    const part = partsById.get(definition.id);
    if (!part || part.scaleIds.join(',') !== definition.scaleIds.join(',')) {
      invalidProject(path, `${definition.label} must contain ${definition.scaleIds.join(' and ')}`);
    }
  });
}

function validateTeacherGovernance(governance, path) {
  assertObject(governance, path);
  assertKnownKeys(governance, ['preflight', 'builder', 'refreshedAt'], path);
  ['preflight', 'builder'].forEach((kind) => {
    const snapshot = governance[kind];
    assertObject(snapshot, `${path}.${kind}`);
    assertKnownKeys(snapshot, ['configKind', 'scale', 'stageId', 'fingerprint', 'revision', 'moduleVersions', 'guardrailsFingerprint', 'courseParts', 'fieldNotesQuestions'], `${path}.${kind}`);
    assertEnum(snapshot.configKind, ['preflight', 'builder'], `${path}.${kind}.configKind`);
    if (snapshot.configKind !== kind) invalidProject(`${path}.${kind}.configKind`, `must be ${kind}`);
    assertEnum(snapshot.scale, SCALE_ORDER, `${path}.${kind}.scale`);
    if (snapshot.stageId !== undefined) assertEnum(snapshot.stageId, SYSTEMS_MAPPING_STAGE_IDS, `${path}.${kind}.stageId`);
    assertString(snapshot.fingerprint, `${path}.${kind}.fingerprint`, false, 500);
    assertInteger(snapshot.revision, `${path}.${kind}.revision`, 1, Number.MAX_SAFE_INTEGER);
    validateModuleVersions(snapshot.moduleVersions, `${path}.${kind}.moduleVersions`);
    if (snapshot.guardrailsFingerprint !== undefined) assertString(snapshot.guardrailsFingerprint, `${path}.${kind}.guardrailsFingerprint`, false, 500);
    if (snapshot.courseParts !== undefined) validateCourseParts(snapshot.courseParts, `${path}.${kind}.courseParts`);
    if (snapshot.fieldNotesQuestions !== undefined) {
      assertObject(snapshot.fieldNotesQuestions, `${path}.${kind}.fieldNotesQuestions`);
      assertKnownKeys(snapshot.fieldNotesQuestions, SCALE_ORDER, `${path}.${kind}.fieldNotesQuestions`);
      SCALE_ORDER.forEach(scale => assertString(snapshot.fieldNotesQuestions[scale], `${path}.${kind}.fieldNotesQuestions.${scale}`, false, FIELD_NOTES_QUESTION_LIMIT));
    }
  });
  assertString(governance.refreshedAt, `${path}.refreshedAt`, false, 100);
}

function validateConfigurationSnapshot(snapshot, path) {
  assertObject(snapshot, path);
  assertKnownKeys(snapshot, ['kind', 'activeScale', 'stageId', 'capturedAt', 'shared', 'projectOverlay', 'effectiveFingerprint'], path);
  assertEnum(snapshot.kind, ['preflight', 'builder'], `${path}.kind`);
  assertEnum(snapshot.activeScale, SCALE_ORDER, `${path}.activeScale`);
  if (snapshot.stageId !== undefined) assertEnum(snapshot.stageId, SYSTEMS_MAPPING_STAGE_IDS, `${path}.stageId`);
  assertTimestamp(snapshot.capturedAt, `${path}.capturedAt`);
  if (snapshot.shared !== null) {
    assertObject(snapshot.shared, `${path}.shared`);
    assertKnownKeys(snapshot.shared, ['fingerprint', 'revision', 'moduleVersions', 'courseParts'], `${path}.shared`);
    assertString(snapshot.shared.fingerprint, `${path}.shared.fingerprint`, false, 500);
    assertInteger(snapshot.shared.revision, `${path}.shared.revision`, 1, Number.MAX_SAFE_INTEGER);
    validateModuleVersions(snapshot.shared.moduleVersions, `${path}.shared.moduleVersions`);
    if (snapshot.shared.courseParts !== undefined) validateCourseParts(snapshot.shared.courseParts, `${path}.shared.courseParts`);
  }
  assertObject(snapshot.projectOverlay, `${path}.projectOverlay`);
  assertKnownKeys(snapshot.projectOverlay, ['id', 'profileVersion', 'outputSchemaVersion', 'label', 'provider', 'baseModel', 'fixedPrompt', 'customInstructions', 'contextLimit', 'confidenceThreshold', 'relationVocabulary', 'revision', 'fingerprint'], `${path}.projectOverlay`);
  ['id', 'profileVersion', 'outputSchemaVersion', 'label', 'provider', 'baseModel', 'fingerprint'].forEach((field) => assertString(snapshot.projectOverlay[field], `${path}.projectOverlay.${field}`, false, 500));
  const hasFixedPrompt = Object.hasOwn(snapshot.projectOverlay, 'fixedPrompt');
  const hasCustomInstructions = Object.hasOwn(snapshot.projectOverlay, 'customInstructions');
  if (hasFixedPrompt !== hasCustomInstructions) invalidProject(`${path}.projectOverlay`, 'must contain both legacy prompt fields or neither');
  if (hasFixedPrompt) {
    assertString(snapshot.projectOverlay.fixedPrompt, `${path}.projectOverlay.fixedPrompt`, false, PROJECT_LIMITS.promptText);
    assertString(snapshot.projectOverlay.customInstructions, `${path}.projectOverlay.customInstructions`, true, PROJECT_LIMITS.promptText);
  }
  assertFiniteNumber(snapshot.projectOverlay.contextLimit, `${path}.projectOverlay.contextLimit`, 1);
  assertFiniteNumber(snapshot.projectOverlay.confidenceThreshold, `${path}.projectOverlay.confidenceThreshold`, 0, 1);
  if (!Array.isArray(snapshot.projectOverlay.relationVocabulary) || !snapshot.projectOverlay.relationVocabulary.length) invalidProject(`${path}.projectOverlay.relationVocabulary`, 'must be a non-empty array');
  if (snapshot.projectOverlay.relationVocabulary.length > PROJECT_LIMITS.relationVocabulary) invalidProject(`${path}.projectOverlay.relationVocabulary`, `must contain no more than ${PROJECT_LIMITS.relationVocabulary} relationships`);
  snapshot.projectOverlay.relationVocabulary.forEach((verb, index) => assertString(verb, `${path}.projectOverlay.relationVocabulary[${index}]`, false, 100));
  assertInteger(snapshot.projectOverlay.revision, `${path}.projectOverlay.revision`, 1, Number.MAX_SAFE_INTEGER);
  assertString(snapshot.effectiveFingerprint, `${path}.effectiveFingerprint`, false, 500);
}

function validatePortableExport(portableExport, path) {
  assertObject(portableExport, path);
  assertKnownKeys(portableExport, ['schemaVersion', 'sharingTier', 'redacted', 'redactions', 'preservedReferenceFields'], path);
  if (portableExport.schemaVersion !== PROJECT_SCHEMA_VERSION) invalidProject(`${path}.schemaVersion`, `must be ${PROJECT_SCHEMA_VERSION}`);
  assertEnum(portableExport.sharingTier, SHARING_TIERS, `${path}.sharingTier`);
  assertBoolean(portableExport.redacted, `${path}.redacted`);
  if (!Array.isArray(portableExport.redactions)) invalidProject(`${path}.redactions`, 'must be an array');
  if (portableExport.redactions.length > 10_000) invalidProject(`${path}.redactions`, 'must contain no more than 10000 entries');
  portableExport.redactions.forEach((redaction, index) => {
    const itemPath = `${path}.redactions[${index}]`;
    assertObject(redaction, itemPath);
    assertKnownKeys(redaction, ['path', 'reason'], itemPath);
    assertString(redaction.path, `${itemPath}.path`, false, 1_000);
    assertString(redaction.reason, `${itemPath}.reason`, false, PROJECT_LIMITS.rationaleText);
  });
  if (!Array.isArray(portableExport.preservedReferenceFields)) invalidProject(`${path}.preservedReferenceFields`, 'must be an array');
  if (portableExport.preservedReferenceFields.length > 20) invalidProject(`${path}.preservedReferenceFields`, 'must contain no more than 20 fields');
  const allowedReferences = ['id', 'sourceId', 'evidenceId', 'evidenceHash', 'evidenceLocator', 'settingNodeIds'];
  portableExport.preservedReferenceFields.forEach((field, index) => assertEnum(field, allowedReferences, `${path}.preservedReferenceFields[${index}]`));
  if (portableExport.redacted !== (portableExport.redactions.length > 0)) invalidProject(`${path}.redacted`, 'must match the redaction manifest');
}

function validateInstitutionSphereBoundary(nodeCollections, reviewNodes = []) {
  const records = nodeCollections.flatMap(({ nodes, path }) => (Array.isArray(nodes) ? nodes.map((node, index) => ({ node, path: `${path}[${index}]` })) : []));
  const exosphereInstitutions = records
    .map(({ node }) => node)
    .filter((node) => node?.scale === 'exosphere' && node.status !== 'rejected' && node.claimState !== 'retired');
  records.forEach(({ node, path }) => {
    if (node?.scale === 'macrosphere' && labelRepeatsInstitution(node.label, exosphereInstitutions)) {
      invalidProject(`${path}.label`, 'repeats a concrete institution instead of naming a broader condition');
    }
  });
  (Array.isArray(reviewNodes) ? reviewNodes : []).forEach((node, index) => {
    if (node?.scale === 'macrosphere' && labelRepeatsInstitution(node.label, exosphereInstitutions)) {
      invalidProject(`project.preflight.memoReview.nodes[${index}].label`, 'repeats a concrete institution instead of naming a broader condition');
    }
  });
}

export function validateProject(project) {
  assertObject(project, 'project');
  assertSafeProjectStructure(project);
  assertKnownKeys(project, PROJECT_KEYS, 'project');
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new Error(`This file is not a supported Systems Mapping project. Expected schemaVersion ${PROJECT_SCHEMA_VERSION}.`);
  assertString(project.id, 'project.id', false, 200);
  assertString(project.title, 'project.title', true, 500);
  assertString(project.participantName, 'project.participantName', true, 500);
  assertString(project.inquiry, 'project.inquiry', true, PROJECT_LIMITS.promptText);
  assertEnum(project.activeScale, SCALE_ORDER, 'project.activeScale');
  if (!Array.isArray(project.releasedScales) || !project.releasedScales.length) invalidProject('project.releasedScales', 'must be a non-empty array');
  if (project.releasedScales.length > SCALE_ORDER.length) invalidProject('project.releasedScales', `must contain no more than ${SCALE_ORDER.length} scales`);
  project.releasedScales.forEach((scale, index) => assertEnum(scale, SCALE_ORDER, `project.releasedScales[${index}]`));
  if (new Set(project.releasedScales).size !== project.releasedScales.length) invalidProject('project.releasedScales', 'must not contain duplicates');
  if (!project.releasedScales.includes(project.activeScale)) invalidProject('project.activeScale', 'must be released');
  if (!Array.isArray(project.completedScales)) invalidProject('project.completedScales', 'must be an array');
  project.completedScales.forEach((scale, index) => {
    assertEnum(scale, SCALE_ORDER, `project.completedScales[${index}]`);
    if (!project.releasedScales.includes(scale)) invalidProject(`project.completedScales[${index}]`, 'must also be released');
  });
  if (new Set(project.completedScales).size !== project.completedScales.length) invalidProject('project.completedScales', 'must not contain duplicates');
  assertInteger(project.stage, 'project.stage', 0, 4);
  if (project.furthestStage !== undefined) assertInteger(project.furthestStage, 'project.furthestStage', 0, 4);
  validateLevelProgress(project.levelProgress, 'project.levelProgress');
  assertEnum(project.sharingTier, SHARING_TIERS, 'project.sharingTier');
  assertString(project.createdAt, 'project.createdAt', false, 100);
  assertString(project.updatedAt, 'project.updatedAt', false, 100);
  if (project.exportedAt !== undefined) assertString(project.exportedAt, 'project.exportedAt', false, 100);

  assertObject(project.submission, 'project.submission');
  assertKnownKeys(project.submission, SUBMISSION_KEYS, 'project.submission');
  ['id', 'title', 'author', 'date', 'sourceType', 'location', 'rights', 'evidenceOwnership', 'text'].forEach((field) => {
    const maximum = field === 'text' ? PROJECT_LIMITS.sourceText : field === 'id' ? 200 : field === 'title' || field === 'author' || field === 'sourceType' ? 500 : PROJECT_LIMITS.metadataText;
    assertString(project.submission[field], `project.submission.${field}`, field !== 'id', maximum);
  });
  assertBoolean(project.submission.sensitive, 'project.submission.sensitive');
  assertBoolean(project.submission.consent, 'project.submission.consent');
  if (project.submission.fileName !== undefined) assertString(project.submission.fileName, 'project.submission.fileName', true, 255);
  if (project.submission.fileSize !== undefined) assertFiniteNumber(project.submission.fileSize, 'project.submission.fileSize', 0, 5 * 1024 * 1024);
  if (project.submission.revision !== undefined) assertInteger(project.submission.revision, 'project.submission.revision', 1, Number.MAX_SAFE_INTEGER);
  if (project.submission.fingerprint !== undefined) {
    assertString(project.submission.fingerprint, 'project.submission.fingerprint', false, 200);
    if (project.submission.fingerprint !== stableId('src', project.submission.text)) invalidProject('project.submission.fingerprint', 'does not match the memo text');
  }

  assertObject(project.configs, 'project.configs');
  assertKnownKeys(project.configs, ['preflight', 'builder'], 'project.configs');
  validateConfig(project.configs.preflight, 'project.configs.preflight');
  validateConfig(project.configs.builder, 'project.configs.builder');

  assertObject(project.instructor, 'project.instructor');
  assertKnownKeys(project.instructor, ['readinessThreshold', 'hardGatesRequired', 'evidenceRequired', 'maxSharingTier', 'releaseMode', 'requireStudentConfirmation', 'allowResearchLeads'], 'project.instructor');
  assertInteger(project.instructor.readinessThreshold, 'project.instructor.readinessThreshold', 1, 8);
  ['hardGatesRequired', 'evidenceRequired', 'requireStudentConfirmation', 'allowResearchLeads'].forEach((field) => assertBoolean(project.instructor[field], `project.instructor.${field}`));
  assertEnum(project.instructor.maxSharingTier, SHARING_TIERS, 'project.instructor.maxSharingTier');
  if (SHARING_TIERS.indexOf(project.sharingTier) > SHARING_TIERS.indexOf(project.instructor.maxSharingTier)) {
    invalidProject('project.sharingTier', 'cannot exceed project.instructor.maxSharingTier');
  }
  assertString(project.instructor.releaseMode, 'project.instructor.releaseMode', false, 100);

  if (project.teacherGovernance !== undefined) validateTeacherGovernance(project.teacherGovernance, 'project.teacherGovernance');

  if (project.preflight !== null) {
    validateStudentPreflight(project.preflight, 'project.preflight');
  }

  const annotationOwners = { byId: new Map(), byOwner: new Map() };
  assertObject(project.candidates, 'project.candidates');
  assertKnownKeys(project.candidates, ['nodes', 'edges'], 'project.candidates');
  assertObject(project.graph, 'project.graph');
  assertKnownKeys(project.graph, ['nodes', 'edges'], 'project.graph');
  const candidateNodeIds = validateNodeCollection(project.candidates.nodes, 'project.candidates.nodes', annotationOwners);
  const graphNodeIds = validateNodeCollection(project.graph.nodes, 'project.graph.nodes', annotationOwners);
  validateInstitutionSphereBoundary([
    { nodes: project.candidates.nodes, path: 'project.candidates.nodes' },
    { nodes: project.graph.nodes, path: 'project.graph.nodes' },
  ], project.preflight?.memoReview?.nodes);
  validateScopedNodeReferences(project.candidates.nodes, [...project.graph.nodes, ...project.candidates.nodes], 'project.candidates.nodes');
  validateScopedNodeReferences(project.graph.nodes, project.graph.nodes, 'project.graph.nodes');
  validateSettingNodeReferences(project.candidates.nodes, [...project.candidates.nodes, ...project.graph.nodes], 'project.candidates.nodes');
  validateSettingNodeReferences(project.graph.nodes, project.graph.nodes, 'project.graph.nodes');
  const candidateEdgeNodeIds = new Set([...graphNodeIds, ...candidateNodeIds]);
  const candidateEdgeNodes = [...project.graph.nodes, ...project.candidates.nodes];
  validateEdgeCollection(project.candidates.edges, candidateEdgeNodes, candidateEdgeNodeIds, 'project.candidates.edges', annotationOwners, graphNodeIds);
  validateEdgeCollection(project.graph.edges, project.graph.nodes, graphNodeIds, 'project.graph.edges', annotationOwners);
  assertObject(project.viewport, 'project.viewport');
  assertKnownKeys(project.viewport, ['panX', 'panY', 'zoom'], 'project.viewport');
  assertFiniteNumber(project.viewport.panX, 'project.viewport.panX', PROJECT_LIMITS.panMin, PROJECT_LIMITS.panMax);
  assertFiniteNumber(project.viewport.panY, 'project.viewport.panY', PROJECT_LIMITS.panMin, PROJECT_LIMITS.panMax);
  assertFiniteNumber(project.viewport.zoom, 'project.viewport.zoom', PROJECT_LIMITS.zoomMin, PROJECT_LIMITS.zoomMax);
  if (project.layout !== undefined) {
    assertObject(project.layout, 'project.layout');
    assertKnownKeys(project.layout, ['phoneOverview', 'manualNodeIds'], 'project.layout');
    if (project.layout.phoneOverview !== undefined && project.layout.phoneOverview !== 'preserve') invalidProject('project.layout.phoneOverview', 'must be preserve');
    if (project.layout.manualNodeIds !== undefined) {
      if (!Array.isArray(project.layout.manualNodeIds) || project.layout.manualNodeIds.length > PROJECT_LIMITS.nodes) invalidProject('project.layout.manualNodeIds', 'must be a bounded list of node IDs');
      project.layout.manualNodeIds.forEach((id,index) => assertString(id, `project.layout.manualNodeIds[${index}]`, false, 200));
      if (new Set(project.layout.manualNodeIds).size !== project.layout.manualNodeIds.length) invalidProject('project.layout.manualNodeIds', 'must contain unique node IDs');
    }
    if (project.layout.phoneOverview === undefined && project.layout.manualNodeIds === undefined) invalidProject('project.layout', 'must contain a layout preference');
  }
  validateAnnotation(project.mapAnnotation, 'project.mapAnnotation', `project:${project.id}:map`, annotationOwners);
  assertString(project.reflection, 'project.reflection', true, PROJECT_LIMITS.promptText);
  if (!Array.isArray(project.events)) invalidProject('project.events', 'must be an array');
  if (project.events.length > PROJECT_LIMITS.events) invalidProject('project.events', `must contain no more than ${PROJECT_LIMITS.events} events`);
  assertUniqueIds(project.events, 'project.events');
  project.events.forEach((event, index) => {
    const path = `project.events[${index}]`;
    assertString(event.action, `${path}.action`, false, 100);
    assertString(event.detail, `${path}.detail`, false, PROJECT_LIMITS.eventText);
    assertString(event.actor, `${path}.actor`, false, 100);
    assertString(event.at, `${path}.at`, false, 100);
    validateEventMetadata(event, path);
  });
  if (project.portableExport !== undefined) {
    validatePortableExport(project.portableExport, 'project.portableExport');
    if (project.portableExport.sharingTier !== project.sharingTier) invalidProject('project.portableExport.sharingTier', 'must match project.sharingTier');
  }
  return project;
}

function cloneProject(project) {
  return typeof structuredClone === 'function' ? structuredClone(project) : JSON.parse(JSON.stringify(project));
}

function migrateNodeCollection(nodes, sharedPositions) {
  if (!Array.isArray(nodes)) return nodes;
  return nodes.map((node, index) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    const nodeId = String(node.id ?? `missing-${index}`);
    const fallback = sharedPositions.get(nodeId) || deterministicPositions([node]).get(nodeId);
    let annotations = node.annotations;
    if (annotations === undefined) {
      annotations = defaultNodeAnnotations(nodeId);
    } else if (annotations && typeof annotations === 'object' && !Array.isArray(annotations)) {
      annotations = {
        ...annotations,
        analytical: annotations.analytical === undefined ? defaultAnnotation(`node:${nodeId}`, 'analytical') : annotations.analytical,
        evidence: annotations.evidence === undefined ? defaultAnnotation(`node:${nodeId}`, 'evidence') : annotations.evidence,
      };
    }
    return {
      ...node,
      x: node.x === undefined ? fallback.x : node.x,
      y: node.y === undefined ? fallback.y : node.y,
      annotations,
    };
  });
}

function truncateCollapsedText(value, maximum) {
  const collapsed = normalizeWhitespace(value);
  if (collapsed.length <= maximum) return collapsed;
  const prefix = collapsed.slice(0, maximum + 1);
  const boundary = prefix.lastIndexOf(' ');
  return (boundary > 0 ? prefix.slice(0, boundary) : collapsed.slice(0, maximum)).trim();
}

function legacyPreflightShape(preflight) {
  return Boolean(preflight
    && typeof preflight === 'object'
    && !Array.isArray(preflight)
    && (Array.isArray(preflight.hard) || Array.isArray(preflight.redirects)));
}

const LEGACY_SCALE_IDS = Object.freeze({ macro: 'exosphere', integration: 'macrosphere' });
const LEGACY_PROMPT_MODULE_ID = /^(preflight|builder)\.(macro|integration)\.(purpose|evidence|privacy|scale_rubric|interaction|output)$/;

function migratePromptModuleId(value) {
  if (typeof value !== 'string' || !LEGACY_PROMPT_MODULE_ID.test(value)) return value;
  return value.replace('.macro.', '.exosphere.').replace('.integration.', '.macrosphere.');
}

function migrateScaleVocabulary(project, { sourceSchemaVersion = project?.schemaVersion } = {}) {
  const migrated = cloneProject(project);
  const scalarKeys = new Set(['scale', 'activeScale']);
  const collectionKeys = new Set(['scaleIds', 'releasedScales', 'completedScales']);
  const visit = (value, parentKey = '', inModuleVersions = false) => {
    if (Array.isArray(value)) {
      return value.map((item) => collectionKeys.has(parentKey) && typeof item === 'string'
        ? LEGACY_SCALE_IDS[item] || item
        : visit(item, '', inModuleVersions || parentKey === 'moduleVersions'));
    }
    if (!value || typeof value !== 'object') {
      if (inModuleVersions && parentKey === 'id') return migratePromptModuleId(value);
      return scalarKeys.has(parentKey) && typeof value === 'string'
        ? LEGACY_SCALE_IDS[value] || value
        : value;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, key, inModuleVersions)]));
  };
  const rewritten = visit(migrated);
  rewritten.participantName = typeof rewritten.participantName === 'string' ? rewritten.participantName : '';
  if (rewritten.portableExport && typeof rewritten.portableExport === 'object' && !Array.isArray(rewritten.portableExport)) {
    rewritten.portableExport.schemaVersion = PROJECT_SCHEMA_VERSION;
  }
  rewritten.schemaVersion = PROJECT_SCHEMA_VERSION;
  return migrateEvidenceAndProcess(sourceSchemaVersion < 8 ? migrateScaleTypeSemantics(rewritten) : rewritten, {
    normalizeExisting: sourceSchemaVersion < 7,
    legacyNodes: sourceSchemaVersion < 7,
  });
}

function migrateEvidenceAndProcess(project, { normalizeExisting = false, legacyNodes = false } = {}) {
  if (legacyNodes || project.levelProgress === undefined) {
    project.levelProgress = createLevelProgress({
      activeScale: project.activeScale,
      stage: project.stage,
      reflection: project.reflection,
      completedScales: project.completedScales,
    });
  }
  ['candidates', 'graph'].forEach((container) => {
    const nodes = project?.[container]?.nodes;
    if (Array.isArray(nodes)) {
      nodes.forEach((node) => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        if (legacyNodes) {
          node.origin = 'legacy';
          delete node.reviewDecision;
          node.settingNodeIds = [];
          node.focalParticipation = 'unclear';
        }
        if (node.scale === 'meso' && node.mesoExplanation === undefined) {
          node.mesoExplanation = '';
        }
        const records = normalizeClaimEvidenceRecords(node);
        if (Array.isArray(node.claimEvidence)) {
          if (normalizeExisting) node.claimEvidence = records;
        } else if (records.length) node.claimEvidence = records;
      });
    }
    const edges = project?.[container]?.edges;
    if (Array.isArray(edges)) {
      edges.forEach((edge) => {
        if (!edge || typeof edge !== 'object' || Array.isArray(edge)) return;
        if (legacyNodes) {
          edge.origin = 'legacy';
          delete edge.reviewDecision;
        }
        const records = normalizeClaimEvidenceRecords(edge);
        if (Array.isArray(edge.claimEvidence)) {
          if (normalizeExisting) edge.claimEvidence = records;
        } else if (records.length) edge.claimEvidence = records;
        if (normalizeExisting && edge.relationshipProcess !== undefined) {
          edge.relationshipProcess = createRelationshipProcess(edge.relationshipProcess);
        }
      });
    }
  });
  if (project.portableExport && typeof project.portableExport === 'object' && !Array.isArray(project.portableExport)) {
    project.portableExport.schemaVersion = PROJECT_SCHEMA_VERSION;
  }
  project.schemaVersion = PROJECT_SCHEMA_VERSION;
  return project;
}

function appendSemanticMigrationNote(record, note) {
  const notes = typeof record?.notes === 'string' ? record.notes.trim() : '';
  if (!record || notes.includes(note)) return;
  record.notes = notes ? `${notes}\n\n${note}` : note;
}

function migrateScaleTypeSemantics(project) {
  const collections = ['candidates', 'graph']
    .map((container) => project?.[container]?.nodes)
    .filter(Array.isArray);
  const allNodes = collections.flat();
  const exosphereInstitutions = allNodes.filter((node) => node?.scale === 'exosphere');
  const typeMigrationNote = 'Level taxonomy updated. Review this item before relying on its revised type.';
  const movedInstitutionNote = 'Moved from Macrosphere to Exosphere because this item names an institution rather than a broader law, policy, economic condition, history, belief, or structure.';
  const movedLowerLevelNote = 'Moved from Macrosphere to Micro because this item names an immediate person, role, activity, or schedule rather than a broader condition.';
  const retiredLowerLevelClauseNote = 'Retired during migration because this Macrosphere label is a clause about an immediate actor rather than the name of a broader condition. Rename and review it before restoring it.';
  const retiredExosphereNote = 'Retired during migration because an Exosphere item must name an institution, agency, office, or service system. Rename and review it before restoring it.';
  const retiredMicroNote = 'Retired during migration because a Micro item must name one discrete person, role, group, activity, object, or immediate setting. Rename and review it before restoring it.';
  const retiredReferenceOrTimeNote = 'Retired during migration because the label is a reference, modifier, action fragment, or time expression rather than a complete map element.';
  const retiredScopeNote = 'Retired during migration because this item needs at least two valid mapped scope members before it can return to the map.';
  const retiredInterfaceLanguageNote = 'Retired during migration because the label uses an earlier interface category instead of naming a map element directly.';

  allNodes.forEach((node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const canonicalLabel = normalizeMapElementLabel(node.label, { micro: node.scale === 'micro' });
    const hasKnownMacroLevelMismatch = node.scale === 'macrosphere' && isObviousLowerLevelMacroLabel(node.label);
    if (canonicalLabel !== node.label && !hasKnownMacroLevelMismatch && node.status !== 'rejected' && node.claimState !== 'retired') {
      node.status = 'rejected';
      node.claimState = 'retired';
      appendSemanticMigrationNote(node, retiredReferenceOrTimeNote);
    }
    if (containsRetiredSystemsLanguage(node.label) && node.status !== 'rejected' && node.claimState !== 'retired') {
      node.status = 'rejected';
      node.claimState = 'retired';
      appendSemanticMigrationNote(node, retiredInterfaceLanguageNote);
    }
    if (node.scale === 'macrosphere' && labelRepeatsInstitution(node.label, exosphereInstitutions)) {
      const priorScope = Array.isArray(node.scopeNodeIds) && node.scopeNodeIds.length ? node.scopeNodeIds.join(', ') : '';
      const priorMode = node.deontic || '';
      node.scale = 'exosphere';
      const inferredType = inferNodeType(node.label);
      node.type = EXOSPHERE_NODE_TYPES.includes(inferredType) ? inferredType : 'institution';
      delete node.scopeNodeIds;
      delete node.deontic;
      appendSemanticMigrationNote(node, `${movedInstitutionNote}${priorScope || priorMode ? ` Earlier structural metadata was ${priorMode || 'unspecified'}${priorScope ? ` for ${priorScope}` : ''}.` : ''}`);
      if (Array.isArray(project.releasedScales) && !project.releasedScales.includes('exosphere')) project.releasedScales.push('exosphere');
    }
    if (node.scale === 'macrosphere' && isObviousLowerLevelMacroLabel(node.label)) {
      const mismatchKind = obviousLowerLevelMacroKind(node.label);
      const canMoveToMicro = mismatchKind !== 'clause' && isDiscreteMicroNodeLabel(node.label);
      if (canMoveToMicro) {
        const priorScope = Array.isArray(node.scopeNodeIds) && node.scopeNodeIds.length ? node.scopeNodeIds.join(', ') : '';
        const priorMode = node.deontic || '';
        node.scale = 'micro';
        node.type = mismatchKind === 'schedule' ? 'object' : 'role';
        delete node.scopeNodeIds;
        delete node.deontic;
        appendSemanticMigrationNote(node, `${movedLowerLevelNote}${priorScope || priorMode ? ` Earlier structural metadata was ${priorMode || 'unspecified'}${priorScope ? ` for ${priorScope}` : ''}.` : ''}`);
        if (Array.isArray(project.releasedScales) && !project.releasedScales.includes('micro')) project.releasedScales.unshift('micro');
      } else if (node.status !== 'rejected' && node.claimState !== 'retired') {
        node.status = 'rejected';
        node.claimState = 'retired';
        appendSemanticMigrationNote(node, retiredLowerLevelClauseNote);
      }
    }
    if (NODE_TYPES.includes(node.type) && !isNodeTypeAllowedAtScale(node.type, node.scale)) {
      const inferredType = inferNodeType(node.label);
      node.type = isNodeTypeAllowedAtScale(inferredType, node.scale)
        ? inferredType
        : node.scale === 'micro'
          ? 'object'
          : node.scale === 'exosphere'
            ? 'institution'
            : node.scale === 'macrosphere'
              ? 'structure'
              : MESOSYSTEM_NODE_TYPE;
      appendSemanticMigrationNote(node, typeMigrationNote);
    }
    if (!['meso', 'macrosphere'].includes(node.scale) && Array.isArray(node.scopeNodeIds)) {
      appendSemanticMigrationNote(node, `Earlier scope members were preserved here for review: ${node.scopeNodeIds.join(', ')}.`);
      delete node.scopeNodeIds;
    }
    if (node.scale !== 'macrosphere' && node.deontic !== undefined) {
      appendSemanticMigrationNote(node, `Earlier structural action was preserved here for review: ${node.deontic}.`);
      delete node.deontic;
    }
    if (node.scale === 'exosphere' && !isNamedInstitutionLabel(node.label) && node.status !== 'rejected' && node.claimState !== 'retired') {
      node.status = 'rejected';
      node.claimState = 'retired';
      appendSemanticMigrationNote(node, retiredExosphereNote);
    }
    if (node.scale === 'micro' && !isDiscreteMicroNodeLabel(node.label) && node.status !== 'rejected' && node.claimState !== 'retired') {
      node.status = 'rejected';
      node.claimState = 'retired';
      appendSemanticMigrationNote(node, retiredMicroNote);
    }
    if (['meso', 'macrosphere'].includes(node.scale)
      && (!Array.isArray(node.scopeNodeIds) || node.scopeNodeIds.length < 2)
      && node.status !== 'rejected' && node.claimState !== 'retired') {
      node.status = 'rejected';
      node.claimState = 'retired';
      appendSemanticMigrationNote(node, retiredScopeNote);
    }
  });

  const migratedNodeById = new Map(allNodes
    .filter((node) => node && typeof node === 'object' && !Array.isArray(node))
    .map((node) => [node.id, node]));
  allNodes.forEach((node) => {
    if (!node || typeof node !== 'object' || !Array.isArray(node.scopeNodeIds) || !['meso', 'macrosphere'].includes(node.scale)) return;
    const priorScope = [...node.scopeNodeIds];
    const seen = new Set();
    node.scopeNodeIds = priorScope.filter((memberId) => {
      const member = migratedNodeById.get(memberId);
      if (!member || memberId === node.id || seen.has(memberId)) return false;
      if (node.scale === 'meso' && !isMicroSettingNode(member)) return false;
      if (node.scale === 'macrosphere' && member.scale === 'macrosphere') return false;
      seen.add(memberId);
      return true;
    });
    const removedMembers = priorScope.filter((memberId) => !node.scopeNodeIds.includes(memberId));
    if (removedMembers.length) appendSemanticMigrationNote(node, `Removed invalid earlier scope members during migration: ${removedMembers.join(', ')}.`);
    const live = node.status !== 'rejected' && node.claimState !== 'retired';
    const hasUnavailableMember = node.scopeNodeIds.some((memberId) => {
      const member = migratedNodeById.get(memberId);
      return member?.status === 'rejected' || member?.claimState === 'retired';
    });
    if (live && (node.scopeNodeIds.length < 2 || hasUnavailableMember)) {
      node.status = 'rejected';
      node.claimState = 'retired';
      appendSemanticMigrationNote(node, retiredScopeNote);
    }
  });

  ['candidates', 'graph'].forEach((container) => {
    const edges = project?.[container]?.edges;
    if (!Array.isArray(edges)) return;
    const graphEdgesReturnedForReview = new Set();
    // A candidate may reuse the stable id of a renamed carried node. Graph
    // relationships must resolve graph identities first; candidate
    // relationships may resolve the candidate identity first.
    const containerNodes = new Map((container === 'graph'
      ? [...(project?.candidates?.nodes || []), ...(project?.graph?.nodes || [])]
      : [...(project?.graph?.nodes || []), ...(project?.candidates?.nodes || [])])
      .map((node) => [node.id, node]));
    edges.forEach((edge) => {
      if (!edge || typeof edge !== 'object' || Array.isArray(edge)) return;
      const sourceNode = containerNodes.get(edge.source);
      const targetNode = containerNodes.get(edge.target);
      const sourceScale = sourceNode?.scale;
      const targetScale = targetNode?.scale;
      const edgeIsLive = edge.status !== 'rejected' && edge.claimState !== 'retired';
      const unavailableEndpoint = [sourceNode, targetNode].some((node) => !node || node.status === 'rejected' || node.claimState === 'retired');
      const repairableCandidate = container === 'candidates' && edge.status === 'pending'
        && sourceNode && targetNode && sourceScale === 'micro' && targetScale === 'micro';
      if (edgeIsLive && unavailableEndpoint && !repairableCandidate) {
        edge.status = 'rejected';
        edge.claimState = 'retired';
        appendSemanticMigrationNote(edge, 'Retired during migration because a relationship endpoint is not a live, concrete map element.');
      }
      if (edge.scale === 'macrosphere') {
        edge.scale = 'exosphere';
        edge.status = 'rejected';
        edge.claimState = 'retired';
        appendSemanticMigrationNote(edge, 'Retired during migration because Macrosphere is represented by scoped items rather than relationship edges.');
      }
      if ((edge.scale === 'micro' || edge.scale === 'meso') && (sourceScale !== 'micro' || targetScale !== 'micro')) {
        const canBecomeInstitutional = [sourceScale, targetScale].includes('exosphere')
          && ![sourceScale, targetScale].includes('macrosphere');
        if (canBecomeInstitutional) {
          edge.scale = 'exosphere';
          const canonicalVerb = scaleLexiconVerb('exosphere', edge.verb);
          if (canonicalVerb) edge.verb = canonicalVerb;
          else {
            edge.status = 'rejected';
            edge.claimState = 'retired';
          }
          appendSemanticMigrationNote(edge, 'Reclassified from an earlier cross-level relationship. Review this Exo-level connection before restoring it.');
        } else {
          edge.scale = 'exosphere';
          edge.status = 'rejected';
          edge.claimState = 'retired';
          appendSemanticMigrationNote(edge, 'Retired during migration because its endpoints do not form a valid direct Micro or institutional Exosphere relationship.');
        }
      }
      if (edge.scale === 'exosphere') {
        const canonicalVerb = scaleLexiconVerb('exosphere', edge.verb);
        const hasRetiredEndpoint = [sourceNode, targetNode].some((node) => !node || node.status === 'rejected' || node.claimState === 'retired');
        const edgeIsCommitted = (edge.status === 'confirmed' || edge.status === 'research lead') && edge.claimState !== 'retired';
        let validPathway = isExosphereDecisionPathway(sourceNode, targetNode);
        if (edgeIsCommitted && !validPathway && isExosphereDecisionPathway(targetNode, sourceNode)) {
          [edge.source, edge.target] = [edge.target, edge.source];
          [edge.sourceLabel, edge.targetLabel] = [edge.targetLabel, edge.sourceLabel];
          if (edge.relationshipProcess?.direction === 'source to target') edge.relationshipProcess.direction = 'target to source';
          else if (edge.relationshipProcess?.direction === 'target to source') edge.relationshipProcess.direction = 'source to target';
          validPathway = true;
          appendSemanticMigrationNote(edge, 'Reoriented during migration so the outside Exo-level decision setting is the source and the carried Micro setting is the target.');
        }
        if (edgeIsCommitted && ((edge.verb.trim() && !canonicalVerb) || !validPathway || hasRetiredEndpoint)) {
          edge.status = 'pending';
          edge.claimState = 'inference';
          appendSemanticMigrationNote(edge, 'Needs review after migration because an Exo-level connection must join live outside decision settings or reach a Micro setting already on the map. Choose valid endpoints or remove this suggestion.');
          if (container === 'graph') graphEdgesReturnedForReview.add(edge.id);
        } else if (canonicalVerb) {
          edge.verb = canonicalVerb;
        }
      }
    });
    if (container === 'graph' && graphEdgesReturnedForReview.size) {
      const reviewEdges = project?.candidates?.edges;
      if (Array.isArray(reviewEdges)) {
        edges.filter((edge) => graphEdgesReturnedForReview.has(edge.id)).forEach((edge) => {
          const existingIndex = reviewEdges.findIndex((candidate) => candidate.id === edge.id);
          if (existingIndex >= 0) reviewEdges[existingIndex] = edge;
          else reviewEdges.push(edge);
        });
        project.graph.edges = edges.filter((edge) => !graphEdgesReturnedForReview.has(edge.id));
      }
    }
  });

  const storedReview = project?.preflight?.memoReview;
  if (storedReview && typeof storedReview === 'object' && !Array.isArray(storedReview)) {
    const reviewNodes = Array.isArray(storedReview.nodes) ? storedReview.nodes : [];
    const reviewConnections = Array.isArray(storedReview.connections) ? storedReview.connections : [];
    const incompatibleNode = reviewNodes.some((node) => (
      !node || typeof node !== 'object' || Array.isArray(node)
      || containsRetiredSystemsLanguage(node.label)
      || normalizeMapElementLabel(node.label, { micro: node.scale === 'micro' }) !== node.label
      || !isNodeTypeAllowedAtScale(node.type, node.scale)
      || (node.scale === 'micro' && !isDiscreteMicroNodeLabel(node.label))
      || (node.scale === 'exosphere' && !isNamedInstitutionLabel(node.label))
      || (node.scale === 'macrosphere' && (isNamedInstitutionLabel(node.label) || isObviousLowerLevelMacroLabel(node.label) || !Array.isArray(node.scope) || node.scope.length < 2))
      || (node.scale === 'meso' && (node.type !== MESOSYSTEM_NODE_TYPE || !Array.isArray(node.scope) || node.scope.length < 2))
    ));
    const reviewScale = project?.preflight?.configurationSnapshot?.activeScale
      || reviewNodes[0]?.scale
      || project.activeScale;
    const incompatibleConnections = (['micro', 'macrosphere'].includes(reviewScale) && reviewConnections.length > 0)
      || (reviewScale === 'meso' && reviewNodes.length > 0)
      || reviewConnections.some((connection) => {
        const sourceLabel = connection?.sourceLabel || connection?.source;
        const targetLabel = connection?.targetLabel || connection?.target;
        return normalizeMapElementLabel(sourceLabel, { micro: reviewScale === 'micro' }) !== sourceLabel
          || normalizeMapElementLabel(targetLabel, { micro: reviewScale === 'micro' }) !== targetLabel;
      });
    const incompatibleProse = (Array.isArray(storedReview.guidance) ? storedReview.guidance : [])
      .some((item) => containsRetiredSystemsLanguage(item?.point))
      || containsRetiredSystemsLanguage(storedReview.example)
      || containsRetiredSystemsLanguage(storedReview.readiness?.note);
    if (incompatibleNode || incompatibleConnections || incompatibleProse) project.preflight = null;
  }
  return project;
}

function migrateLegacyMappingSemantics(project) {
  // Version 8 keeps the map's identities and evidence while moving relationship
  // work into Meso. Existing scoped Meso records remain available for review.
  const legacy = project?.schemaVersion < 8;
  let movedRelationships = false;
  ['candidates', 'graph'].forEach((container) => {
    (project?.[container]?.nodes || []).forEach((node) => {
      if (legacy && node?.scale === 'meso' && node.type !== MESOSYSTEM_NODE_TYPE) node.scale = 'micro';
    });
    (project?.[container]?.edges || []).forEach((edge) => {
      if (legacy && edge?.scale === 'micro') { edge.scale = 'meso'; movedRelationships = true; }
    });
  });
  if (movedRelationships && Array.isArray(project.releasedScales) && !project.releasedScales.includes('meso')) {
    project.releasedScales.splice(project.releasedScales.includes('micro') ? project.releasedScales.indexOf('micro') + 1 : 0, 0, 'meso');
  }
  const reviewScale = project?.preflight?.configurationSnapshot?.activeScale || project?.activeScale;
  const review = project?.preflight?.memoReview;
  if (legacy && review && ((reviewScale === 'micro' && review.connections?.length)
    || (reviewScale === 'meso' && review.nodes?.length))) {
    // Saved graph and suggestions are retained. Refresh only the old guidance.
    project.preflight = null;
  }
  if (project?.schemaVersion < 9 && review && ((reviewScale === 'exosphere' && review.connections?.length) || (reviewScale === 'macrosphere' && review.nodes?.length))) project.preflight = null;
  return project;
}

function migrateLegacyProject(project) {
  const collapseReviewStage = (stage) => stage <= 1 ? stage : stage <= 3 ? 2 : stage - 1;
  const insertConnectionStage = (stage) => stage >= 4 ? stage + 1 : stage;
  const collapseFiveStage = (stage) => [0, 0, 1, 2, 2, 3, 4][stage] ?? stage;
  const canonicalizeStageId = (snapshot) => {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return;
    snapshot.stageId = ({
      'choose-scale': 'add-source',
      'check-instructor-response': 'review-suggestions',
      'connect-map': 'choose-what-to-map',
    })[snapshot.stageId] || snapshot.stageId;
  };
  const finishStageMigration = (migrated, { insertConnection = true } = {}) => {
    const sourceSchemaVersion = migrated.schemaVersion;
    if (Number.isInteger(migrated.stage)) {
      migrated.stage = collapseFiveStage(insertConnection ? insertConnectionStage(migrated.stage) : migrated.stage);
    }
    if (Number.isInteger(migrated.furthestStage)) {
      migrated.furthestStage = collapseFiveStage(insertConnection ? insertConnectionStage(migrated.furthestStage) : migrated.furthestStage);
    }
    Object.values(migrated.teacherGovernance || {}).forEach(canonicalizeStageId);
    canonicalizeStageId(migrated.preflight?.configurationSnapshot);
    return migrateScaleVocabulary(migrateLegacyMappingSemantics(migrated), { sourceSchemaVersion });
  };
  if (project?.schemaVersion === 2) {
    const migrated = cloneProject(project);
    if (Number.isInteger(migrated.stage)) migrated.stage = collapseReviewStage(migrated.stage);
    if (Number.isInteger(migrated.furthestStage)) migrated.furthestStage = collapseReviewStage(migrated.furthestStage);
    if (legacyPreflightShape(migrated.preflight)) migrated.preflight = null;
    return finishStageMigration(migrated);
  }
  if (project?.schemaVersion === 3) {
    const migrated = cloneProject(project);
    if (legacyPreflightShape(migrated.preflight)) migrated.preflight = null;
    return finishStageMigration(migrated);
  }
  if (project?.schemaVersion === 4) {
    const migrated = cloneProject(project);
    if (legacyPreflightShape(migrated.preflight)) migrated.preflight = null;
    return finishStageMigration(migrated, { insertConnection: false });
  }
  if (project?.schemaVersion === 5) {
    const migrated = cloneProject(project);
    if (legacyPreflightShape(migrated.preflight)) migrated.preflight = null;
    return migrateScaleVocabulary(migrateLegacyMappingSemantics(migrated));
  }
  if (project?.schemaVersion === 6 || project?.schemaVersion === 7 || project?.schemaVersion === 8 || project?.schemaVersion === PROJECT_SCHEMA_VERSION) {
    // Preserve saved relationship records and add the current evidence fields.
    const migrated = cloneProject(project);
    if (legacyPreflightShape(migrated.preflight)) migrated.preflight = null;
    return migrateScaleVocabulary(migrateLegacyMappingSemantics(migrated));
  }
  if (project?.schemaVersion !== 1) return project;
  const migrated = cloneProject(project);
  if (Number.isInteger(migrated.stage)) migrated.stage = collapseReviewStage(migrated.stage);
  if (Number.isInteger(migrated.furthestStage)) migrated.furthestStage = collapseReviewStage(migrated.furthestStage);
  const candidateNodes = Array.isArray(migrated.candidates?.nodes) ? migrated.candidates.nodes : [];
  const graphNodes = Array.isArray(migrated.graph?.nodes) ? migrated.graph.nodes : [];
  const preferredById = new Map();
  [...candidateNodes, ...graphNodes].forEach((node, index) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const id = String(node.id ?? `missing-${index}`);
    const prior = preferredById.get(id);
    const hasPosition = node.x !== undefined && node.y !== undefined;
    if (!prior || (hasPosition && !(prior.x !== undefined && prior.y !== undefined))) preferredById.set(id, node);
  });
  const positioned = withDefaultNodeLayout([...preferredById.values()]);
  const sharedPositions = new Map(positioned.map((node) => [String(node.id), { x: node.x, y: node.y }]));
  if (migrated.candidates && typeof migrated.candidates === 'object' && !Array.isArray(migrated.candidates)) {
    migrated.candidates.nodes = migrateNodeCollection(migrated.candidates.nodes, sharedPositions);
    migrated.candidates.edges = withDefaultEdgeAnnotations(migrated.candidates.edges);
  }
  if (migrated.graph && typeof migrated.graph === 'object' && !Array.isArray(migrated.graph)) {
    migrated.graph.nodes = migrateNodeCollection(migrated.graph.nodes, sharedPositions);
    migrated.graph.edges = withDefaultEdgeAnnotations(migrated.graph.edges);
  }
  if (migrated.viewport === undefined) {
    migrated.viewport = { ...DEFAULT_VIEWPORT };
  } else if (migrated.viewport && typeof migrated.viewport === 'object' && !Array.isArray(migrated.viewport)) {
    migrated.viewport = { ...DEFAULT_VIEWPORT, ...migrated.viewport };
  }
  if (migrated.mapAnnotation === undefined) migrated.mapAnnotation = defaultAnnotation(String(migrated.id ?? 'project'), 'map');
  if (migrated.teacherGovernance && typeof migrated.teacherGovernance === 'object' && !Array.isArray(migrated.teacherGovernance)) {
    ['preflight', 'builder'].forEach((kind) => {
      const snapshot = migrated.teacherGovernance[kind];
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return;
      if (snapshot.guardrailsFingerprint === undefined && typeof snapshot.fixedGuardrails === 'string') {
        snapshot.guardrailsFingerprint = stableId('guardrails', snapshot.fixedGuardrails);
      }
      delete snapshot.effectivePrompt;
      delete snapshot.fixedGuardrails;
      canonicalizeStageId(snapshot);
    });
  }
  if (legacyPreflightShape(migrated.preflight)) migrated.preflight = null;
  canonicalizeStageId(migrated.preflight?.configurationSnapshot);
  return finishStageMigration(migrated);
}

// A short-lived schema-v6 build persisted this retired node tag. Imports strip
// it before strict validation so those saved projects continue to open, while
// current project objects cannot write the field back into the schema.
function discardRetiredNodeTags(project) {
  ['candidates', 'graph'].forEach((container) => {
    const nodes = project?.[container]?.nodes;
    if (!Array.isArray(nodes)) return;
    nodes.forEach((node) => {
      if (node && typeof node === 'object' && !Array.isArray(node)) delete node.leverage;
    });
  });
  return project;
}

function addRedaction(redactions, path, reason) {
  if (!redactions.some((entry) => entry.path === path)) redactions.push({ path, reason });
}

function removeLegacyCriterionTaxonomy(value, path, redactions) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => removeLegacyCriterionTaxonomy(item, `${path}[${index}]`, redactions));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const taxonomyKeys = new Set(['hard', 'scored', 'hardPass', 'score', 'threshold', 'outcome', 'criterion', 'criteria']);
  Object.keys(value).forEach((key) => {
    const itemPath = `${path}.${key}`;
    if (taxonomyKeys.has(key)) {
      delete value[key];
      addRedaction(redactions, itemPath, 'Legacy preflight criterion taxonomy excluded from portable export');
    } else {
      removeLegacyCriterionTaxonomy(value[key], itemPath, redactions);
    }
  });
}

function redactEvidenceExcerpts(records, path, redactions, reason) {
  records.forEach((record, index) => {
    if (Object.hasOwn(record, 'evidenceExcerpt')) {
      delete record.evidenceExcerpt;
      delete record.evidenceMatch;
      addRedaction(redactions, `${path}[${index}].evidenceExcerpt`, reason);
    }
    record.evidenceRefs?.forEach((reference, referenceIndex) => {
      if (Object.hasOwn(reference, 'evidenceExcerpt')) {
        delete reference.evidenceExcerpt;
        addRedaction(redactions, `${path}[${index}].evidenceRefs[${referenceIndex}].evidenceExcerpt`, reason);
      }
    });
    record.claimEvidence?.forEach((claim, claimIndex) => {
      if (claim.sourcePassage) {
        claim.sourcePassage = '';
        addRedaction(redactions, `${path}[${index}].claimEvidence[${claimIndex}].sourcePassage`, reason);
      }
    });
  });
}

function sensitiveAlias(node) {
  const prefix = node.type === 'family' ? 'Family' : 'Person';
  return `${prefix} ${stableId('alias', node.id).split('_').at(-1).slice(-5).toUpperCase()}`;
}

function pseudonymizeSensitiveLabels(portable, redactions, reason) {
  const aliases = new Map();
  const labels = new Map();
  [...portable.candidates.nodes, ...portable.graph.nodes].forEach((node) => {
    if ((node.type === 'person' || node.type === 'family') && !aliases.has(node.id)) {
      const alias = sensitiveAlias(node);
      aliases.set(node.id, alias);
      labels.set(node.label, alias);
    }
  });
  [['candidates.nodes', portable.candidates.nodes], ['graph.nodes', portable.graph.nodes]].forEach(([path, nodes]) => {
    nodes.forEach((node, index) => {
      const alias = aliases.get(node.id);
      if (alias && node.label !== alias) {
        node.label = alias;
        addRedaction(redactions, `${path}[${index}].label`, reason);
      }
    });
  });
  [['candidates.edges', portable.candidates.edges], ['graph.edges', portable.graph.edges]].forEach(([path, edges]) => {
    edges.forEach((edge, index) => {
      const sourceAlias = aliases.get(edge.source);
      const targetAlias = aliases.get(edge.target);
      if (sourceAlias && edge.sourceLabel !== sourceAlias) {
        edge.sourceLabel = sourceAlias;
        addRedaction(redactions, `${path}[${index}].sourceLabel`, reason);
      }
      if (targetAlias && edge.targetLabel !== targetAlias) {
        edge.targetLabel = targetAlias;
        addRedaction(redactions, `${path}[${index}].targetLabel`, reason);
      }
      if ((sourceAlias || targetAlias) && edge.rationale !== undefined) {
        edge.rationale = `The memo states that ${edge.sourceLabel} ${edge.verb} ${edge.targetLabel}.`;
        addRedaction(redactions, `${path}[${index}].rationale`, reason);
      }
    });
  });
  return labels;
}

function replaceSensitiveLabels(value, labels) {
  const source = [...labels.keys()].sort((left, right) => right.length - left.length).map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return source ? value.replace(new RegExp(source, 'g'), (label) => labels.get(label)) : value;
}

function preservesEventReference(key) {
  return /(?:^id$|ids$|id$|hash$|fingerprint$)/i.test(key)
    || new Set(['revision', 'configRevision', 'schemaVersion', 'profileVersion', 'outputSchemaVersion', 'provider', 'baseModel', 'outcome', 'status', 'decision', 'submittedAt', 'scale', 'claimState', 'type', 'verb', 'action', 'actor', 'at', 'nodes', 'edges', 'retiredNodes', 'relationVocabulary']).has(key);
}

function safeEventReference(key, value) {
  if (/(?:^id$|ids$|id$|hash$|fingerprint$)/i.test(key) || ['nodes', 'edges', 'retiredNodes'].includes(key)) {
    return /^(?:(?:node|edge|evh|evidence|claim_evidence|submission|src|cfg|evt|annotation|project)_[A-Za-z0-9._:-]+|[HC][0-9]+)$/.test(value);
  }
  if (['revision', 'configRevision', 'schemaVersion'].includes(key)) return /^\d+$/.test(value);
  if (['profileVersion', 'outputSchemaVersion', 'provider', 'baseModel'].includes(key)) return /^[A-Za-z0-9._:/ -]{1,500}$/.test(value);
  if (key === 'outcome') return ['pass', 'conditional', 'hold'].includes(value);
  if (key === 'status') return [...CANDIDATE_STATUSES, ...PREFLIGHT_REVIEW_STATUSES, 'met', 'unmet'].includes(value);
  if (key === 'decision') return PREFLIGHT_REVIEW_DECISIONS.includes(value);
  if (key === 'submittedAt') return !Number.isNaN(Date.parse(value));
  if (key === 'scale') return SCALE_ORDER.includes(value);
  if (key === 'claimState') return CLAIM_STATES.includes(value);
  if (key === 'type') return NODE_TYPES.includes(value);
  if (key === 'verb' || key === 'relationVocabulary') return RELATION_VOCABULARY.includes(value);
  if (key === 'action') return /^[a-z0-9.-]{1,100}$/.test(value);
  if (key === 'actor') return ['student', 'instructor', 'system'].includes(value);
  if (key === 'at') return !Number.isNaN(Date.parse(value));
  return false;
}

function scrubNestedDerivedText(value, path, redactions, reason, labels, parentKey = '') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (typeof item === 'string') {
        const replacement = preservesEventReference(parentKey) && safeEventReference(parentKey, item) ? item : '[redacted]';
        if (replacement !== item) {
          value[index] = replacement;
          addRedaction(redactions, itemPath, reason);
        }
      } else {
        scrubNestedDerivedText(item, itemPath, redactions, reason, labels, parentKey);
      }
    });
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.keys(value).forEach((key) => {
    const itemPath = `${path}.${key}`;
    if (key === 'evidenceExcerpt') {
      delete value[key];
      addRedaction(redactions, itemPath, reason);
    } else if (typeof value[key] === 'string') {
      let replaced;
      if ((key === 'label' || key === 'sourceLabel' || key === 'targetLabel') && labels.has(value[key])) replaced = labels.get(value[key]);
      else if (preservesEventReference(key) && safeEventReference(key, value[key])) replaced = value[key];
      else replaced = '[redacted]';
      if (replaced !== value[key]) {
        value[key] = replaced;
        addRedaction(redactions, itemPath, reason);
      }
    } else {
      scrubNestedDerivedText(value[key], itemPath, redactions, reason, labels, key);
    }
  });
}

function scrubDerivedFreeText(portable, redactions, reason, labels) {
  if (portable.reflection) {
    portable.reflection = '[redacted]';
    addRedaction(redactions, 'reflection', reason);
  }
  SCALE_ORDER.forEach((scale) => {
    if (!portable.levelProgress?.[scale]?.reflection) return;
    portable.levelProgress[scale].reflection = '[redacted]';
    addRedaction(redactions, `levelProgress.${scale}.reflection`, reason);
  });
  [['candidates.nodes', portable.candidates.nodes], ['candidates.edges', portable.candidates.edges], ['graph.nodes', portable.graph.nodes], ['graph.edges', portable.graph.edges]].forEach(([path, records]) => {
    records.forEach((record, index) => {
      if (record.notes) {
        record.notes = '';
        addRedaction(redactions, `${path}[${index}].notes`, reason);
      }
      if (record.annotations) {
        ['analytical', 'evidence'].forEach((kind) => {
          if (record.annotations[kind]?.text) {
            record.annotations[kind].text = '';
            addRedaction(redactions, `${path}[${index}].annotations.${kind}.text`, reason);
          }
        });
      }
      if (record.annotation?.text) {
        record.annotation.text = '';
        addRedaction(redactions, `${path}[${index}].annotation.text`, reason);
      }
      if (record.rationale) {
        record.rationale = '[redacted]';
        addRedaction(redactions, `${path}[${index}].rationale`, reason);
      }
      if (record.mesoExplanation) {
        record.mesoExplanation = '';
        addRedaction(redactions, `${path}[${index}].mesoExplanation`, reason);
      }
      record.claimEvidence?.forEach((claim, claimIndex) => {
        CLAIM_EVIDENCE_FIELDS.filter((field) => field !== 'sourcePassage').forEach((field) => {
          if (!claim[field]) return;
          claim[field] = '';
          addRedaction(redactions, `${path}[${index}].claimEvidence[${claimIndex}].${field}`, reason);
        });
      });
      if (record.relationshipProcess) {
        RELATIONSHIP_PROCESS_FIELDS.forEach((field) => {
          const defaults = createRelationshipProcess();
          if (record.relationshipProcess[field] === undefined || record.relationshipProcess[field] === defaults[field]) return;
          // Direction and explicitly missing pairs describe graph structure.
          if (field === 'direction' && ['source to target', 'target to source', 'both directions', 'not yet known', 'varies'].includes(record.relationshipProcess.direction)) return;
          if (field === 'connectionStatus') return;
          record.relationshipProcess[field] = field === 'direction' && record.relationshipProcess.direction ? 'not yet known' : defaults[field];
          addRedaction(redactions, `${path}[${index}].relationshipProcess.${field}`, reason);
        });
      }
    });
  });
  if (portable.mapAnnotation.text) {
    portable.mapAnnotation.text = '';
    addRedaction(redactions, 'mapAnnotation.text', reason);
  }
  if (portable.preflight?.memoReview) {
    portable.preflight.memoReview = null;
    addRedaction(redactions, 'preflight.memoReview', reason);
  }
  portable.events.forEach((event, index) => {
    if (event.detail) {
      event.detail = '[redacted]';
      addRedaction(redactions, `events[${index}].detail`, reason);
    }
    Object.keys(event).filter((key) => !['id', 'action', 'detail', 'actor', 'at'].includes(key)).forEach((key) => {
      const wrapper = { [key]: event[key] };
      scrubNestedDerivedText(wrapper, `events[${index}]`, redactions, reason, labels);
      event[key] = wrapper[key];
    });
  });
}

function scrubSensitiveIdentityText(portable, redactions, reason) {
  [['title', 'title'], ['inquiry', 'inquiry']].forEach(([field, path]) => {
    if (portable[field]) {
      portable[field] = '[redacted]';
      addRedaction(redactions, path, reason);
    }
  });
  portable.submission.title = '[redacted]';
  addRedaction(redactions, 'submission.title', reason);
}

export function createPortableProject(project, sharingTier = project.sharingTier) {
  validateProject(project);
  assertEnum(sharingTier, SHARING_TIERS, 'sharingTier');
  if (SHARING_TIERS.indexOf(sharingTier) > SHARING_TIERS.indexOf(project.instructor.maxSharingTier)) {
    invalidProject('sharingTier', 'cannot exceed project.instructor.maxSharingTier');
  }
  const portable = cloneProject(project);
  const redactions = [];
  if (['CUNY', 'public'].includes(sharingTier) && portable.participantName) {
    portable.participantName = '';
    addRedaction(redactions, 'participantName', 'Student or group name excluded from broader export');
  }
  const sensitive = portable.submission.sensitive;
  const restrictedRights = /(?:course use only|restricted|private|confidential|no redistribution|permission required)/i.test(portable.submission.rights);
  const redactSource = (sharingTier !== 'private' && sensitive)
    || (sharingTier === 'public' && restrictedRights);
  portable.sharingTier = sharingTier;
  portable.events.forEach((event, index) => {
    Object.keys(event).filter((key) => !['id', 'action', 'detail', 'actor', 'at'].includes(key)).forEach((key) => {
      removeLegacyCriterionTaxonomy(event[key], `events[${index}].${key}`, redactions);
    });
  });
  if (portable.preflight?.evaluation?.evaluationId) {
    portable.preflight.evaluation.evaluationId = '[redacted]';
    addRedaction(redactions, 'preflight.evaluation.evaluationId', 'Guidance capability excluded from portable export');
  }
  if (redactSource) {
    const reason = `Restricted memo material excluded from ${sharingTier} export`;
    portable.submission.text = '';
    addRedaction(redactions, 'submission.text', reason);
    if (sensitive) {
      portable.submission.author = '[redacted]';
      portable.submission.location = '[redacted]';
      addRedaction(redactions, 'submission.author', reason);
      addRedaction(redactions, 'submission.location', reason);
      if (Object.hasOwn(portable.submission, 'fileName')) {
        delete portable.submission.fileName;
        addRedaction(redactions, 'submission.fileName', reason);
      }
    }
    redactEvidenceExcerpts(portable.candidates.nodes, 'candidates.nodes', redactions, reason);
    redactEvidenceExcerpts(portable.candidates.edges, 'candidates.edges', redactions, reason);
    redactEvidenceExcerpts(portable.graph.nodes, 'graph.nodes', redactions, reason);
    redactEvidenceExcerpts(portable.graph.edges, 'graph.edges', redactions, reason);
    if (portable.preflight?.memoReview) {
      redactEvidenceExcerpts(portable.preflight.memoReview.guidance, 'preflight.memoReview.guidance', redactions, reason);
    }
    const labels = sensitive && sharingTier !== 'private'
      ? pseudonymizeSensitiveLabels(portable, redactions, reason)
      : new Map();
    scrubDerivedFreeText(portable, redactions, reason, labels);
    if (sensitive && sharingTier !== 'private') scrubSensitiveIdentityText(portable, redactions, reason);
  }
  portable.exportedAt = new Date().toISOString();
  portable.portableExport = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    sharingTier,
    redacted: redactions.length > 0,
    redactions,
    preservedReferenceFields: ['id', 'sourceId', 'evidenceId', 'evidenceHash', 'evidenceLocator', 'settingNodeIds'],
  };
  return portable;
}

export function serializePortableProject(project, sharingTier = project.sharingTier) {
  return JSON.stringify(createPortableProject(project, sharingTier), null, 2);
}

const FILE_SLUG_LIMIT = 60;

export function projectFileSlug(project) {
  const base = [project?.title, project?.submission?.title].find((value) => typeof value === 'string' && value.trim()) || 'systems-map';
  const slug = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, FILE_SLUG_LIMIT)
    .replace(/-+$/g, '');
  return slug || 'systems-map';
}

export function exportFileName(project, extension, suffix = '') {
  const date = new Date().toISOString().slice(0, 10);
  return `${projectFileSlug(project)}${suffix ? `-${suffix}` : ''}-${date}.${extension}`;
}

export function serializeProject(project) {
  const validated = validateProject(project);
  return JSON.stringify({ ...validated, exportedAt: new Date().toISOString() });
}

export function parseProject(value) {
  if (typeof value !== 'string') throw new Error('Invalid Systems Mapping project JSON: expected text input.');
  if (value.length > PROJECT_LIMITS.importBytes) throw new Error(`Invalid Systems Mapping project JSON: file exceeds ${PROJECT_LIMITS.importBytes} bytes.`);
  const byteLength = new TextEncoder().encode(value).byteLength;
  if (byteLength > PROJECT_LIMITS.importBytes) throw new Error(`Invalid Systems Mapping project JSON: file exceeds ${PROJECT_LIMITS.importBytes} bytes.`);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid Systems Mapping project JSON: ${error.message}`);
  }
  assertSafeProjectStructure(parsed);
  if (![1, 2, 3, 4, 5, 6, 7, 8, PROJECT_SCHEMA_VERSION].includes(parsed?.schemaVersion)) {
    throw new Error(`This file is not a supported Systems Mapping project. Expected schemaVersion 1, 2, 3, 4, 5, 6, 7, 8, or ${PROJECT_SCHEMA_VERSION}.`);
  }
  return validateProject(discardRetiredNodeTags(migrateLegacyProject(parsed)));
}
