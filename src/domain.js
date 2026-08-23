import { SYSTEMS_MAPPING_STAGE_IDS } from '../shared/systems-mapping-stages.js';
import { SYSTEMS_MAPPING_PARTS } from '../shared/systems-mapping-parts.js';

export const SCALE_ORDER = ['micro', 'meso', 'exosphere', 'macrosphere'];
export const SCALE_PARTS = SYSTEMS_MAPPING_PARTS;

export const SCALES = {
  micro: {
    label: 'Micro',
    prompt: 'Where is your population present, and who interacts with them there?',
    description: 'Population, named settings, face-to-face roles, and participation.',
    checklist: [
      'Name every setting, using its real name, and add participation or demographic numbers when available.',
      'Name who meets your population face to face in each setting.',
      'Record whose voices you have heard and whose are missing.',
    ],
  },
  meso: {
    label: 'Meso',
    prompt: 'How do people from Micro connect across settings?',
    description: 'Connections among the same people and roles used in Micro.',
    checklist: [
      'Use the same names and roles as Micro, spelled the same way.',
      'Describe direction, strength, how each connection happens, and who keeps it going.',
      'Name missing connections and add numbers, affected families, or resources when available.',
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
    prompt: 'Which laws, beliefs, histories, and structures shape the whole system?',
    description: 'Law, policy, history, culture, ideology, and structural power.',
    checklist: [
      'Name laws, policies, public narratives, beliefs, and historical conditions.',
      'Show who each structure affects, how it shapes earlier layers, and what evidence supports that connection.',
      'Include community knowledge, counter-narratives, accountability, and possible change without turning them into individual deficits.',
    ],
  },
};

export const HARD_CRITERIA = [
  { id: 'H1', label: 'Memo detail', help: 'The memo includes enough detail to begin mapping.' },
  { id: 'H2', label: 'Sensitivity and permission', help: 'Sensitive material has documented permission or a privacy-safe treatment.' },
  { id: 'H3', label: 'Claims and interpretation', help: 'The student makes clear what the memo says and what they think it means.' },
  { id: 'H4', label: 'Map elements', help: 'The memo names enough elements for the active level. Micro requires nodes; later levels also examine connections.' },
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

export const NODE_TYPES = ['person', 'family', 'organization', 'agency', 'policy', 'resource', 'place', 'dataset', 'event'];
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
  zoomMin: 0.25,
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

const MICRO_NODE_PREDICATE = /\s+(?:(?:who|that|which)\s+)?(?:am|is|are|was|were|be|been|has|have|had|do|does|did|can|could|may|might|must|shall|should|will|would|provides?|provided|funds?|funded|regulates?|regulated|administers?|administered|requests?|requested|refers?|referred|serves?|served|qualifies?|qualified|excludes?|excluded|delays?|delayed|enables?|enabled|depends?|depended|coordinates?|coordinated|reports?|reported|measures?|measured|contests?|contested|litigates?|litigated|supersedes?|superseded|shapes?|shaped|contradicts?|contradicted|corroborates?|corroborated|faces?|faced|experiences?|experienced|meets?|met|interacts?|interacted|connects?|connected|receives?|received|uses?|used|attends?|attended|visits?|visited|works?|worked|helps?|helped|offers?|offered|manages?|managed|delivers?|delivered|lives?|lived)\b/i;
const MICRO_NODE_LEADING_CLAUSE = /^(?:when|where|because|while|although|if|unless|once|after|before)\s+/i;
const MICRO_NODE_ADDITIONAL_ENTITY = /\b(?:adults?|famil(?:y|ies)|people|persons?|participants?|students?|parents?|caregivers?|teachers?|residents?|children|workers?|navigators?|classrooms?|schools?|centers?|clinics?|homes?|neighbou?rhoods?|programs?|organizations?|agenc(?:y|ies)|offices?|departments?|committees?|services?|supports?|resources?|funding|transportation|access)\b/i;
const MICRO_NODE_NAMED_ENTITY = /(?:^|\s)(?:the\s+)?(?:[A-Z][A-Za-z0-9'’.-]*)(?:\s+(?:(?:of|for|and|the|in|at|on|with)\s+)?[A-Z][A-Za-z0-9'’.-]*)+/;

function cleanMicroNodeLabel(value) {
  if (typeof value !== 'string') return null;
  const label = normalizeWhitespace(value).replace(/^["'“”‘’\s]+|["'“”‘’\s.!?;,]+$/g, '');
  if (!label || label.length < 2 || label.length > 200 || !/[a-z]/i.test(label)) return null;
  if (/^(?:it|they|them|this|that|these|those|something|anything)$/i.test(label)) return null;
  return label;
}

const MICRO_NODE_AUXILIARY = /^(?:am|is|are|was|were|be|been|has|have|had|do|does|did|can|could|may|might|must|shall|should|will|would)$/i;

export function normalizeMicroNodeLabel(value) {
  const label = cleanMicroNodeLabel(value);
  if (!label) return null;
  const predicate = MICRO_NODE_PREDICATE.exec(label);
  if (!predicate) return label;
  // A verb-shaped FINAL word is part of the name, not a clause: institutional
  // names like "City Adult Literacy Fund", "Department of Public Works", or
  // "Annual Reports" end in content nouns the verb list would otherwise eat.
  // Auxiliaries ("The Center is") and relative clauses ("Navigator who works")
  // still read as fragments and keep the clause treatment.
  const matchedWord = predicate[0].trim();
  if (
    predicate.index + predicate[0].length >= label.length
    && !/^(?:who|that|which)\b/i.test(matchedWord)
    && !MICRO_NODE_AUXILIARY.test(matchedWord)
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
  return Boolean(label && normalizeMicroNodeLabel(label) === label);
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
  { verb: 'qualifies', pattern: '\\bqualif(?:y|ies)\\b' },
  { verb: 'excludes', pattern: '\\bexcludes?\\b' },
  { verb: 'delays', pattern: '\\bdelays?\\b', nominalAfter: /\b(?:face|faces|faced|experience|experiences|experienced)\s+$/i },
  { verb: 'burdens', pattern: '\\bburdens?\\b' },
  { verb: 'enables', pattern: '\\benables?\\b' },
  { verb: 'measures', pattern: '\\bmeasures?\\b' },
  { verb: 'contests', pattern: '\\bcontests?\\b' },
  { verb: 'litigates', pattern: '\\blitigates?\\b' },
  { verb: 'supersedes', pattern: '\\bsupersedes?\\b' },
  { verb: 'shapes', pattern: '\\bshapes?\\b' },
  { verb: 'contradicts', pattern: '\\bcontradicts?\\b' },
  { verb: 'corroborates', pattern: '\\bcorroborates?\\b' },
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
    .replace(/^(?:a|an|the|its|their|his|her|our|this|these|those)\s+/i, '')
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
  return !/^(?:it|they|them|this|that|these|those|something|anything)$/i.test(label);
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
  const label = displayLabel(candidate);
  return plausibleLabel(label) ? label : null;
}

function inferNodeType(label) {
  if (/\b(?:agenc(?:y|ies)|departments?|committees?|authorit(?:y|ies)|administrations?)\b/i.test(label)) return 'agency';
  if (/\b(?:organizations?|schools?|universit(?:y|ies)|colleges?|providers?|associations?|coalitions?|institutions?)\b/i.test(label)) return 'organization';
  if (/\b(?:polic(?:y|ies)|laws?|regulations?|statutes?|ordinances?|rules?)\b/i.test(label)) return 'policy';
  if (/\b(?:data|datasets?|surveys?|records?|evidence)\b/i.test(label)) return 'dataset';
  if (/\b(?:cities|city|counties|county|states?|neighbou?rhoods?|boroughs?|districts?|places?|regions?)\b/i.test(label)) return 'place';
  if (/\b(?:abilit(?:y|ies)|services?|supports?|funding|funds?|resources?|capacit(?:y|ies)|assets?|guidance|programs?|evaluations?|interviews?|eligibility|access)\b/i.test(label)) return 'resource';
  if (/\bfamil(?:y|ies)\b/i.test(label)) return 'family';
  if (/\b(?:adults?|persons?|people|participants?|students?|residents?|caregivers?|parents?|children|child|teachers?|workers?)\b/i.test(label)) return 'person';
  return 'event';
}

function inferScale(label, fallback = 'meso') {
  if (/\b(?:culture|ideolog(?:y|ies)|capitalism|racism|structural|public narratives?|counter-narratives?|histor(?:y|ies|ical)|rights?|laws?|regulations?)\b/i.test(label)) return 'macrosphere';
  if (/\b(?:states?|cities|city|federal|public systems?|departments?|agenc(?:y|ies)|offices?|funding|funders?|service systems?)\b/i.test(label)) return 'exosphere';
  if (/\b(?:organizations?|schools?|agenc(?:y|ies)|providers?|committees?|programs?|procedures?|institutions?)\b/i.test(label)) return 'meso';
  if (/\b(?:adults?|famil(?:y|ies)|persons?|participants?|students?|residents?|experiences?|interviews?|caregivers?|parents?)\b/i.test(label)) return 'micro';
  return fallback;
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
      const subject = subjectFromPrefix(prefix, currentSubject);
      const nextMatch = matches[index + 1];
      const rawObject = sentence.excerpt.slice(match.end, nextMatch?.index ?? sentence.excerpt.length);
      const object = objectFromSegment(rawObject, match.verb);
      const evidence = evidenceForSentence(submission, sentence);
      let sourceLabel = subject;
      let targetLabel = object;
      if (match.passive && subject && object) {
        sourceLabel = object;
        targetLabel = subject;
      }
      if (plausibleLabel(sourceLabel) && plausibleLabel(targetLabel) && sourceLabel.toLowerCase() !== targetLabel.toLowerCase()) {
        if (relationships.length >= PROJECT_LIMITS.edges) invalidProject('submission.text', `produces more than ${PROJECT_LIMITS.edges} relationship records`);
        const sourceScale = inferScale(sourceLabel, 'meso');
        const targetScale = inferScale(targetLabel, sourceScale);
        const scale = targetScale === 'exosphere' || targetScale === 'macrosphere' ? targetScale : sourceScale;
        relationships.push({ sourceLabel, targetLabel, verb: match.verb, scale, ...evidence });
        currentSubject = match.passive ? targetLabel : sourceLabel;
      } else if (subject) {
        currentSubject = subject;
      }
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
  const evidenceBoundary = locateEvidence({ ...submission, text }, /(according|data|interview|memo|reports?|shows?|evidence|testimony|should be checked)/i)
    || (submission.evidenceOwnership ? 'Memo and interpretation are tracked separately' : null);
  const hard = [
    result('H1', text.length >= 80 ? 'met' : 'unmet', text ? 'Memo text' : null, 'A usable memo needs enough detail to review.', 'Add more detail to the memo.', true),
    result('H2', !submission.sensitive || submission.consent ? 'met' : 'unmet', submission.sensitive ? 'Sensitivity declaration' : 'Marked non-sensitive', 'Sensitive material needs documented permission or a privacy-safe treatment.', 'Document permission or remove identifying details.', true),
    result('H3', evidenceBoundary ? 'met' : 'unmet', evidenceBoundary, 'At least one important point should name the evidence behind it.', 'Name the evidence behind one important point.', true),
    activeScale === 'micro'
      ? { ...result('H4', hasMicroNodes ? 'met' : 'unmet', mappedNodes[0]?.evidence || mappedNodes[0]?.evidenceLocator || null, 'Micro begins with at least two clearly named people, roles, groups, or settings.', 'Name at least two people, roles, groups, or settings that belong in the map.', true), nodeCount: mappedNodes.length }
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
const NODE_ONLY_PROPER_NOUN = /\b(?:[A-Z][A-Za-z'’.-]*|[A-Z]{2,}|\d+)(?:\s+(?:(?:of|for|and|the|in|at|on|with)\s+)?(?:[A-Z][A-Za-z'’.-]*|[A-Z]{2,}|\d+)){1,16}\b/g;
const NODE_ONLY_IGNORED_LABEL = /^(?:According to|Course Memo|Memo Sentence|This Memo|The Memo|What Evidence|No Evidence)$/i;

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
  const relationships = extractRelationships(submission);
  relationships.forEach((relationship) => {
    [relationship.sourceLabel, relationship.targetLabel].forEach((label) => {
      const key = label.toLowerCase();
      const evidenceRef = {
        evidenceId: relationship.evidenceId,
        sourceId: relationship.sourceId,
        evidenceLocator: relationship.evidenceLocator,
        evidenceExcerpt: relationship.evidenceExcerpt,
        evidenceHash: relationship.evidenceHash,
      };
      if (!nodeMap.has(key)) {
        nodeMap.set(key, {
          id: stableId('node', label), label, type: inferNodeType(label), scale: inferScale(label, relationship.scale),
          status: 'pending', claimState: 'inference', evidence: relationship.evidence,
          ...evidenceRef, evidenceRefs: [evidenceRef], notes: '',
        });
      } else {
        const node = nodeMap.get(key);
        if (!node.evidenceRefs.some((item) => item.evidenceId === evidenceRef.evidenceId)) node.evidenceRefs.push(evidenceRef);
      }
    });
  });
  if (!nodeMap.size) {
    sentenceRecords(submission.text || '').forEach((sentence) => {
      const evidence = evidenceForSentence(submission, sentence);
      const evidenceRef = {
        evidenceId: evidence.evidenceId,
        sourceId: evidence.sourceId,
        evidenceLocator: evidence.evidenceLocator,
        evidenceExcerpt: evidence.evidenceExcerpt,
        evidenceHash: evidence.evidenceHash,
      };
      nodeOnlyLabels(sentence.excerpt).forEach((label) => {
        const key = label.toLocaleLowerCase();
        if (!nodeMap.has(key)) {
          nodeMap.set(key, {
            id: stableId('node', label),
            label,
            type: inferNodeType(label),
            scale: inferScale(label, 'micro'),
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
        if (!node.evidenceRefs.some((item) => item.evidenceId === evidenceRef.evidenceId)) node.evidenceRefs.push(evidenceRef);
      });
    });
  }
  if (nodeMap.size > PROJECT_LIMITS.nodes) invalidProject('submission.text', `produces more than ${PROJECT_LIMITS.nodes} node records`);
  const nodes = withDefaultNodeLayout([...nodeMap.values()]);
  const edgeMap = new Map();
  relationships.forEach((relationship) => {
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
        source: stableId('node', relationship.sourceLabel),
        target: stableId('node', relationship.targetLabel),
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
  micro: Object.freeze({ nodes: 10, connections: 0 }),
  meso: Object.freeze({ nodes: 0, connections: 8 }),
  exosphere: Object.freeze({ nodes: 8, connections: 6 }),
  macrosphere: Object.freeze({ nodes: 8, connections: 6 }),
});

export function deterministicMemoReview(submission, activeScale = 'micro', { carriedNodes = [], carriedConnections = [] } = {}) {
  const scaleLimits = DETERMINISTIC_REVIEW_SCALE_LIMITS[activeScale] || DETERMINISTIC_REVIEW_SCALE_LIMITS.micro;
  const { nodes, edges } = extractCandidates(submission);
  const carriedNodeByLabel = new Map(carriedNodes.map((node) => [String(node.label || '').trim().toLocaleLowerCase(), node]));
  const carriedConnectionKeys = new Set(carriedConnections
    .map((connection) => `${connection.source}::${String(connection.verb || '').trim().toLocaleLowerCase()}::${connection.target}`));
  const orderedNodes = [...nodes].sort((left, right) => Number(right.scale === activeScale) - Number(left.scale === activeScale));
  // Elements already on the student's map never come back as new proposals;
  // later levels surface only what the memo adds beyond the carried graph.
  const reviewNodes = (activeScale === 'meso' ? [] : orderedNodes)
    .filter((node) => !carriedNodeByLabel.has(node.label.trim().toLocaleLowerCase()))
    .slice(0, Math.min(scaleLimits.nodes, PROJECT_LIMITS.memoReviewNodes))
    .map((node) => ({
      label: node.label,
      type: node.type,
      scale: activeScale,
      evidence: truncateCollapsedText(node.evidenceExcerpt || node.evidence || '', PROJECT_LIMITS.memoGuidanceEvidence),
    }));
  const nodeLabels = new Set(reviewNodes.map((node) => node.label));
  const endpointFor = (label) => {
    const carried = carriedNodeByLabel.get(label.trim().toLocaleLowerCase());
    if (carried) return { reference: carried.id, label: carried.label };
    return nodeLabels.has(label) ? { reference: label, label } : null;
  };
  const connections = activeScale === 'micro' ? [] : edges
    .map((edge) => {
      if (activeScale === 'meso') {
        const carriedSource = carriedNodeByLabel.get(edge.sourceLabel.trim().toLocaleLowerCase());
        const carriedTarget = carriedNodeByLabel.get(edge.targetLabel.trim().toLocaleLowerCase());
        if (!carriedSource || !carriedTarget) return null;
        return { edge, source: carriedSource, target: carriedTarget };
      }
      const source = endpointFor(edge.sourceLabel);
      const target = endpointFor(edge.targetLabel);
      if (!source || !target || source.reference === target.reference) return null;
      return { edge, source: { id: source.reference, label: source.label }, target: { id: target.reference, label: target.label } };
    })
    .filter(Boolean)
    // Relationships already on the student's map are settled; the review only
    // surfaces what this memo pass adds.
    .filter(({ edge, source, target }) => !carriedConnectionKeys.has(`${source.id}::${edge.verb.trim().toLocaleLowerCase()}::${target.id}`))
    .slice(0, Math.min(scaleLimits.connections || PROJECT_LIMITS.memoReviewConnections, PROJECT_LIMITS.memoReviewConnections))
    .map(({ edge, source, target }) => ({
      source: source.id,
      target: target.id,
      sourceLabel: source.label,
      targetLabel: target.label,
      verb: edge.verb,
      rationale: truncateCollapsedText(edge.evidenceExcerpt || edge.rationale || '', PROJECT_LIMITS.rationaleText),
    }));
  const guidance = activeScale === 'micro'
    ? (reviewNodes.length ? [{
      point: truncateCollapsedText(`The memo names ${reviewNodes.length} possible ${reviewNodes.length === 1 ? 'node' : 'nodes'}: ${reviewNodes.map((node) => node.label).join(', ')}.`, PROJECT_LIMITS.memoGuidanceText),
      ...(reviewNodes[0].evidence ? { evidenceExcerpt: truncateCollapsedText(reviewNodes[0].evidence, PROJECT_LIMITS.memoGuidanceEvidence) } : {}),
    }] : [])
    : connections.slice(0, 4).map((connection) => ({
      point: truncateCollapsedText(`${connection.sourceLabel} ${connection.verb} ${connection.targetLabel}.`, PROJECT_LIMITS.memoGuidanceText),
      ...(connection.rationale ? { evidenceExcerpt: truncateCollapsedText(connection.rationale, PROJECT_LIMITS.memoGuidanceEvidence) } : {}),
    }));
  if (!guidance.length) {
    guidance.push({ point: activeScale === 'micro'
      ? 'No clearly named people, roles, groups, or settings were found. You can continue and add nodes yourself.'
      : 'No clear connections were found. You can continue and describe them yourself.' });
  }
  const first = connections[0] || null;
  const example = first
    ? truncateCollapsedText(`${first.sourceLabel} ${first.verb} ${first.targetLabel}. ${first.rationale || ''}`, PROJECT_LIMITS.memoReviewExample)
    : null;
  // Carried map elements count toward readiness at Exosphere and Macrosphere:
  // a memo that only connects existing elements is still real progress.
  const ready = activeScale === 'meso'
    ? carriedNodes.length >= 2 && connections.length >= 1
    : activeScale === 'micro'
      ? reviewNodes.length >= 2
      : (reviewNodes.length + carriedNodes.length) >= 2 && connections.length >= 1;
  const outerNote = reviewNodes.length
    ? `The memo names ${reviewNodes.length} new ${reviewNodes.length === 1 ? 'element' : 'elements'} and ${connections.length} ${connections.length === 1 ? 'connection' : 'connections'}. Continue to choose what belongs in the map.`
    : `The memo describes ${connections.length} ${connections.length === 1 ? 'connection' : 'connections'} among elements already on your map. Continue to choose which ones belong.`;
  const readiness = {
    ready,
    note: truncateCollapsedText(ready
      ? activeScale === 'micro'
        ? `The memo names ${reviewNodes.length} possible nodes. Continue to choose which ones belong in the Micro map.`
        : activeScale === 'meso'
          ? `The memo describes ${connections.length} ${connections.length === 1 ? 'connection' : 'connections'} among nodes carried from Micro. Continue to choose which connections belong in the map.`
          : outerNote
      : activeScale === 'micro'
        ? 'Fewer than two possible nodes were found. You can continue, or name more people, roles, groups, or settings in the memo.'
        : activeScale === 'meso'
          ? 'No clear connections among the nodes from Micro were found. You can continue, or describe those connections in the memo.'
          : 'No clear new elements or connections were found. You can continue, or name the institutions, policies, or beliefs at work in the memo.', PROJECT_LIMITS.memoGuidanceText),
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
  label: 'Grounded preflight evaluator',
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
  fixedPrompt: `${BASE_GUARDRAILS}\nPropose only operations appropriate to the active level: nodes only for Micro, connections among carried nodes for Meso, and nodes plus connections for Exosphere and Macrosphere. Never apply an operation without student confirmation.`,
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
      requireStudentConfirmation: true,
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
const NODE_KEYS = ['id', 'label', 'type', 'scale', 'status', 'claimState', 'notes', 'x', 'y', 'annotations', 'sourceFingerprint', ...EVIDENCE_KEYS];
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
    if (node.scale === 'meso') invalidProject(`${itemPath}.scale`, 'must use Micro for nodes; Meso records relationships between Micro nodes');
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
    validateEvidence(node, itemPath);
  });
  return ids;
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
    if (edge.scale === 'micro') invalidProject(`${itemPath}.scale`, 'must use Meso for relationships; Micro contains nodes only');
    assertEnum(edge.status, CANDIDATE_STATUSES, `${itemPath}.status`);
    assertEnum(edge.claimState, CLAIM_STATES, `${itemPath}.claimState`);
    if (edge.scale === 'meso') {
      const sourceNode = nodesById.get(edge.source);
      const targetNode = nodesById.get(edge.target);
      if (sourceNode?.scale !== 'micro') invalidProject(`${itemPath}.source`, 'must reference a Micro node for a Meso relationship');
      if (targetNode?.scale !== 'micro') invalidProject(`${itemPath}.target`, 'must reference a Micro node for a Meso relationship');
      const relationshipIsLive = edge.status !== 'rejected' && edge.claimState !== 'retired';
      if (relationshipIsLive && (sourceNode?.status === 'rejected' || sourceNode?.claimState === 'retired')) invalidProject(`${itemPath}.source`, 'must reference a live Micro node');
      if (relationshipIsLive && (targetNode?.status === 'rejected' || targetNode?.claimState === 'retired')) invalidProject(`${itemPath}.target`, 'must reference a live Micro node');
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
    if (item.evidenceExcerpt !== undefined) assertString(item.evidenceExcerpt, `${itemPath}.evidenceExcerpt`, false, PROJECT_LIMITS.memoGuidanceEvidence);
  });
  if (!Array.isArray(review.nodes) || review.nodes.length > PROJECT_LIMITS.memoReviewNodes) {
    invalidProject(`${path}.nodes`, `must be an array of no more than ${PROJECT_LIMITS.memoReviewNodes} nodes`);
  }
  review.nodes.forEach((node, index) => {
    const nodePath = `${path}.nodes[${index}]`;
    assertObject(node, nodePath);
    assertKnownKeys(node, ['label', 'type', 'scale', 'evidence'], nodePath);
    assertString(node.label, `${nodePath}.label`, false, 200);
    assertEnum(node.type, NODE_TYPES, `${nodePath}.type`);
    assertEnum(node.scale, SCALE_ORDER, `${nodePath}.scale`);
    assertString(node.evidence, `${nodePath}.evidence`, true, PROJECT_LIMITS.memoGuidanceEvidence);
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
    if (connection.source === connection.target) invalidProject(`${connectionPath}.target`, 'must differ from source');
    assertString(connection.verb, `${connectionPath}.verb`, false, 100);
    assertString(connection.rationale, `${connectionPath}.rationale`, true, PROJECT_LIMITS.rationaleText);
  });
  if (review.example !== null) assertString(review.example, `${path}.example`, false, PROJECT_LIMITS.memoReviewExample);
  assertObject(review.readiness, `${path}.readiness`);
  assertKnownKeys(review.readiness, ['ready', 'note'], `${path}.readiness`);
  assertBoolean(review.readiness.ready, `${path}.readiness.ready`);
  assertString(review.readiness.note, `${path}.readiness.note`, true, PROJECT_LIMITS.memoGuidanceText);
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
  return rewritten;
}

function migrateLegacyMappingSemantics(project) {
  let migratedEdge = false;
  let migratedNode = false;
  ['candidates', 'graph'].forEach((container) => {
    const nodes = project?.[container]?.nodes;
    if (!Array.isArray(nodes)) return;
    nodes.forEach((node) => {
      if (!node || typeof node !== 'object' || Array.isArray(node) || node.scale !== 'meso') return;
      node.scale = 'micro';
      migratedNode = true;
    });
  });
  ['candidates', 'graph'].forEach((container) => {
    const edges = project?.[container]?.edges;
    const nodesById = new Map((project?.[container]?.nodes || []).map((node) => [node.id, node]));
    if (!Array.isArray(edges)) return;
    edges.forEach((edge) => {
      if (!edge || typeof edge !== 'object' || Array.isArray(edge)) return;
      if (edge.scale === 'micro') {
        edge.scale = 'meso';
        migratedEdge = true;
        return;
      }
      if (edge.scale !== 'meso') return;
      const endpointScales = [nodesById.get(edge.source)?.scale, nodesById.get(edge.target)?.scale];
      const outerEndpoint = ['integration', 'macrosphere', 'macro', 'exosphere']
        .find((scale) => endpointScales.includes(scale));
      if (outerEndpoint) edge.scale = outerEndpoint;
    });
  });
  if (migratedEdge && Array.isArray(project.releasedScales) && !project.releasedScales.includes('meso')) {
    const microIndex = project.releasedScales.indexOf('micro');
    project.releasedScales.splice(microIndex >= 0 ? microIndex + 1 : project.releasedScales.length, 0, 'meso');
  }
  if (migratedNode && Array.isArray(project.releasedScales) && !project.releasedScales.includes('micro')) {
    project.releasedScales.unshift('micro');
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
    // Early schema-v6 builds still wrote nodes at Meso and relationships at
    // Micro. Normalize those records idempotently before strict validation so
    // an existing local or linked project is repaired without losing IDs,
    // evidence, annotations, or geometry.
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
  return validateProject(migrateLegacyProject(parsed));
}
