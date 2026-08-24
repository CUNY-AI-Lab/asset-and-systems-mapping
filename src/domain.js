import { SYSTEMS_MAPPING_STAGE_IDS } from '../shared/systems-mapping-stages.js';
import { SYSTEMS_MAPPING_PARTS } from '../shared/systems-mapping-parts.js';

export const SCALE_ORDER = ['micro', 'meso', 'exosphere', 'macrosphere'];
export const SCALE_PARTS = SYSTEMS_MAPPING_PARTS;

export const SCALES = {
  micro: {
    label: 'Micro',
    prompt: 'Which people, roles, activities, objects, and immediate settings does the person directly encounter?',
    description: 'Direct activities, roles, relationships, and immediate settings.',
    checklist: [
      'Name each person, role, activity, object, and immediate setting as a discrete map element.',
      'Describe what happens between Micro elements with one direct verb.',
      'Record whose voices you have heard and whose are missing.',
    ],
  },
  meso: {
    label: 'Meso',
    prompt: 'Which two or more Micro settings form a mesosystem?',
    description: 'Interrelations among two or more immediate settings already mapped in Micro.',
    checklist: [
      'Use the exact names of settings already mapped in Micro.',
      'Group two or more settings into each mesosystem.',
      'Name the mesosystem without adding a directional connection.',
    ],
  },
  exosphere: {
    label: 'Exosphere',
    prompt: 'Which institutions and decisions shape daily experience from outside immediate settings?',
    description: 'Institutions, services, funding, and indirect decisions.',
    checklist: [
      'Name agencies, offices, funders, service systems, and decision-making bodies.',
      'Show where resources and decisions start, where they go, and who is affected.',
      'Keep indirect institutional influences separate from broader laws, beliefs, and structures.',
    ],
  },
  macrosphere: {
    label: 'Macrosphere',
    prompt: 'Which broader laws, public policies, economic conditions, histories, and cultural beliefs affect multiple mapped elements?',
    description: 'Broader conditions that affect more than one part of the map.',
    checklist: [
      'Name broader laws, public policies, economic conditions, histories, cultural beliefs, and structures.',
      'Identify at least two mapped elements affected by each item and the evidence supporting that claim.',
      'Keep named institutions in Exosphere.',
    ],
  },
};

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
// Meso is represented by scoped mesosystem nodes, not edges, so it has no
// relationship-verb register. Direct relationship verbs belong to Micro.
export const SCALE_VERB_LEXICONS = Object.freeze({
  meso: Object.freeze([]),
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
export const MICRO_SETTING_NODE_TYPES = Object.freeze(['setting']);
export const NODE_TYPES = [
  'person', 'role', 'group', 'family', 'organization', 'institution', 'agency', 'service',
  'activity', 'object', 'policy', 'resource', 'place', 'setting', 'dataset',
  'event', 'law', 'belief', 'economic condition', 'history', 'culture', 'structure', MESOSYSTEM_NODE_TYPE,
];
export const MICRO_NODE_TYPES = Object.freeze(['person', 'role', 'group', 'family', 'activity', 'object', 'setting']);
export const EXOSPHERE_NODE_TYPES = Object.freeze(['organization', 'institution', 'agency', 'service', 'policy']);
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
  // The institution itself (`CUNY`) remains an Exosphere label.
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

export function labelRepeatsInstitution(value, institutions) {
  if (isNamedInstitutionLabel(value)) return true;
  const normalized = normalizedEntityLabel(value);
  if (!normalized) return false;
  return (Array.isArray(institutions) ? institutions : []).some((node) => institutionLabelAliases(node?.label).some((alias) => (
    normalized === alias || normalized.startsWith(`${alias} `) || normalized.endsWith(` ${alias}`) || normalized.includes(` ${alias} `)
  )));
}
export const CLAIM_STATES = ['confirmed', 'student interpretation', 'inference', 'contested', 'research lead', 'retired'];

export const PROJECT_SCHEMA_VERSION = 6;

export const PROJECT_LIMITS = Object.freeze({
  importBytes: 8 * 1024 * 1024,
  sourceText: 500_000,
  sourceSentences: 10_000,
  evidenceExcerpt: 32_000,
  nodes: 500,
  edges: 1_000,
  events: 2_000,
  evidenceRefs: 50,
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
  const personWithSettingAdjunct = candidate.match(/^\s*([A-Z][\p{L}'’.-]+\s+[A-Z][\p{L}'’.-]+)\s+(?:at|in)\s+(?:the\s+)?[^,;:]+$/u);
  if (personWithSettingAdjunct) candidate = personWithSettingAdjunct[1];
  const label = displayLabel(candidate);
  return plausibleLabel(label) ? label : null;
}

function inferNodeType(label) {
  if (/^u\/[A-Za-z0-9_-]+$/i.test(label)) return 'person';
  if (/^r\/[A-Za-z0-9_-]+$/i.test(label)) return 'setting';
  if (UNAMBIGUOUS_INSTITUTION_LABEL.test(label)) return 'institution';
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
  if (/\b(?:abilit(?:y|ies)|supports?|funding|funds?|resources?|capacit(?:y|ies)|assets?|guidance|evaluations?|interviews?|eligibility|access)\b/i.test(label)) return 'resource';
  if (/\bfamil(?:y|ies)\b/i.test(label)) return 'family';
  if (/\b(?:students?|caregivers?|parents?|teachers?|workers?|instructors?|registrars?|advisers?|advisors?)\b/i.test(label)) return 'role';
  if (/\b(?:adults?|persons?|people|participants?|residents?|children|child)\b/i.test(label)) return 'person';
  if (/^(?![A-Z]{2,}$)[A-Z][\p{L}'’-]{2,}$/u.test(label)) return 'person';
  if (/^[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){1,3}$/u.test(label)) return 'person';
  return 'event';
}

function inferScale(label, fallback = 'micro') {
  if (SOCIAL_HANDLE_LABEL.test(label)) return fallback;
  if (isNamedInstitutionLabel(label)) return 'exosphere';
  if (UNAMBIGUOUS_INSTITUTION_LABEL.test(label)) return 'exosphere';
  if (/^(?:East Harlem|West Harlem|Central Harlem|The Bronx|Brooklyn|Queens|Manhattan|Staten Island)$/i.test(label)) return 'exosphere';
  if (/\b(?:culture|ideolog(?:y|ies)|capitalism|racism|structural|structures?|digital-first|public narratives?|histor(?:y|ies|ical)|rights?|laws?|acts?|regulations?|public polic(?:y|ies)|eligibility rules?|economic conditions?|costs?|ableis[mt]|assumptions?)\b/i.test(label)) return 'macrosphere';
  if (/\b(?:states?|cities|city|federal|public systems?|departments?|agenc(?:y|ies)|authorit(?:y|ies)|universit(?:y|ies)|colleges?|offices?|boards?|funding|funders?|service systems?|institutions?)\b/i.test(label)) return 'exosphere';
  return fallback;
}

function extractedNodeClassification(label, fallbackScale) {
  let type = inferNodeType(label);
  let scale = inferScale(label, fallbackScale);
  if (scale === 'micro' && !MICRO_NODE_TYPES.includes(type)) {
    if (['organization', 'institution', 'agency', 'service'].includes(type)) {
      if (/\b(?:classrooms?|schools?|campuses?|homes?|workplaces?|consultation rooms?|rooms?|digital labs?|labs?|libraries|peer groups?|online forums?|subreddits?)\b/i.test(label)) type = 'setting';
      else {
        scale = 'exosphere';
        type = EXOSPHERE_NODE_TYPES.includes(type) ? type : 'institution';
      }
    } else if (type === 'event') type = 'activity';
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
        const sourceScale = inferScale(sourceLabel, 'micro');
        const targetScale = inferScale(targetLabel, sourceScale);
        // Direct, verb-bearing relationships live in Micro. Meso is not an
        // edge layer; it is represented separately by a mesosystem node whose
        // scope names two or more immediate settings. Outer institutional and
        // structural relationships retain their own levels.
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
  const mesoSettingMentions = new Set([...text.matchAll(/\b(?:home|classroom|school|campus|workplace|work site|library|lab|clinic|center|peer group|online forum|subreddit)\b/gi)]
    .map((match) => match[0].toLocaleLowerCase()));
  const hasMesosystem = MESOSYSTEM_CUE.test(text) && mesoSettingMentions.size >= 2;
  const evidenceBoundary = locateEvidence({ ...submission, text }, /(according|data|interview|memo|reports?|shows?|evidence|testimony|should be checked)/i)
    || (submission.evidenceOwnership ? 'Memo and interpretation are tracked separately' : null);
  const hard = [
    result('H1', text.length >= 80 ? 'met' : 'unmet', text ? 'Memo text' : null, 'A usable memo needs enough detail to review.', 'Add more detail to the memo.', true),
    result('H2', !submission.sensitive || submission.consent ? 'met' : 'unmet', submission.sensitive ? 'Sensitivity declaration' : 'Marked non-sensitive', 'Sensitive material needs documented permission or a privacy-safe treatment.', 'Document permission or remove identifying details.', true),
    result('H3', evidenceBoundary ? 'met' : 'unmet', evidenceBoundary, 'At least one important point should name the evidence behind it.', 'Name the evidence behind one important point.', true),
    activeScale === 'micro'
      ? { ...result('H4', hasMicroNodes ? 'met' : 'unmet', mappedNodes[0]?.evidence || mappedNodes[0]?.evidenceLocator || null, 'Micro begins with at least two clearly named people, roles, activities, objects, or immediate settings.', 'Name at least two people, roles, activities, objects, or immediate settings that belong in the map.', true), nodeCount: mappedNodes.length }
      : activeScale === 'meso'
        ? { ...result('H4', hasMesosystem ? 'met' : 'unmet', hasMesosystem ? 'Memo names an interrelation among immediate settings' : null, 'Meso requires an interrelation among two or more immediate settings already identified in Micro.', 'Name the immediate settings that form a mesosystem and describe their interrelation.', true), mesosystemCount: hasMesosystem ? 1 : 0 }
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

const NODE_ONLY_COMMON_NOUN = /\b(?:famil(?:y|ies)|students?|parents?|caregivers?|teachers?|residents?|children|case\s+workers?|social\s+workers?|community\s+members?|classrooms?|schools?|community\s+centers?|clinics?|homes?|neighbou?rhoods?|programs?|organizations?)\b/gi;
const NODE_ONLY_PROPER_NOUN = /\b(?:[A-Z][A-Za-z'’.-]*|[A-Z]{2,}|\d+(?:st|nd|rd|th)?)(?:\s+(?:(?:of|for|and|the|in|at|on|with)\s+)?(?:[A-Z][A-Za-z'’.-]*|[A-Z]{2,}|\d+(?:st|nd|rd|th)?)){1,16}\b/g;
const NODE_ONLY_IGNORED_LABEL = /^(?:According to|Course Memo|Memo Sentence|This Memo|The Memo|What Evidence|No Evidence|Broader Conditions|Several Parts of the Map At Once|Institutions|One Another)$/i;

function nodeOnlyLabels(excerpt) {
  const properMatches = [...excerpt.matchAll(NODE_ONLY_PROPER_NOUN)];
  const commonMatches = [...excerpt.matchAll(NODE_ONLY_COMMON_NOUN)].filter((common) => !properMatches.some((proper) => (
    common.index >= proper.index && common.index + common[0].length <= proper.index + proper[0].length
  )));
  const labels = [...properMatches, ...commonMatches].map((match) => displayLabel(match[0]));
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
          const classification = extractedNodeClassification(label, 'micro');
          if (!classification) return;
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
  const edges = [...edgeMap.values()];
  if (edges.length > PROJECT_LIMITS.edges) invalidProject('submission.text', `produces more than ${PROJECT_LIMITS.edges} relationship records`);
  return { nodes, edges };
}

const DETERMINISTIC_REVIEW_SCALE_LIMITS = Object.freeze({
  micro: Object.freeze({ nodes: 10, connections: 8 }),
  meso: Object.freeze({ nodes: 6, connections: 0 }),
  exosphere: Object.freeze({ nodes: 8, connections: 6 }),
  // Macrosphere structures relate to the map through scopes, never edges.
  macrosphere: Object.freeze({ nodes: 8, connections: 0 }),
});

export function isMicroSettingNode(node) {
  return Boolean(node && node.scale === 'micro' && MICRO_SETTING_NODE_TYPES.includes(node.type));
}

function naturalList(values) {
  if (values.length < 2) return values[0] || '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

const MESOSYSTEM_CUE = /\b(coordination|coordinate[sd]?|communication|communicate[sd]?|collaboration|collaborate[sd]?|overlap|conflict|transition|alignment|disconnect|scheduling|planning)\b/i;

function mesosystemCueLabel(match) {
  const cue = match?.[1]?.toLocaleLowerCase() || 'coordination';
  if (cue.startsWith('coordinate')) return 'coordination';
  if (cue.startsWith('communicate')) return 'communication';
  if (cue.startsWith('collaborate')) return 'collaboration';
  return cue;
}

function deterministicMesosystems(submission, carriedNodes, limit) {
  const settings = carriedNodes.filter(isMicroSettingNode);
  const candidates = [];
  sentenceRecords(submission.text || '').forEach((sentence) => {
    const mentioned = settings.filter((node) => sentence.excerpt.toLocaleLowerCase().includes(String(node.label || '').trim().toLocaleLowerCase()));
    if (mentioned.length < 2) return;
    const relationshipText = mentioned.reduce((text, node) => text.replace(new RegExp(escapeRegExp(String(node.label || '').trim()), 'gi'), ' '), sentence.excerpt);
    const cue = MESOSYSTEM_CUE.exec(relationshipText);
    if (!cue) return;
    candidates.push({
      source: mentioned[0],
      target: mentioned[1],
      cue: mesosystemCueLabel(cue),
      evidence: sentence.excerpt,
    });
  });
  const seen = new Set();
  return candidates.flatMap(({ source, target, cue, evidence }) => {
    if (source.id === target.id || !isMicroSettingNode(source) || !isMicroSettingNode(target)) return [];
    const members = [source, target].sort((left, right) => left.id.localeCompare(right.id));
    const key = members.map((member) => member.id).join('::');
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      label: `${naturalList(members.map((member) => member.label))} ${cue}`,
      type: MESOSYSTEM_NODE_TYPE,
      scale: 'meso',
      evidence: truncateCollapsedText(evidence, PROJECT_LIMITS.memoGuidanceEvidence),
      scope: members.map(({ id, label }) => ({ id, label })),
    }];
  }).slice(0, Math.min(limit, PROJECT_LIMITS.memoReviewNodes));
}

export function deterministicMemoReview(submission, activeScale = 'micro', { carriedNodes = [], carriedConnections = [] } = {}) {
  const scaleLimits = DETERMINISTIC_REVIEW_SCALE_LIMITS[activeScale] || DETERMINISTIC_REVIEW_SCALE_LIMITS.micro;
  const { nodes, edges } = extractCandidates(submission);
  const carriedNodeByLabel = new Map(carriedNodes.map((node) => [String(node.label || '').trim().toLocaleLowerCase(), node]));
  const carriedConnectionKeys = new Set(carriedConnections
    .map((connection) => `${connection.source}::${String(connection.verb || '').trim().toLocaleLowerCase()}::${connection.target}`));
  const activeTypePriority = (node) => {
    if (activeScale === 'micro') {
      if (node.type === 'person' && /^(?:adults?|people|persons?|participants?|residents?|children)$/i.test(node.label)) return 1;
      return { setting: 8, person: 7, role: 6, object: 5, activity: 4, group: 3, family: 2 }[node.type] || 0;
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
  const reviewNodes = activeScale === 'meso'
    ? deterministicMesosystems(submission, carriedNodes, scaleLimits.nodes)
    : orderedNodes
      .filter((node) => node.scale === activeScale)
      .filter((node) => !carriedNodeByLabel.has(node.label.trim().toLocaleLowerCase()))
      .filter((node) => isNodeTypeAllowedAtScale(node.type, activeScale))
      .filter((node) => activeScale !== 'micro' || (isDiscreteMicroNodeLabel(node.label) && !NODE_ONLY_IGNORED_LABEL.test(node.label)))
      .filter((node) => activeScale !== 'exosphere' || isNamedInstitutionLabel(node.label))
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
    if (carried) return { reference: carried.id, label: carried.label, carried: true };
    return nodeLabels.has(label) ? { reference: label, label, carried: false } : null;
  };
  const connections = (activeScale === 'meso' || activeScale === 'macrosphere') ? [] : edges
    .filter((edge) => edge.scale === activeScale)
    .map((edge) => {
      if (activeScale === 'micro') {
        const sourceNode = nodes.find((node) => node.label === edge.sourceLabel) || carriedNodes.find((node) => node.label === edge.sourceLabel);
        const targetNode = nodes.find((node) => node.label === edge.targetLabel) || carriedNodes.find((node) => node.label === edge.targetLabel);
        if (isMicroSettingNode({ ...sourceNode, scale: 'micro' }) && isMicroSettingNode({ ...targetNode, scale: 'micro' })) return null;
      }
      const source = endpointFor(edge.sourceLabel);
      const target = endpointFor(edge.targetLabel);
      if (!source || !target || source.reference === target.reference) return null;
      // An Exosphere connection is an influence pathway: it must land on the
      // mapped world (the two-step chain), and its verb must belong to the
      // institutional register.
      if (activeScale === 'exosphere' && carriedNodes.length && !source.carried && !target.carried) return null;
      const verb = activeScale === 'micro' ? edge.verb : scaleLexiconVerb(activeScale, edge.verb);
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
  const guidance = activeScale === 'micro'
    ? [...(reviewNodes.length ? [{
      point: truncateCollapsedText(`The memo names ${reviewNodes.length} possible ${reviewNodes.length === 1 ? 'node' : 'nodes'}: ${reviewNodes.map((node) => node.label).join(', ')}.`, PROJECT_LIMITS.memoGuidanceText),
      ...(reviewNodes[0].evidence ? { evidenceExcerpt: truncateCollapsedText(reviewNodes[0].evidence, PROJECT_LIMITS.memoGuidanceEvidence) } : {}),
    }] : []), ...connections.slice(0, 3).map((connection) => ({
      point: truncateCollapsedText(`${connection.sourceLabel} ${connection.verb} ${connection.targetLabel}.`, PROJECT_LIMITS.memoGuidanceText),
      ...(connection.rationale ? { evidenceExcerpt: truncateCollapsedText(connection.rationale, PROJECT_LIMITS.memoGuidanceEvidence) } : {}),
    }))]
    : activeScale === 'meso'
      ? reviewNodes.slice(0, 3).map((node) => ({
        point: truncateCollapsedText(`Review ${naturalList(node.scope.map((member) => member.label))} as one mesosystem.`, PROJECT_LIMITS.memoGuidanceText),
        ...(node.evidence ? { evidenceExcerpt: truncateCollapsedText(node.evidence, PROJECT_LIMITS.memoGuidanceEvidence) } : {}),
      }))
      : connections.slice(0, 3).map((connection) => ({
      point: truncateCollapsedText(`${connection.sourceLabel} ${connection.verb} ${connection.targetLabel}.`, PROJECT_LIMITS.memoGuidanceText),
      ...(connection.rationale ? { evidenceExcerpt: truncateCollapsedText(connection.rationale, PROJECT_LIMITS.memoGuidanceEvidence) } : {}),
      }));
  // The outer levels are produced by elicitation, not extraction: the memo
  // rarely names the institutions and structures behind it, so the review
  // walks the standard categories the way an eco-map instrument does.
  if (activeScale === 'exosphere') {
    const anchors = carriedNodes.slice(0, 3).map((node) => node.label).join(', ');
    guidance.push({ point: truncateCollapsedText(anchors
      ? `For ${anchors}, identify the institutions that own or operate the setting, provide funding, employ staff, or set rules. Include an institution only when its decisions affect a mapped element without direct interaction with the person.`
      : 'Identify the institutions that own or operate each setting, provide funding, employ staff, or set rules. Include an institution only when its decisions affect a mapped element without direct interaction with the person.', PROJECT_LIMITS.memoGuidanceText) });
  }
  if (activeScale === 'macrosphere') {
    guidance.push({ point: truncateCollapsedText('Identify a broader law, policy, economic condition, or cultural belief only when it shapes multiple parts of the map. After naming the condition, choose the mapped elements it affects.', PROJECT_LIMITS.memoGuidanceText) });
  }
  if (!guidance.length) {
    guidance.push({ point: activeScale === 'micro'
      ? 'No clearly named people, roles, activities, objects, or immediate settings were found. You can continue and add Micro elements yourself.'
      : activeScale === 'meso'
        ? 'No interrelation among two or more Micro settings was found. You can continue and identify the settings that form a mesosystem.'
        : 'No clear connections were found. You can continue and describe them yourself.' });
  }
  guidance.splice(4);
  const first = connections[0] || null;
  const example = activeScale === 'meso' && reviewNodes[0]
    ? truncateCollapsedText(`${reviewNodes[0].label} includes ${naturalList(reviewNodes[0].scope.map((member) => member.label))}.`, PROJECT_LIMITS.memoReviewExample)
    : first
      ? truncateCollapsedText(`${first.sourceLabel} ${first.verb} ${first.targetLabel}. ${first.rationale || ''}`, PROJECT_LIMITS.memoReviewExample)
      : null;
  // Carried map elements count toward readiness at Exosphere. A Macrosphere
  // item is ready only when the memo supports at least two affected elements.
  const ready = activeScale === 'meso'
    ? reviewNodes.length >= 1
    : activeScale === 'micro'
      ? reviewNodes.length + carriedNodes.length >= 2
      : activeScale === 'macrosphere'
        ? reviewNodes.length >= 1
        : (reviewNodes.length + carriedNodes.length) >= 2 && connections.length >= 1;
  const outerNote = activeScale === 'macrosphere'
    ? `The memo names ${reviewNodes.length} possible broader ${reviewNodes.length === 1 ? 'condition' : 'conditions'} and identifies at least two affected mapped elements for each one. Continue to choose which belong.`
    : reviewNodes.length
      ? `The memo names ${reviewNodes.length} new ${reviewNodes.length === 1 ? 'institution' : 'institutions'} and ${connections.length} supported ${connections.length === 1 ? 'connection' : 'connections'} to mapped elements. Continue to choose what belongs.`
      : `The memo describes ${connections.length} supported institutional ${connections.length === 1 ? 'connection' : 'connections'} to elements already on your map. Continue to choose which ones belong.`;
  const readiness = {
    ready,
    note: truncateCollapsedText(ready
      ? activeScale === 'micro'
        ? reviewNodes.length
          ? `The memo names ${reviewNodes.length} possible nodes. Continue to choose which ones belong in the Micro map.`
          : 'No new Micro nodes were found. Review any new direct relationships before continuing.'
        : activeScale === 'meso'
          ? `The review identifies ${reviewNodes.length} possible ${reviewNodes.length === 1 ? 'mesosystem' : 'mesosystems'} among settings carried from Micro. Continue to choose which belong in the map.`
          : outerNote
      : activeScale === 'micro'
        ? 'Fewer than two possible nodes were found. You can continue, or name more people, roles, groups, or settings in the memo.'
        : activeScale === 'meso'
          ? 'No interrelation among two or more Micro settings was found. You can continue and identify the settings that form a mesosystem.'
          : activeScale === 'macrosphere'
            ? 'No named structures were found. You can continue and name the laws, policies, prices, or beliefs at work yourself — the memo does not need to name them.'
            : 'No named institutions were found. You can continue and add them yourself — for each mapped setting, ask who owns, funds, or sets the rules for it.', PROJECT_LIMITS.memoGuidanceText),
  };
  return { guidance, nodes: reviewNodes, connections, example: activeScale === 'micro' ? null : example, readiness };
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
  fixedPrompt: `${BASE_GUARDRAILS}\nPropose only operations appropriate to the active level. Micro uses discrete nodes and direct relationships among them. Meso uses mesosystem nodes that include two or more Micro settings already on the map and never uses relationship edges or verbs. Exosphere uses named institutions and supported institutional relationships. Macrosphere uses broader laws, public policies, economic conditions, histories, cultural beliefs, and structures that affect at least two mapped elements, never named institutions. Never add a suggestion to the map until the student continues from review.`,
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
const PREFLIGHT_RUNTIME_PROVIDERS = ['deterministic', 'ollama-cloud', 'openrouter'];
const PREFLIGHT_RUNTIME_INTEGER_FIELDS = [
  'totalDurationNs', 'loadDurationNs', 'promptEvalCount', 'promptEvalDurationNs',
  'evalCount', 'evalDurationNs',
];
const FORBIDDEN_PROJECT_KEYS = new Set([
  'password', 'passwordhash', 'passwordsalt', 'passphrase', 'apikey', 'secret', 'secrettoken',
  'accesstoken', 'refreshtoken', 'authorization', 'cookie', 'sessiontoken', 'accessgrant',
  'oauth', 'userid', 'accountid', 'emailaddress', 'classcode', 'studentcode',
]);

const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const EVIDENCE_KEYS = ['evidence', 'evidenceLocator', 'evidenceExcerpt', 'evidenceHash', 'evidenceId', 'sourceId', 'evidenceRefs'];
const PROJECT_KEYS = ['schemaVersion', 'id', 'title', 'participantName', 'inquiry', 'activeScale', 'releasedScales', 'completedScales', 'stage', 'furthestStage', 'sharingTier', 'createdAt', 'updatedAt', 'submission', 'configs', 'instructor', 'teacherGovernance', 'preflight', 'candidates', 'graph', 'viewport', 'mapAnnotation', 'reflection', 'events', 'exportedAt', 'portableExport'];
const SUBMISSION_KEYS = ['id', 'title', 'author', 'date', 'sourceType', 'location', 'rights', 'sensitive', 'consent', 'evidenceOwnership', 'text', 'fileName', 'fileSize', 'revision', 'fingerprint'];
const CONFIG_KEYS = ['id', 'profileVersion', 'outputSchemaVersion', 'label', 'provider', 'baseModel', 'fixedPrompt', 'customInstructions', 'contextLimit', 'confidenceThreshold', 'relationVocabulary', 'revision', 'changeNote', 'history', 'fingerprint'];
const NODE_KEYS = ['id', 'label', 'type', 'scale', 'status', 'claimState', 'notes', 'x', 'y', 'annotations', 'sourceFingerprint', 'basis', 'deontic', 'scopeNodeIds', ...EVIDENCE_KEYS];
const EDGE_KEYS = ['id', 'source', 'target', 'sourceLabel', 'targetLabel', 'verb', 'scale', 'status', 'claimState', 'notes', 'directed', 'confidence', 'rationale', 'annotation', 'sourceFingerprint', ...EVIDENCE_KEYS];

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
    if (node.deontic !== undefined) assertString(node.deontic, `${itemPath}.deontic`, true, 60);
    if (node.deontic !== undefined && node.scale !== 'macrosphere') invalidProject(`${itemPath}.deontic`, 'is only allowed on a Macrosphere item');
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
    if (nodeIsLive && node.scale === 'micro' && isNamedInstitutionLabel(node.label)) invalidProject(`${itemPath}.label`, 'names an institution and belongs at Exosphere');
    if (nodeIsLive && node.scale === 'exosphere' && !isNamedInstitutionLabel(node.label)) invalidProject(`${itemPath}.label`, 'must name an institution, agency, office, or service system');
    if (nodeIsLive && node.scale === 'macrosphere' && isNamedInstitutionLabel(node.label)) invalidProject(`${itemPath}.label`, 'names an institution and belongs at Exosphere');
    if (nodeIsLive && node.scale === 'macrosphere' && isObviousLowerLevelMacroLabel(node.label)) invalidProject(`${itemPath}.label`, 'names an immediate person, role, activity, or schedule and belongs at Micro');
    if (node.type === MESOSYSTEM_NODE_TYPE && nodeIsLive && (!Array.isArray(node.scopeNodeIds) || node.scopeNodeIds.length < 2)) {
      invalidProject(`${itemPath}.scopeNodeIds`, 'must identify at least two Micro settings for a mesosystem node');
    }
    if (node.scale === 'macrosphere' && nodeIsLive && (!Array.isArray(node.scopeNodeIds) || node.scopeNodeIds.length < 2)) {
      invalidProject(`${itemPath}.scopeNodeIds`, 'must identify at least two mapped elements for a live Macrosphere item');
    }
    validateEvidence(node, itemPath);
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
        if (member.scale === 'macrosphere') invalidProject(memberPath, 'must reference an inner mapped element');
        if (scopedNodeIsLive && (member.status === 'rejected' || member.claimState === 'retired')) invalidProject(memberPath, 'must reference a live mapped element');
      }
    });
  });
}

function validateEdgeCollection(edges, nodes, nodeIds, path, annotationOwners) {
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
    assertString(edge.verb, `${itemPath}.verb`, false, 100);
    assertEnum(edge.scale, SCALE_ORDER, `${itemPath}.scale`);
    if (edge.scale === 'meso') invalidProject(`${itemPath}.scale`, 'is not allowed because Meso uses scoped mesosystem nodes without relationship verbs');
    if (edge.scale === 'macrosphere') invalidProject(`${itemPath}.scale`, 'is not allowed because Macrosphere items use scopes without relationship edges');
    assertEnum(edge.status, CANDIDATE_STATUSES, `${itemPath}.status`);
    assertEnum(edge.claimState, CLAIM_STATES, `${itemPath}.claimState`);
    if (edge.scale === 'micro') {
      const sourceNode = nodesById.get(edge.source);
      const targetNode = nodesById.get(edge.target);
      if (sourceNode?.scale !== 'micro') invalidProject(`${itemPath}.source`, 'must reference a Micro node for a direct Micro relationship');
      if (targetNode?.scale !== 'micro') invalidProject(`${itemPath}.target`, 'must reference a Micro node for a direct Micro relationship');
      const relationshipIsLive = edge.status !== 'rejected' && edge.claimState !== 'retired';
      if (relationshipIsLive && (sourceNode?.status === 'rejected' || sourceNode?.claimState === 'retired')) invalidProject(`${itemPath}.source`, 'must reference a live Micro node');
      if (relationshipIsLive && (targetNode?.status === 'rejected' || targetNode?.claimState === 'retired')) invalidProject(`${itemPath}.target`, 'must reference a live Micro node');
      if (relationshipIsLive && isMicroSettingNode(sourceNode) && isMicroSettingNode(targetNode)) invalidProject(itemPath, 'must not encode an interrelation between two Micro settings as a Micro relationship');
    }
    if (edge.scale === 'exosphere') {
      const sourceNode = nodesById.get(edge.source);
      const targetNode = nodesById.get(edge.target);
      const relationshipIsLive = edge.status !== 'rejected' && edge.claimState !== 'retired';
      if (relationshipIsLive && sourceNode?.scale !== 'exosphere' && targetNode?.scale !== 'exosphere') invalidProject(itemPath, 'must include an Exosphere institution');
      if (relationshipIsLive && (sourceNode?.scale === 'macrosphere' || targetNode?.scale === 'macrosphere')) invalidProject(itemPath, 'must not use a Macrosphere item as an institutional relationship endpoint');
      if (relationshipIsLive && !scaleLexiconVerb('exosphere', edge.verb)) invalidProject(`${itemPath}.verb`, 'must use an Exosphere institutional relationship');
      if (relationshipIsLive && (sourceNode?.status === 'rejected' || sourceNode?.claimState === 'retired')) invalidProject(`${itemPath}.source`, 'must reference a live mapped element');
      if (relationshipIsLive && (targetNode?.status === 'rejected' || targetNode?.claimState === 'retired')) invalidProject(`${itemPath}.target`, 'must reference a live mapped element');
    }
    assertString(edge.notes ?? '', `${itemPath}.notes`, true, PROJECT_LIMITS.noteText);
    if (edge.directed !== undefined) assertBoolean(edge.directed, `${itemPath}.directed`);
    if (edge.confidence !== undefined) assertFiniteNumber(edge.confidence, `${itemPath}.confidence`, 0, 1);
    if (edge.rationale !== undefined) assertString(edge.rationale, `${itemPath}.rationale`, true, PROJECT_LIMITS.rationaleText);
    validateAnnotation(edge.annotation, `${itemPath}.annotation`, `edge:${edge.id}:relationship`, annotationOwners);
    if (edge.sourceFingerprint !== undefined) assertString(edge.sourceFingerprint, `${itemPath}.sourceFingerprint`, false, 200);
    validateEvidence(edge, itemPath);
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
    assertKnownKeys(item, ['point', 'evidenceExcerpt'], itemPath);
    assertString(item.point, `${itemPath}.point`, false, PROJECT_LIMITS.memoGuidanceText);
    if (containsRetiredSystemsLanguage(item.point)) invalidProject(`${itemPath}.point`, 'must use literal, conventional instructional language');
    if (item.evidenceExcerpt !== undefined) assertString(item.evidenceExcerpt, `${itemPath}.evidenceExcerpt`, false, PROJECT_LIMITS.memoGuidanceEvidence);
  });
  if (!Array.isArray(review.nodes) || review.nodes.length > PROJECT_LIMITS.memoReviewNodes) {
    invalidProject(`${path}.nodes`, `must be an array of no more than ${PROJECT_LIMITS.memoReviewNodes} nodes`);
  }
  review.nodes.forEach((node, index) => {
    const nodePath = `${path}.nodes[${index}]`;
    assertObject(node, nodePath);
    assertKnownKeys(node, ['label', 'type', 'scale', 'evidence', 'basis', 'deontic', 'scope'], nodePath);
    assertString(node.label, `${nodePath}.label`, false, 200);
    if (normalizeMapElementLabel(node.label, { micro: node.scale === 'micro' }) !== node.label) invalidProject(`${nodePath}.label`, 'must name a complete, concrete map element rather than a reference, modifier, action fragment, or time expression');
    if (containsRetiredSystemsLanguage(node.label)) invalidProject(`${nodePath}.label`, 'must use a literal, conventional name for the map element');
    assertEnum(node.type, NODE_TYPES, `${nodePath}.type`);
    assertEnum(node.scale, SCALE_ORDER, `${nodePath}.scale`);
    if (node.scale === 'meso' && node.type !== MESOSYSTEM_NODE_TYPE) invalidProject(`${nodePath}.type`, `must be ${MESOSYSTEM_NODE_TYPE} for a Meso suggestion`);
    if (node.type === MESOSYSTEM_NODE_TYPE && node.scale !== 'meso') invalidProject(`${nodePath}.scale`, 'must be Meso for a mesosystem suggestion');
    if (!isNodeTypeAllowedAtScale(node.type, node.scale)) invalidProject(`${nodePath}.type`, `is not allowed at ${SCALES[node.scale]?.label || node.scale}`);
    if (node.scale === 'micro' && !isDiscreteMicroNodeLabel(node.label)) invalidProject(`${nodePath}.label`, 'must name one discrete Micro element');
    if (node.scale === 'micro' && isNamedInstitutionLabel(node.label)) invalidProject(`${nodePath}.label`, 'names an institution and belongs at Exosphere');
    if (node.scale === 'exosphere' && !isNamedInstitutionLabel(node.label)) invalidProject(`${nodePath}.label`, 'must name an institution, agency, office, or service system');
    if (node.type === MESOSYSTEM_NODE_TYPE && !isMesosystemLabel(node.label)) invalidProject(`${nodePath}.label`, 'must be a noun label without a relationship verb');
    if (node.scale === 'macrosphere' && isNamedInstitutionLabel(node.label)) invalidProject(`${nodePath}.label`, 'names an institution and belongs at Exosphere');
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
      invalidProject(`${nodePath}.scope`, 'must identify at least two mapped elements for a Macrosphere suggestion');
    }
  });
  if (!Array.isArray(review.connections) || review.connections.length > PROJECT_LIMITS.memoReviewConnections) {
    invalidProject(`${path}.connections`, `must be an array of no more than ${PROJECT_LIMITS.memoReviewConnections} connections`);
  }
  review.connections.forEach((connection, index) => {
    const connectionPath = `${path}.connections[${index}]`;
    assertObject(connection, connectionPath);
    assertKnownKeys(connection, ['source', 'target', 'sourceLabel', 'targetLabel', 'verb', 'rationale'], connectionPath);
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
    assertInteger(moduleVersion.revision, `${itemPath}.revision`, 1, Number.MAX_SAFE_INTEGER);
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
    assertKnownKeys(snapshot, ['configKind', 'scale', 'stageId', 'fingerprint', 'revision', 'moduleVersions', 'guardrailsFingerprint', 'courseParts'], `${path}.${kind}`);
    assertEnum(snapshot.configKind, ['preflight', 'builder'], `${path}.${kind}.configKind`);
    if (snapshot.configKind !== kind) invalidProject(`${path}.${kind}.configKind`, `must be ${kind}`);
    assertEnum(snapshot.scale, SCALE_ORDER, `${path}.${kind}.scale`);
    if (snapshot.stageId !== undefined) assertEnum(snapshot.stageId, SYSTEMS_MAPPING_STAGE_IDS, `${path}.${kind}.stageId`);
    assertString(snapshot.fingerprint, `${path}.${kind}.fingerprint`, false, 500);
    assertInteger(snapshot.revision, `${path}.${kind}.revision`, 1, Number.MAX_SAFE_INTEGER);
    validateModuleVersions(snapshot.moduleVersions, `${path}.${kind}.moduleVersions`);
    if (snapshot.guardrailsFingerprint !== undefined) assertString(snapshot.guardrailsFingerprint, `${path}.${kind}.guardrailsFingerprint`, false, 500);
    if (snapshot.courseParts !== undefined) validateCourseParts(snapshot.courseParts, `${path}.${kind}.courseParts`);
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
  const allowedReferences = ['id', 'sourceId', 'evidenceId', 'evidenceHash', 'evidenceLocator'];
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
      invalidProject(`${path}.label`, 'repeats an Exosphere institution and belongs at Exosphere');
    }
  });
  (Array.isArray(reviewNodes) ? reviewNodes : []).forEach((node, index) => {
    if (node?.scale === 'macrosphere' && labelRepeatsInstitution(node.label, exosphereInstitutions)) {
      invalidProject(`project.preflight.memoReview.nodes[${index}].label`, 'repeats an Exosphere institution and belongs at Exosphere');
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
  const candidateEdgeNodeIds = new Set([...graphNodeIds, ...candidateNodeIds]);
  const candidateEdgeNodes = [...project.graph.nodes, ...project.candidates.nodes];
  validateEdgeCollection(project.candidates.edges, candidateEdgeNodes, candidateEdgeNodeIds, 'project.candidates.edges', annotationOwners);
  validateEdgeCollection(project.graph.edges, project.graph.nodes, graphNodeIds, 'project.graph.edges', annotationOwners);
  assertObject(project.viewport, 'project.viewport');
  assertKnownKeys(project.viewport, ['panX', 'panY', 'zoom'], 'project.viewport');
  assertFiniteNumber(project.viewport.panX, 'project.viewport.panX', PROJECT_LIMITS.panMin, PROJECT_LIMITS.panMax);
  assertFiniteNumber(project.viewport.panY, 'project.viewport.panY', PROJECT_LIMITS.panMin, PROJECT_LIMITS.panMax);
  assertFiniteNumber(project.viewport.zoom, 'project.viewport.zoom', PROJECT_LIMITS.zoomMin, PROJECT_LIMITS.zoomMax);
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

function migrateScaleVocabulary(project) {
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
  return migrateScaleTypeSemantics(rewritten);
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
  const nodesById = new Map(allNodes.filter((node) => node && typeof node === 'object' && !Array.isArray(node)).map((node) => [node.id, node]));
  const scopedSettingIds = new Set(allNodes
    .filter((node) => node?.scale === 'meso' && node.type === MESOSYSTEM_NODE_TYPE && Array.isArray(node.scopeNodeIds))
    .flatMap((node) => node.scopeNodeIds));
  const exosphereInstitutions = allNodes.filter((node) => node?.scale === 'exosphere');
  const typeMigrationNote = 'Level taxonomy updated. Review this item before relying on its revised type.';
  const movedInstitutionNote = 'Moved from Macrosphere to Exosphere because this item names an institution rather than a broader law, policy, economic condition, history, belief, or structure.';
  const movedMicroInstitutionNote = 'Moved from Micro to Exosphere because this item names an institution rather than a person, role, group, activity, object, or immediate setting.';
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
    if (scopedSettingIds.has(node.id) && node.scale === 'micro' && node.type !== 'setting' && NODE_TYPES.includes(node.type)) {
      node.type = 'setting';
      appendSemanticMigrationNote(node, 'Typed as a Micro setting because an existing mesosystem includes it. Review the setting label and scope.');
    }
    if (node.scale === 'micro' && isNamedInstitutionLabel(node.label)) {
      node.scale = 'exosphere';
      const inferredType = inferNodeType(node.label);
      node.type = EXOSPHERE_NODE_TYPES.includes(inferredType) ? inferredType : 'institution';
      delete node.scopeNodeIds;
      delete node.deontic;
      appendSemanticMigrationNote(node, movedMicroInstitutionNote);
      if (Array.isArray(project.releasedScales) && !project.releasedScales.includes('exosphere')) project.releasedScales.push('exosphere');
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
    const containerNodes = new Map([
      ...(project?.graph?.nodes || []),
      ...(project?.candidates?.nodes || []),
    ].map((node) => [node.id, node]));
    edges.forEach((edge) => {
      if (!edge || typeof edge !== 'object' || Array.isArray(edge)) return;
      const sourceNode = containerNodes.get(edge.source);
      const targetNode = containerNodes.get(edge.target);
      const sourceScale = sourceNode?.scale;
      const targetScale = targetNode?.scale;
      const edgeIsLive = edge.status !== 'rejected' && edge.claimState !== 'retired';
      const unavailableEndpoint = [sourceNode, targetNode].some((node) => !node || node.status === 'rejected' || node.claimState === 'retired');
      if (edgeIsLive && unavailableEndpoint) {
        edge.status = 'rejected';
        edge.claimState = 'retired';
        appendSemanticMigrationNote(edge, 'Retired during migration because a relationship endpoint is not a live, concrete map element.');
      }
      if (edgeIsLive && edge.scale === 'micro' && isMicroSettingNode(sourceNode) && isMicroSettingNode(targetNode)) {
        edge.status = 'rejected';
        edge.claimState = 'retired';
        appendSemanticMigrationNote(edge, 'Retired during migration because an interrelation between two Micro settings belongs in a scoped Meso item, not a direct Micro relationship.');
      }
      if (edge.scale === 'macrosphere') {
        edge.scale = 'exosphere';
        edge.status = 'rejected';
        edge.claimState = 'retired';
        appendSemanticMigrationNote(edge, 'Retired during migration because Macrosphere is represented by scoped items rather than relationship edges.');
      }
      if (edge.scale === 'micro' && (sourceScale !== 'micro' || targetScale !== 'micro')) {
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
          appendSemanticMigrationNote(edge, 'Reclassified from an earlier cross-level relationship. Review this institutional connection before restoring it.');
        } else {
          edge.scale = 'exosphere';
          edge.status = 'rejected';
          edge.claimState = 'retired';
          appendSemanticMigrationNote(edge, 'Retired during migration because its endpoints do not form a valid direct Micro or institutional Exosphere relationship.');
        }
      }
      if (edge.scale === 'exosphere') {
        const canonicalVerb = scaleLexiconVerb('exosphere', edge.verb);
        const hasInstitutionEndpoint = sourceNode?.scale === 'exosphere' || targetNode?.scale === 'exosphere';
        const hasMacroEndpoint = sourceNode?.scale === 'macrosphere' || targetNode?.scale === 'macrosphere';
        const hasRetiredEndpoint = [sourceNode, targetNode].some((node) => !node || node.status === 'rejected' || node.claimState === 'retired');
        if (!canonicalVerb || !hasInstitutionEndpoint || hasMacroEndpoint || hasRetiredEndpoint) {
          edge.status = 'rejected';
          edge.claimState = 'retired';
          appendSemanticMigrationNote(edge, 'Retired during migration because it is not a valid institutional Exosphere relationship.');
        } else {
          edge.verb = canonicalVerb;
        }
      }
    });
  });

  // If an earlier Meso item refers to a node that cannot serve as a Micro
  // setting, keep the referenced record but make the setting role explicit.
  scopedSettingIds.forEach((id) => {
    const node = nodesById.get(id);
    if (node?.scale === 'micro' && NODE_TYPES.includes(node.type)) node.type = 'setting';
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
    const incompatibleConnections = (['meso', 'macrosphere'].includes(reviewScale) && reviewConnections.length > 0)
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
  let migratedEdge = false;
  let migratedNode = false;
  let hadLegacyMesoData = false;
  const migrationNote = 'Migrated from an earlier Meso relationship model. Review this direct relationship in Micro before confirming its level.';
  const appendMigrationNote = (record) => {
    const notes = typeof record.notes === 'string' ? record.notes.trim() : '';
    if (!notes.includes(migrationNote)) record.notes = notes ? `${notes}\n\n${migrationNote}` : migrationNote;
  };
  ['candidates', 'graph'].forEach((container) => {
    const nodes = project?.[container]?.nodes;
    if (!Array.isArray(nodes)) return;
    nodes.forEach((node) => {
      if (!node || typeof node !== 'object' || Array.isArray(node) || node.scale !== 'meso' || node.type === MESOSYSTEM_NODE_TYPE) return;
      hadLegacyMesoData = true;
      node.scale = 'micro';
      if (node.status !== 'rejected' && node.claimState !== 'retired') {
        node.status = 'research lead';
        node.claimState = 'research lead';
        appendMigrationNote(node);
      }
      migratedNode = true;
    });
  });
  ['candidates', 'graph'].forEach((container) => {
    const edges = project?.[container]?.edges;
    const nodesById = new Map([
      ...(project?.graph?.nodes || []),
      ...(project?.candidates?.nodes || []),
    ].map((node) => [node.id, node]));
    if (!Array.isArray(edges)) return;
    edges.forEach((edge) => {
      if (!edge || typeof edge !== 'object' || Array.isArray(edge)) return;
      if (edge.scale !== 'meso') return;
      hadLegacyMesoData = true;
      edge.scale = 'micro';
      if (edge.status !== 'rejected' && edge.claimState !== 'retired') {
        edge.status = 'research lead';
        edge.claimState = 'research lead';
        appendMigrationNote(edge);
      }
      migratedEdge = true;
    });
  });
  if (migratedNode && Array.isArray(project.releasedScales) && !project.releasedScales.includes('micro')) {
    project.releasedScales.unshift('micro');
  }
  if (hadLegacyMesoData && Array.isArray(project.releasedScales) && !project.releasedScales.includes('meso')) {
    const microIndex = project.releasedScales.indexOf('micro');
    project.releasedScales.splice(microIndex >= 0 ? microIndex + 1 : project.releasedScales.length, 0, 'meso');
  }
  const reviewScale = project?.preflight?.configurationSnapshot?.activeScale || project?.activeScale;
  const review = project?.preflight?.memoReview;
  if (reviewScale === 'meso' && review && typeof review === 'object' && !Array.isArray(review)) {
    const hadLegacyConnections = Array.isArray(review.connections) && review.connections.length > 0;
    review.connections = [];
    review.example = null;
    review.nodes = (Array.isArray(review.nodes) ? review.nodes : []).filter((node) => node?.type === MESOSYSTEM_NODE_TYPE);
    if (hadLegacyConnections) {
      review.guidance = [{ point: 'Earlier Meso relationship suggestions need a new review. Direct relationship verbs now remain in Micro, and Meso identifies interrelations among two or more Micro settings.' }];
      review.readiness = { ready: review.nodes.length > 0, note: 'Review the Micro settings before choosing a mesosystem.' };
    }
  }
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
    if (Number.isInteger(migrated.stage)) {
      migrated.stage = collapseFiveStage(insertConnection ? insertConnectionStage(migrated.stage) : migrated.stage);
    }
    if (Number.isInteger(migrated.furthestStage)) {
      migrated.furthestStage = collapseFiveStage(insertConnection ? insertConnectionStage(migrated.furthestStage) : migrated.furthestStage);
    }
    Object.values(migrated.teacherGovernance || {}).forEach(canonicalizeStageId);
    canonicalizeStageId(migrated.preflight?.configurationSnapshot);
    if (migrated.portableExport && typeof migrated.portableExport === 'object' && !Array.isArray(migrated.portableExport)) {
      migrated.portableExport.schemaVersion = PROJECT_SCHEMA_VERSION;
    }
    migrated.schemaVersion = PROJECT_SCHEMA_VERSION;
    return migrateScaleVocabulary(migrateLegacyMappingSemantics(migrated));
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
  if (project?.schemaVersion === PROJECT_SCHEMA_VERSION) {
    // Earlier schema-v6 builds used verb-bearing Meso edges. Preserve those
    // records as Micro research leads so the student can review their level;
    // never infer a mesosystem scope from a legacy edge.
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
      addRedaction(redactions, `${path}[${index}].evidenceExcerpt`, reason);
    }
    record.evidenceRefs?.forEach((reference, referenceIndex) => {
      if (Object.hasOwn(reference, 'evidenceExcerpt')) {
        delete reference.evidenceExcerpt;
        addRedaction(redactions, `${path}[${index}].evidenceRefs[${referenceIndex}].evidenceExcerpt`, reason);
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
    return /^(?:(?:node|edge|evh|evidence|submission|src|cfg|evt|annotation|project)_[A-Za-z0-9._:-]+|[HC][0-9]+)$/.test(value);
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
    preservedReferenceFields: ['id', 'sourceId', 'evidenceId', 'evidenceHash', 'evidenceLocator'],
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
  if (![1, 2, 3, 4, 5, PROJECT_SCHEMA_VERSION].includes(parsed?.schemaVersion)) {
    throw new Error(`This file is not a supported Systems Mapping project. Expected schemaVersion 1, 2, 3, 4, 5, or ${PROJECT_SCHEMA_VERSION}.`);
  }
  return validateProject(discardRetiredNodeTags(migrateLegacyProject(parsed)));
}
