import { MICRO_NODE_TYPES, EXOSPHERE_NODE_TYPES } from '../src/domain.js';
import { MEMO_REVIEW_GUIDANCE_LIMIT, MEMO_REVIEW_SCALE_LIMITS } from './memo-review-limits.js';
import { RELATIONSHIP_STRENGTHS, RELATIONSHIP_STATUSES } from './relationship-process.js';

const text = maximum => ({ type: 'string', minLength: 1, maxLength: maximum });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const array = (items, maxItems) => ({ type: 'array', items, maxItems });
const choice = values => ({ type: 'string', enum: [...values] });

// Supply an explicit output contract to the model alongside the instructions.
// The server checks source evidence, label meaning, endpoint pairs and the
// complete review independently of the model response.
export function memoResponseSchema(scale, carriedNodes = [], evidencePassageCount = 0, carriedConnections = []) {
  const limits = MEMO_REVIEW_SCALE_LIMITS[scale];
  const ids = [...new Set(carriedNodes.filter(node => scale !== 'meso' || node.scale === 'micro').map(node => node.id))];
  const endpoint = ids.length ? choice(ids) : text(200);
  const evidence = maximum => evidencePassageCount ? { type: 'integer', minimum: 0, maximum: evidencePassageCount - 1 } : text(maximum);
  const process = object({
    direction: choice(['source to target', 'target to source', 'both directions', 'not yet known', 'varies']),
    strength: choice(RELATIONSHIP_STRENGTHS),
    connectionStatus: choice(RELATIONSHIP_STATUSES),
    familyCount: { type: ['integer', 'null'], minimum: 0 },
    ...Object.fromEntries(['frequency', 'duration', 'conditions', 'changeOverTime', 'channel', 'connectingWork'].map(field => [field, { type: 'string', maxLength: 1000 }])),
  }, []);
  return object({
    guidance: array(object({ point: text(500), evidenceExcerpt: evidence(500) }, ['point']), MEMO_REVIEW_GUIDANCE_LIMIT),
    nodes: array(object({ label: text(200), type: choice(scale === 'exosphere' ? EXOSPHERE_NODE_TYPES : MICRO_NODE_TYPES), scale: choice([scale]), evidence: evidence(500), ...(scale === 'exosphere' ? { basis: choice(['memo', 'inference']) } : {}) }), limits.nodes),
    connections: array(object({ source: endpoint, target: endpoint, verb: text(100), rationale: evidence(1000), relationshipProcess: process, ...(scale === 'macrosphere' && carriedConnections.some(edge => edge.id && edge.scale === 'meso') ? { relationshipIds: { type: 'array', minItems: 1, maxItems: 24, uniqueItems: true, items: choice(carriedConnections.filter(edge => edge.id && edge.scale === 'meso').map(edge => edge.id)) } } : {}) }, ['source', 'target', 'verb', 'rationale']), ids.length >= 2 ? limits.connections : 0),
    example: { type: 'null' },
    readiness: object({ ready: { type: 'boolean' }, note: text(500) }),
  });
}
