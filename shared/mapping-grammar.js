// One cumulative map, with two node → relationship exercises. Internal level
// IDs stay stable so existing maps, notes, profiles and links remain readable.
export const NODE_REVIEW_SCALES = Object.freeze(['micro', 'exosphere']);
export const RELATIONSHIP_REVIEW_SCALES = Object.freeze(['meso', 'macrosphere']);
const order = ['micro', 'meso', 'exosphere', 'macrosphere'];
export const isNodeReviewScale = scale => NODE_REVIEW_SCALES.includes(scale);
export const isRelationshipReviewScale = scale => RELATIONSHIP_REVIEW_SCALES.includes(scale);
export const nodeScaleFor = scale => scale === 'meso' ? 'micro' : scale === 'macrosphere' ? 'exosphere' : scale;
export const canConnectAtScale = (scale, node) => Boolean(node && order.includes(node.scale) && order.indexOf(node.scale) <= order.indexOf(scale));
export const cumulativeScales = (scale, released) => scale === 'all' ? released : released.filter(level => order.indexOf(level) <= order.indexOf(scale));
