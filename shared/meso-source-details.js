import { analyzeMemoSource } from './memo-source.js';
import { canonicalQuoteText } from './memo-quote-match.js';

const normalized = value => canonicalQuoteText(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const mentions = (text, label) => Boolean(label && (` ${normalized(text)} `).includes(` ${normalized(label)} `));
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelPattern = label => normalized(label).split(' ').map(escape).join('[\\s\\p{P}]+');
const unique = values => [...new Map(values.map(value => [normalized(value), value])).values()];
const only = values => values.length === 1 ? values[0] : null;
const UNCERTAIN = /\b(?:may|might|could|perhaps|possibly|whether|unverified|unclear|unknown|investigat(?:e|ing)|propos(?:e|ed)|planned|hypothetical)\b/iu;
const NEGATED_VALUE = /\b(?:not|no|never|without)\s+(?:[\p{L}-]+\s+){0,5}$/iu;
const RELATION_NOUN = '(?:connection|relationship|communication|contact|exchange|link|collaboration|coordination)';
const CHANNEL = '(?:email|e-mail|phone|telephone|shared system|shared database|paper forms?|WhatsApp|text messages?|SMS|in person|face-to-face)';
const COMMUNICATION_VERB = '(?:communicat\\w*|exchang\\w*|speak\\w*|spoke|talk\\w*|contact\\w*|send\\w*|sent|receiv\\w*|refer\\w*|call\\w*|meet\\w*|met|coordinat\\w*|carr(?:y|ies|ied)|deliver\\w*|transport\\w*)';

// Split prose without breaking titles, initials, school numbers, or decimals.
// Offsets refer to the original memo, so returned passages remain exact slices.
function narrativeSentences(source) {
  // Table cells use their own headers for meaning. Keep offsets stable while
  // excluding table rows from sentence-level inference.
  const text = source.narrativeText.replace(/^\s*\|[^\n]*\|\s*$/gmu, line => line.replace(/[^\n]/gu, ' '));
  const result = [];
  let start = 0;
  const append = end => {
    const part = text.slice(start, end);
    const leading = part.search(/\S/u);
    if (leading >= 0) {
      const trailing = part.match(/\s*$/u)[0].length;
      result.push(source.text.slice(start + leading, end - trailing));
    }
    start = end;
  };
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n' && /\n\s*\n/u.test(text.slice(index, index + 6))) { append(index); continue; }
    if (!/[.!?]/u.test(text[index])) continue;
    const ending = text.slice(index + 1).match(/^["'”’)]*/u)[0].length;
    const end = index + 1 + ending;
    if (end < text.length && !/\s/u.test(text[end])) continue;
    if (text[index] === '.') {
      const token = text.slice(start, index + 1).match(/[^\s]+$/u)?.[0] || '';
      if (/^(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|No|Dept|Inc|Co)\.$/iu.test(token)
        || /^(?:[\p{L}]{1,3}\.){2,}$/u.test(token)
        || (/^[\p{Lu}]\.$/u.test(token) && /^\s+[\p{Lu}]/u.test(text.slice(end)))) continue;
    }
    append(end);
    index = end - 1;
  }
  append(text.length);
  return result;
}

/** Recognize the assignment's explicitly labeled relationship table. */
export function mesoTableRows(sourceMaterial) {
  const rows = [];
  let columns = null;
  for (const line of analyzeMemoSource(sourceMaterial).narrativeText.split('\n')) {
    if (!/^\s*\|.*\|\s*$/u.test(line)) { columns = null; continue; }
    const cells = line.trim().slice(1, -1).split(/(?<!\\)\|/u).map(cell => cell.trim());
    const labels = cells.map(normalized);
    const people = labels.findIndex(label => /^people connected\b/u.test(label));
    const rating = labels.findIndex(label => /^strength (?:and )?direction\b/u.test(label));
    const method = labels.findIndex(label => /^method (?:and )?connector\b/u.test(label));
    const evidence = labels.findIndex(label => /^evidence source\b/u.test(label));
    if ([people, rating, method, evidence].every(index => index >= 0)) { columns = { people, rating, method, evidence, count: labels.findIndex(label => /^(?:children families|families|households) affected\b/u.test(label)), length: cells.length }; continue; }
    if (!columns || cells.length !== columns.length || cells.every(cell => /^:?-+:?$/u.test(cell))) continue;
    const row = { raw: line.trim(), people: cells[columns.people], rating: cells[columns.rating], method: cells[columns.method], evidence: cells[columns.evidence], count: columns.count >= 0 ? cells[columns.count] : '' };
    // A planned interview is a proposed investigation even when its template
    // contains an example rating. Unknown population counts affect only counts.
    if (/\bplanned\b|\bplan to (?:interview|observe|verify)\b|\bresearch plan\b/iu.test(row.evidence)) continue;
    rows.push(row);
  }
  return rows;
}

function tableFacts(row) {
  const strengths = unique([...row.rating.matchAll(/\b(strong|weak|contested)\b/giu)].map(match => match[1].toLowerCase()));
  const missing = /\bmissing\b|\bno\s+(?:clear\s+)?communication\b/iu.test(row.rating);
  const directions = /\b(?:both directions|two[ -]way|bidirectional)\b/iu.test(row.rating) ? ['both directions']
    : /\b(?:one[ -]way|unidirectional)\b/iu.test(row.rating) ? ['one direction'] : [];
  const channels = unique([...row.method.matchAll(/\b(?:radio\/walkie-talkies|school portals|email|e-mail|phone|telephone|shared system|shared database|paper forms?|WhatsApp|text messages?|SMS|in person|face-to-face)\b/giu)].map(match => match[0]));
  return { strengths, directions, channels, familyCounts: explicitFamilyCounts('communication for ' + row.count),
    connectionStatuses: missing ? ['missing'] : strengths.length ? ['observed'] : [] };
}

function explicitFamilyCounts(passage) {
  const values = [];
  const pattern = /(?<![\p{L}\p{N}.,%+\-‐‑‒–—―−])(?:\d{1,3}(?:,\d{3})+|\d+)\s+(?:famil(?:y|ies)|households)\b/giu;
  for (const match of passage.matchAll(pattern)) {
    const before = passage.slice(Math.max(0, match.index - 45), match.index);
    if (/\b(?:about|around|roughly|approximately|at least|at most|more than|less than|fewer than|up to|over|under)\s*$/iu.test(before)
      || /\d+\s*(?:to|through|and)\s*$/iu.test(before)) continue;
    const context = passage.slice(0, match.index);
    if (!/\b(?:for|with|across|among|serving|supporting|reaching|involving|covering)\s*$/iu.test(before)
      || !new RegExp(`\\b(?:${RELATION_NOUN}|${COMMUNICATION_VERB})\\b`, 'iu').test(context)) continue;
    const count = Number(match[0].match(/^[\d,]+/u)[0].replaceAll(',', ''));
    if (Number.isSafeInteger(count) && count >= 0) values.push(count);
  }
  return values;
}

function relationshipDirections(passage) {
  const directions = [];
  for (const match of passage.matchAll(/\b(?:both directions|two-way|two way|bidirectional|one-way|one way|unidirectional)\b/giu)) {
    const before = passage.slice(Math.max(0, match.index - 100), match.index);
    const after = passage.slice(match.index + match[0].length);
    if (NEGATED_VALUE.test(before)) continue;
    const noun = new RegExp(`^\\s+(?:${CHANNEL}\\s+)?${RELATION_NOUN}\\b`, 'iu').test(after);
    const communication = new RegExp(`\\b${COMMUNICATION_VERB}\\b[^.!?;]{0,80}$`, 'iu').test(before)
      && !/\b(?:while|look\w*|walk\w*|cross\w*)\b/iu.test(before);
    if (noun || communication) directions.push(/^(?:one|uni)/iu.test(match[0]) ? 'one direction' : 'both directions');
  }
  return directions;
}

function relationshipStrengths(passage) {
  const modifiers = `(?:(?:direct|regular|mutual|ongoing|two-way|two way|${CHANNEL})\\s+){0,3}`;
  const attributive = new RegExp(`\\b(strong|weak|contested)\\s+${modifiers}${RELATION_NOUN}\\b`, 'giu');
  const predicate = new RegExp(`\\b${RELATION_NOUN}\\s+(?:(?:is|was|remains|seems|appears)\\s+|(?:is|was)\\s+(?:described|rated)\\s+as\\s+)(?:very\\s+)?(strong|weak|contested)\\b`, 'giu');
  return [...passage.matchAll(attributive), ...passage.matchAll(predicate)]
    .filter(match => !NEGATED_VALUE.test(passage.slice(Math.max(0, match.index - 35), match.index)))
    .map(match => match[1].toLowerCase());
}

function relationshipChannels(passage, labels) {
  const result = [];
  const actor = `(?:${labels.map(labelPattern).join('|')})`;
  for (const match of passage.matchAll(new RegExp(`\\b${CHANNEL}\\b`, 'giu'))) {
    const before = passage.slice(Math.max(0, match.index - 100), match.index);
    const after = passage.slice(match.index + match[0].length);
    // A channel must describe the connection or how communication travels.
    // Merely holding a phone, discussing email, or watching paper forms gives
    // no evidence about this pair's communication channel.
    const noun = new RegExp(`^\\s+(?:(?:direct|regular|two-way|strong|weak)\\s+){0,2}${RELATION_NOUN}\\b`, 'iu').test(after);
    const transport = new RegExp(`\\b${COMMUNICATION_VERB}\\b[^.!?;,]{0,65}\\b(?:by|via|over|through|using|on)\\s+(?:the\\s+)?$`, 'iu').test(before)
      && !/\b(?:while|when|although|because|about)\b/iu.test(before);
    const object = /^(?:email|e-mail|paper forms?|text messages?|SMS)$/iu.test(match[0])
      && new RegExp(`\\b${actor}(?:\\s+and\\s+(?:the\\s+)?${actor})?\\s+(?:(?:regularly|personally|also)\\s+)?(?:send\\w*|sent|receiv\\w*|exchang\\w*|carr(?:y|ies|ied)|deliver\\w*|transport\\w*)\\s+(?:(?:updates|messages|information)\\s+(?:on|through)\\s+)?(?:the\\s+)?$`, 'iu').test(before);
    const meeting = /^(?:in person|face-to-face)$/iu.test(match[0])
      && new RegExp(`\\b(?:meet\\w*|met|talk\\w*|speak\\w*|spoke|communicat\\w*)\\b[^.!?;,]{0,60}$`, 'iu').test(before);
    if (noun || transport || object || meeting) result.push(match[0]);
  }
  return result;
}

function explicitMissingPair(passage, sourceLabel, targetLabel) {
  const absence = '(?:no|without)\\s+(?:(?:direct|regular|documented|recorded|known|phone|telephone|email|e-mail|two-way|reliable)\\s+){0,4}(?:contact|communication|connection|exchange)';
  const negativeAction = '(?:(?:do|does|have|has)\\s+not\\s+(?:(?:yet|currently|ever)\\s+)?|never\\s+)(?:communicat\\w*|contact\\w*|exchang\\w*|spok\\w*|speak\\w*|talk\\w*)';
  return [[sourceLabel, targetLabel], [targetLabel, sourceLabel]].some(([first, second]) => {
    const a = labelPattern(first), b = labelPattern(second);
    return new RegExp(`\\b${a}\\s+(?:(?:has|have)\\s+${absence}\\s+with|${negativeAction}\\s+with)\\s+(?:the\\s+)?${b}\\b`, 'iu').test(passage)
      || new RegExp(`\\b${a}\\s+and\\s+(?:the\\s+)?${b}\\s+(?:(?:have|has)\\s+${absence}|${negativeAction})(?:\\s+with\\s+(?:one another|each other))?(?=[,.!?;]|$|\\s+(?:for|during|because)\\b)`, 'iu').test(passage)
      || new RegExp(`\\b${absence}\\s+between\\s+(?:the\\s+)?${a}\\s+and\\s+(?:the\\s+)?${b}\\b`, 'iu').test(passage);
  });
}

/** Missing pairs explicitly named in narrative; parse the memo once. */
export function explicitMissingMesoPairs(sourceMaterial, carriedNodes = []) {
  const nodes = carriedNodes.filter(node => typeof node?.label === 'string' && normalized(node.label));
  const result = [], seen = new Set();
  for (const passage of narrativeSentences(analyzeMemoSource(sourceMaterial))) {
    if (UNCERTAIN.test(passage) || passage.trimEnd().endsWith('?')) continue;
    const named = nodes.filter(node => mentions(passage, node.label));
    if (named.length !== 2 || !explicitMissingPair(passage, named[0].label, named[1].label)) continue;
    const key = named.map(node => normalized(node.label)).sort().join('\u0000');
    if (!seen.has(key)) { seen.add(key); result.push(named); }
  }
  for (const row of mesoTableRows(sourceMaterial)) {
    if (!tableFacts(row).connectionStatuses.includes('missing')) continue;
    const named = nodes.filter(node => mentions(row.people, node.label));
    if (named.length !== 2) continue;
    const key = named.map(node => normalized(node.label)).sort().join('\u0000');
    if (!seen.has(key)) { seen.add(key); result.push(named); }
  }
  return result;
}

function passageStatus(passage) {
  const absent = /\b(?:no|without)\s+(?:(?:direct|regular|documented|recorded|known|phone|telephone|email|e-mail|two-way|reliable)\s+){0,4}(?:contact|communication|connection|exchange)\b|\b(?:does|do|has|have|is|are)\s+not\s+(?:(?:yet|currently|in|any|direct|regular|ever)\s+){0,3}(?:contact|communicat\w*|connect\w*|exchang\w*|spok\w*|speak\w*|talk\w*)\b|\bnever\s+(?:communicat\w*|contact\w*|exchang\w*|spok\w*|speak\w*|talk\w*)\b|\b(?:missing|absent)\s+(?:connection|communication|contact|link)\b/iu.test(passage);
  const positive = /\b(?:communicates?|exchanges?|speaks?|talks?|contacts?|sends?|receives?|refers?|calls?|meets?|coordinates?)\b|\b(?:maintains?|has|have)\b[^.!?]{0,100}\b(?:connection|contact|communication|exchange|link)\b/iu.test(passage);
  return absent ? 'missing' : positive && !/\b(?:no|not|never|without)\b/iu.test(passage) ? 'observed' : null;
}

function explicitConnector(passage, labels) {
  return labels.filter(label => {
    const name = labelPattern(label);
    return new RegExp(`\\b${name}\\s+(?:(?:personally|regularly|also)\\s+)?(?:carries|transports|delivers|performs the connecting work|does the connecting work)\\b`, 'iu').test(passage)
      || new RegExp(`\\b(?:connecting work|coordination)\\s+(?:is\\s+)?(?:done|performed|carried)\\s+by\\s+(?:the\\s+)?${name}\\b`, 'iu').test(passage);
  });
}

/** Conservative evidence for one explicit Meso pair; never fills model output. */
function detailsFromPassages(passages, sourceLabel, targetLabel, tableRows = []) {
  const facts = tableRows.map(tableFacts);
  const strengths = unique([...passages.flatMap(relationshipStrengths), ...facts.flatMap(fact => fact.strengths)]);
  // A missing phone contact still has a documented channel; status distinguishes
  // it from an existing exchange. Do not discard the noun because of "no phone".
  const channels = unique([...passages.flatMap(passage => relationshipChannels(passage, [sourceLabel, targetLabel])), ...facts.flatMap(fact => fact.channels)]);
  const familyCounts = [...new Set([...passages.flatMap(explicitFamilyCounts), ...facts.flatMap(fact => fact.familyCounts)])];
  const connectionStatuses = [...new Set(passages.map(passage => {
    const status = passageStatus(passage);
    return status === 'missing' && !explicitMissingPair(passage, sourceLabel, targetLabel) ? null : status;
  }).filter(Boolean).concat(facts.flatMap(fact => fact.connectionStatuses)))];
  const directions = unique([...passages.flatMap(relationshipDirections), ...facts.flatMap(fact => fact.directions)]);
  const connectors = unique(passages.flatMap(passage => explicitConnector(passage, [sourceLabel, targetLabel])));
  const conflicts = [['strength', strengths], ['familyCount', familyCounts], ['connectionStatus', connectionStatuses], ['direction', directions], ['connectingWork', connectors]].filter(([, values]) => values.length > 1).map(([field]) => field);
  return { passages: [...passages, ...tableRows.map(row => row.raw)], strength: only(strengths), channel: only(channels), familyCount: only(familyCounts), connectionStatus: only(connectionStatuses), direction: directions.length === 1 && directions[0] === 'both directions' ? 'both directions' : null, connectingWork: only(connectors), conflicts, familyCounts, strengths, channels, connectionStatuses, directions };
}

export function mesoSourceDetails(sourceMaterial, sourceLabel, targetLabel, { carriedNodes = [] } = {}) {
  if (!normalized(sourceLabel || '') || !normalized(targetLabel || '') || normalized(sourceLabel) === normalized(targetLabel)) return detailsFromPassages([], '', '');
  const source = analyzeMemoSource(sourceMaterial);
  const otherLabels = carriedNodes.map(node => node?.label).filter(label => label && ![normalized(sourceLabel), normalized(targetLabel)].includes(normalized(label)));
  const passages = narrativeSentences(source).filter(passage => mentions(passage, sourceLabel) && mentions(passage, targetLabel)
    && !otherLabels.some(label => mentions(passage, label)) && !UNCERTAIN.test(passage) && !passage.trimEnd().endsWith('?'));
  const rows = mesoTableRows(sourceMaterial).filter(row => mentions(row.people, sourceLabel) && mentions(row.people, targetLabel)
    && !otherLabels.some(label => mentions(row.people, label)));
  return detailsFromPassages(passages, sourceLabel, targetLabel, rows);
}

/** A bounded reading aid; the model response still passes ordinary validation. */
export function mesoPairEvidence(sourceMaterial, carriedNodes = [], { maxPairs = 8 } = {}) {
  const limit = Number.isInteger(maxPairs) ? Math.max(0, Math.min(8, maxPairs)) : 8;
  if (!limit) return [];
  const nodes = carriedNodes.filter(node => typeof node?.id === 'string' && node.id && typeof node.label === 'string' && normalized(node.label));
  const pairs = new Map();
  for (const passage of narrativeSentences(analyzeMemoSource(sourceMaterial))) {
    if (UNCERTAIN.test(passage) || passage.trimEnd().endsWith('?')) continue;
    const named = nodes.filter(node => mentions(passage, node.label));
    if (named.length !== 2 || normalized(named[0].label) === normalized(named[1].label)) continue;
    const key = JSON.stringify(named.map(node => node.id).sort());
    if (!pairs.has(key)) {
      if (pairs.size === limit) continue;
      pairs.set(key, { nodes: named, passages: [] });
    }
    pairs.get(key).passages.push(passage);
  }
  const result = [], encoder = new TextEncoder();
  const fields = ['strength', 'channel', 'familyCount', 'connectionStatus', 'direction'];
  for (const row of mesoTableRows(sourceMaterial)) {
    if (result.length >= limit) break;
    const named = nodes.filter(node => mentions(row.people, node.label));
    if (named.length !== 2) continue;
    const [source, target] = named;
    const all = mesoSourceDetails(sourceMaterial, source.label, target.label, { carriedNodes });
    // Each cell remains an exact source excerpt. Its role and endpoint pair
    // were established by the table headers, not by neighboring prose.
    const passages = [row.people, row.rating, row.method, row.count].filter(Boolean).map(value => value.slice(0, 500));
    const relationshipProcess = Object.fromEntries(fields.filter(field => all[field] !== null && !all.conflicts.includes(field)).map(field => [field, all[field]]));
    const candidate = { source: source.id, target: target.id, passages, relationshipProcess };
    if (Object.keys(relationshipProcess).length && encoder.encode(JSON.stringify([...result, candidate])).byteLength <= 2048) result.push(candidate);
  }
  for (const pair of pairs.values()) {
    const [source, target] = pair.nodes;
    if (result.length >= limit || result.some(item => [item.source, item.target].includes(source.id) && [item.source, item.target].includes(target.id))) continue;
    const all = detailsFromPassages(pair.passages, source.label, target.label);
    const bounded = pair.passages.slice(0, 2).map(passage => Array.from(passage).slice(0, 500).join('').trimEnd());
    for (let count = bounded.length; count > 0; count -= 1) {
      const passages = bounded.slice(0, count);
      const shown = detailsFromPassages(passages, source.label, target.label);
      const relationshipProcess = Object.fromEntries(fields.filter(field => all[field] !== null
        && all[field] === shown[field] && !all.conflicts.includes(field)).map(field => [field, all[field]]));
      if (!Object.keys(relationshipProcess).length) break;
      const candidate = { source: source.id, target: target.id, passages, relationshipProcess };
      if (encoder.encode(JSON.stringify([...result, candidate])).byteLength <= 2048) {
        result.push(candidate);
        break;
      }
    }
  }
  return result;
}
