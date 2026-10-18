// Per-level ceilings for one memo review. The validator, the schema text and
// the Gateway adapter's compact instruction all read these numbers, so the
// model is never told two different limits in one request.
export const MEMO_REVIEW_SCALE_LIMITS = Object.freeze({
  micro: Object.freeze({ nodes: 10, connections: 8 }),
  meso: Object.freeze({ nodes: 6, connections: 0, scope: 12 }),
  exosphere: Object.freeze({ nodes: 6, connections: 5 }),
  macrosphere: Object.freeze({ nodes: 6, connections: 0, scope: 12 }),
});

export const MEMO_REVIEW_GUIDANCE_LIMIT = 3;

export const MAP_CHECK_LIMITS = Object.freeze({ notes: 4, point: 300, refs: 4, memoExcerpt: 4000 });

// Which note kinds each Map Check intent may return. Every intent may ask a
// question; none may propose a new map element.
export const MAP_CHECK_INTENTS = Object.freeze({
  gaps: Object.freeze(['gap', 'question']),
  connection: Object.freeze(['evidence', 'question']),
  synthesis: Object.freeze(['claim', 'question']),
});

const ITEM_NOUNS = Object.freeze({
  micro: ['nodes', 'direct relationships'],
  meso: ['mesosystems', null],
  exosphere: ['outside decision settings', 'pathways'],
  macrosphere: ['structures', null],
});

/** Short, scale-correct ceiling sentence for the Gateway's second system message. */
export function compactLimitInstruction(kind, scale) {
  if (kind === 'connections') return 'For a connections-only request, return only the required connections object with at most 12 connections.';
  if (kind === 'map-check') return `For a map check, return only the required notes object with at most ${MAP_CHECK_LIMITS.notes} notes, each tied to supplied map IDs; never propose new map elements.`;
  const limits = MEMO_REVIEW_SCALE_LIMITS[scale] || MEMO_REVIEW_SCALE_LIMITS.micro;
  const [nodeNoun, connectionNoun] = ITEM_NOUNS[scale] || ITEM_NOUNS.micro;
  const connections = connectionNoun && limits.connections ? ` and ${limits.connections} ${connectionNoun}` : ', with an empty connections array';
  return `For a memo review, return at most ${MEMO_REVIEW_GUIDANCE_LIMIT} guidance points, ${limits.nodes} ${nodeNoun}${connections}, or fewer under the active-scale rules. Use brief evidence and only the clearest supported items; do not fill a quota. Guidance is an array of objects, not a paragraph or an object.`;
}
