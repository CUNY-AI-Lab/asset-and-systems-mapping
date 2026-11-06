const normalized = value => String(value).normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

// A sentence boundary may follow punctuation, but not the dots inside initials.
const sentenceBoundary = /(?<=[.!?])(?<!\b\p{L}\.\p{L}\.)\s+/u;

function focalParticipantPattern(narrative, quote, carriedNodes) {
  const roles = '(?:residents?|tenants?|students?|families|family|children|child|patients?|workers?|employees?|learners?|focal (?:people|person|group|participants?))';
  // Only use a new personal name as an alias when the memo identifies it as focal.
  const names = [...String(narrative).matchAll(/\bfocal (?:participant|person|student)\s+is\s+(?:still\s+)?([\p{Lu}][\p{L}'’-]+)\b/gu)].map(match => escaped(normalized(match[1])));
  // The first map identifies local participants. Their exact labels can resolve
  // the subject of a second-memo passage, but never supply the missing evidence.
  for (const node of carriedNodes) {
    if (node.scale !== 'micro' || !['person', 'role', 'family', 'group'].includes(node.type)) continue;
    const label = normalized(node.label);
    if (label && quote.includes(label)) names.push(escaped(label));
  }
  return names.length ? `(?:${roles}|${[...new Set(names)].join('|')})` : roles;
}

// A conservative source gate for automatic Exo placement, not a universal
// classifier. Place names cannot prove participation. The short quoted chain
// must show an external decision and its influence on the immediate setting.
export function exoParticipationIssue(node, narrative = node.evidence, carriedNodes = []) {
  const quote = normalized(node.evidence), full = normalized(narrative), name = escaped(normalized(node.label));
  const focal = `${focalParticipantPattern(narrative, quote, carriedNodes)}(?![\\p{L}\\p{N}])`;
  const action = '(?:meet(?:s)?(?: with)?|visit(?:s)?|attend(?:s)?|receiv(?:e|es) services (?:at|from)|participat(?:e|es) in|tak(?:e|es) part in|serv(?:e|es) as|sit(?:s)? on|vot(?:e|es) (?:at|on))';
  const sentencesInSource = full.split(sentenceBoundary);
  const settingKind = /\b(office|board|agency|committee|service)$/u.exec(normalized(node.label))?.[1];
  const directAt = setting => new RegExp(`(?<![\\p{L}\\p{N}])${focal}\\s+(?:(?:also|directly|regularly|actively|personally|weekly|often)\\s+){0,3}${action}[^.;]{0,100}${setting}(?![\\p{L}\\p{N}])`, 'giu');
  const namedVisit = directAt(name);
  const referencedVisit = settingKind && directAt(`(?:the|this|that) ${settingKind}`);
  const hasVisit = (pattern, sentence) => Array.from(sentence.matchAll(pattern)).some(match =>
    !/\b(?:no|neither)\s+$/iu.test(sentence.slice(0, match.index)));
  const visitsSetting = sentencesInSource.some((sentence, index) => {
    if (hasVisit(namedVisit, sentence)) return true;
    if (!referencedVisit || !hasVisit(referencedVisit, sentence)) return false;
    // Resolve “this board” only when its nearest named setting is this board.
    const beforeVisit = sentence.slice(0, sentence.search(referencedVisit));
    const context = (sentencesInSource[index - 1] || '') + ' ' + beforeVisit;
    const lastName = context.lastIndexOf(normalized(node.label));
    return lastName >= 0 && !/\b(?:office|board|agency|committee|service)\b/u.test(context.slice(lastName + normalized(node.label).length));
  });
  if (visitsSetting) return 'describes focal participants taking part in the setting; do not classify that setting as Exo';
  const negative = '(?:do not|does not|don’t|don\x27t|never|cannot|are excluded from|is excluded from|have no|has no)';
  const involvement = '(?:participat\\w*|attend\\w*|vot\\w*|decision\\w*|serv\\w*|take part)';
  const forward = new RegExp(`(?<![\\p{L}\\p{N}])${focal}[^,.;]{0,45}\\b${negative}[^,.;]{0,45}\\b${involvement}[^,.;]{0,90}${name}`, 'iu');
  const relative = new RegExp(`${name}[^.;]{0,50}\\b(?:in|at|on) which[^,.;]{0,20}${focal}[^,.;]{0,25}${negative}[^,.;]{0,25}${involvement}`, 'iu');
  const excluding = new RegExp(`${name}[^,.;]{0,80}\\bwithout\\s+(?:(?:the|any)\\s+)?${focal}[^,.;]{0,24}\\b(?:participation|input|involvement)`, 'iu');
  const staffOnly = new RegExp(`${name}[^,.;]{0,65}\\b(?:staff-only|officials-only)\\b|\\b(?:staff-only|officials-only)\\b[^,.;]{0,65}${name}`, 'iu');
  const sentences = quote.split(sentenceBoundary);
  // A directly adjacent “this office” may refer back to the named office.
  // Keep both original sentences together and reject any intervening setting.
  const adjacentNegative = new RegExp(`^${focal}\\s+${negative}[^.;]{0,60}\\b${involvement}[^.;]{0,35}\\b(?:this|that) (?:office|board|agency|committee|service)\\b`, 'iu');
  const proof = sentences.find((sentence, index) => sentence.includes(normalized(node.label))
    && ([forward, relative, excluding, staffOnly].some(pattern => pattern.test(sentence))
      || adjacentNegative.test(sentences[index + 1] || '')
        && !/\b(?:office|board|agency|committee|service)\b/iu.test(sentence.slice(sentence.indexOf(normalized(node.label)) + normalized(node.label).length))));
  if (!proof) return 'must quote the focal participants’ nonparticipation in this named outside setting, not another setting';
  const proofIndex = sentences.indexOf(proof), following = sentences[proofIndex + 1];
  const sameSettingNext = new RegExp(`^(?:the\\s+)?${name}(?:\\b|$)`, 'iu');
  const chain = proof + (following && (/^(?:its|these|those|this|that|the resulting)\b/iu.test(following) || sameSettingNext.test(following) || adjacentNegative.test(following)) ? ` ${following}` : '');
  const decision = /\b(?:allocat\w*|budget\w*|decid\w*|decision\w*|assign\w*|fund\w*|set(?:s)?|establish\w*|mandat\w*|control\w*|coordinat\w*|approv\w*|determin\w*)\b/iu.test(chain);
  const consequence = /\b(?:affect\w*|influenc\w*|delay\w*|reduc\w*|increas\w*|limit\w*|restrict\w*|result\w*|caus\w*|shape\w*|prevent\w*|determin\w*|decides? whether|chang\w*|so that|therefore|which means|leads? to|pays? for)\b/iu.test(chain);
  const local = new RegExp(`(?<![\\p{L}\\p{N}])(?:${focal}|classrooms?|schools?|buildings?|homes?|repairs?|counseling|clinics?|care|local|immediate)(?![\\p{L}\\p{N}])`, 'iu').test(chain);
  if (!decision || !consequence || !local) return 'must quote the focal participants’ nonparticipation in an outside decision and its indirect effect on their local setting';
  return null;
}
