import { describe, expect, it } from 'vitest';
import { explicitMissingMesoPairs, mesoPairEvidence, mesoSourceDetails } from './meso-source-details.js';

const pair = (text, source = 'Parent', target = 'Teacher', options) => mesoSourceDetails(text, source, target, options);

describe('pair-scoped Meso source details', () => {
  it('joins explicit same-pair sentences while preserving exact evidence', () => {
    const first = 'The parent maintains a strong email connection with the teacher, carrying updates for 24 families.';
    const second = 'The parent and teacher exchange updates in both directions.';
    expect(pair(`${first} ${second}`)).toMatchObject({ passages: [first, second], strength: 'strong', channel: 'email', familyCount: 24, direction: 'both directions', connectionStatus: 'observed', conflicts: [] });
  });

  it('keeps another connector’s count, strength, and channel outside the pair', () => {
    const result = pair('The parent maintains a weak phone connection with the teacher. The therapist maintains a strong email connection with the teacher for 24 families.');
    expect(result).toMatchObject({ strength: 'weak', channel: 'phone', familyCount: null, familyCounts: [], strengths: ['weak'], channels: ['phone'] });
  });

  it('leaves three-participant claims for review instead of assigning their details to each pair', () => {
    const carriedNodes = ['Parent', 'Teacher', 'Therapist'].map(label => ({ label }));
    expect(pair('The parent and teacher ask the therapist to email updates for 24 families.', 'Parent', 'Teacher', { carriedNodes }).passages).toEqual([]);
  });

  it('retains titles, initials, and school abbreviations in exact sentences', () => {
    const first = 'Dr. Rivera maintains a strong phone connection with P.S. 101 School for 24 families.';
    const second = 'Dr. Rivera and P.S. 101 School exchange messages in both directions.';
    expect(pair(`${first} ${second}`, 'Dr. Rivera', 'P.S. 101 School')).toMatchObject({ passages: [first, second], familyCount: 24, strength: 'strong', channel: 'phone', direction: 'both directions' });
    expect(pair('J. Rivera and Ms. Lee have a strong email connection for 0 households.', 'J. Rivera', 'Ms. Lee').familyCount).toBe(0);
  });

  it.each(['24% of families', '24 children', '2.5 families', '-5 families', '1,5 families', 'about 24 families', 'at least 24 families', 'between 24 and 35 families', '24–35 families'])('keeps %s out of an exact family count', measure => {
    expect(pair(`The parent and teacher exchange updates for ${measure}.`).familyCounts).toEqual([]);
  });

  it('accepts grouped integers and zero without converting the source', () => {
    expect(pair('The parent and teacher exchange updates for 1,024 families.').familyCount).toBe(1024);
    expect(pair('The parent and teacher have no phone contact for 0 households.')).toMatchObject({ familyCount: 0, connectionStatus: 'missing', channel: 'phone' });
  });

  it('flags incompatible scalar details instead of selecting the last value', () => {
    const result = pair('The parent and teacher maintain a strong email connection for 24 families. The parent and teacher maintain a weak phone connection for 35 families.');
    expect(result).toMatchObject({ familyCount: null, strength: null, channel: null, familyCounts: [24, 35], strengths: ['strong', 'weak'], channels: ['email', 'phone'] });
    expect(result.conflicts).toEqual(['strength', 'familyCount']);
  });

  it('distinguishes explicitly absent contact from an observed exchange', () => {
    expect(pair('The parent has no phone contact with the teacher.')).toMatchObject({ connectionStatus: 'missing', channel: 'phone' });
    expect(pair('The parent and teacher exchange messages by email.').connectionStatus).toBe('observed');
    const conflict = pair('The parent has no phone contact with the teacher. The parent and teacher exchange messages by email.');
    expect(conflict).toMatchObject({ connectionStatus: null, connectionStatuses: ['missing', 'observed'] });
    expect(conflict.conflicts).toContain('connectionStatus');
  });

  it('keeps uncertain, questioned, and negated details out of positive claims', () => {
    for (const text of ['The parent may have a strong email connection with the teacher for 24 families.', 'Do the parent and teacher have a strong email connection for 24 families?']) expect(pair(text).passages).toEqual([]);
    const result = pair('The parent and teacher do not have a strong connection or communicate in both directions.');
    expect(result.strengths).toEqual([]);
  });

  it('excludes reference entries and preserves later narrative', () => {
    const text = 'The parent and teacher talk by phone.\n\nReferences\nParent, A. (2025). Teacher: Strong email for 24 families.\n\nAppendix A: Field Notes\nThe parent and teacher exchange updates for 12 families.';
    const result = pair(text);
    expect(result).toMatchObject({ channel: 'phone', strength: null, familyCount: 12 });
    expect(result.passages.join(' ')).not.toContain('24 families');
    expect(result.passages.every(passage => text.includes(passage))).toBe(true);
  });

  it('requires explicit names rather than borrowing a neighboring pronoun sentence', () => {
    expect(pair('The parent and teacher exchange messages. They support 24 families.')).toMatchObject({ familyCount: null, familyCounts: [] });
  });

  it('identifies a connector only when the role is directly assigned the work', () => {
    expect(pair('The parent carries paper forms to the teacher.').connectingWork).toBe('Parent');
    expect(pair('The parent and teacher discuss connecting work.').connectingWork).toBeNull();
  });

  it.each([
    'The parent feels strong while meeting the teacher.',
    'The parent and teacher discuss a strong student and a weak internet signal.',
    'The parent holds a phone while meeting the teacher.',
    'The parent and teacher talk about an email shown on a phone.',
    'The parent and teacher watch children carry paper forms.',
  ])('keeps unrelated descriptive words out of required relationship details: %s', text => {
    expect(pair(text)).toMatchObject({ strength: null, channel: null });
  });

  it('recognizes strength predicates and channels used for communication', () => {
    expect(pair('The parent and teacher report that their connection is strong.')).toMatchObject({ strength: 'strong' });
    expect(pair('The parent and teacher talk by phone.')).toMatchObject({ channel: 'phone' });
    expect(pair('The parent carries paper forms to the teacher.')).toMatchObject({ channel: 'paper forms' });
    expect(pair('The parent meets the teacher in person.')).toMatchObject({ channel: 'in person' });
  });

  it('keeps unrelated counts, physical movement, and equipment problems out of required process details', () => {
    expect(pair('The parent and teacher watch 24 families arrive.')).toMatchObject({ familyCount: null, familyCounts: [] });
    expect(pair('The parent and teacher look in both directions before crossing the street.')).toMatchObject({ direction: null, directions: [] });
    expect(pair('The parent and teacher exchange updates while looking in both directions.')).toMatchObject({ direction: null, directions: [] });
    expect(pair('The parent and teacher discuss a missing connection on a phone.')).toMatchObject({ connectionStatus: null });
    expect(pair('The parent and teacher have a two-way email connection.')).toMatchObject({ direction: 'both directions' });
  });
});

describe('explicit missing Meso pairs', () => {
  const nodes = ['Parent', 'Teacher', 'Therapist'].map((label, index) => ({ id: `node-${index}`, label }));
  it.each([
    'The parent has no phone contact with the teacher.',
    'The parent and teacher have no direct communication.',
    'The teacher and parent do not communicate with each other.',
    'There is no regular contact between the parent and teacher.',
  ])('finds named endpoints in a clear absence statement: %s', text => {
    expect(explicitMissingMesoPairs(text, nodes)).toEqual([[nodes[0], nodes[1]]]);
  });

  it('deduplicates pair order and preserves original node objects', () => {
    const result = explicitMissingMesoPairs('The parent has no contact with the teacher. The teacher has no communication with the parent. The therapist has no contact with the parent.', nodes);
    expect(result).toEqual([[nodes[0], nodes[1]], [nodes[0], nodes[2]]]);
    expect(result[0][0]).toBe(nodes[0]);
  });

  it.each([
    'The parent may have no contact with the teacher.',
    'Do the parent and teacher have no contact?',
    'The parent and teacher report no contact with a nurse.',
    'The parent and teacher have no contact with a nurse.',
    'The parent asks the therapist whether there is no contact with the teacher.',
    'The parent and teacher discuss a missing connection on a phone.',
  ])('leaves ambiguous or third-party absence statements for review: %s', text => {
    expect(explicitMissingMesoPairs(text, nodes)).toEqual([]);
  });

  it('uses narrative boundaries and preserves Dr. and P.S. labels', () => {
    const named = ['Dr. Rivera', 'P.S. 101 School'].map(label => ({ label }));
    expect(explicitMissingMesoPairs('Dr. Rivera has no contact with P.S. 101 School.\n\nReferences\nParent, A. (2026). Teacher: No contact.', named)).toEqual([named]);
    expect(explicitMissingMesoPairs('The parent and teacher exchange updates.\n\nReferences\nParent, A. (2026). The parent has no contact with the teacher. Journal of Family Studies, 12(2), 20–30. https://doi.org/10.1234/example', nodes)).toEqual([]);
  });
});

describe('bounded Meso pair reading aid', () => {
  const nodes = ['Parent', 'Teacher', 'Therapist'].map((label, index) => ({ id: `node-${index}`, label }));
  it('retains same-pair details and exact adjacent evidence without defaults', () => {
    const first = 'The parent maintains a strong email connection with the teacher, carrying updates for 24 families.';
    const second = 'The parent and teacher exchange updates in both directions.';
    const missing = 'The therapist has no phone contact with the teacher.';
    expect(mesoPairEvidence(`${first} ${second} ${missing}`, nodes)).toEqual([
      { source: 'node-0', target: 'node-1', passages: [first, second], relationshipProcess: { strength: 'strong', channel: 'email', familyCount: 24, connectionStatus: 'observed', direction: 'both directions' } },
      { source: 'node-1', target: 'node-2', passages: [missing], relationshipProcess: { channel: 'phone', connectionStatus: 'missing' } },
    ]);
  });

  it('preserves zero and drops conflicting scalars even when the conflict occurs after the displayed passages', () => {
    const text = 'The parent has a strong email connection with the teacher for 0 families. The parent and teacher exchange updates. The parent has a weak email connection with the teacher for 24 families.';
    const [pair] = mesoPairEvidence(text, nodes);
    expect(pair.passages).toHaveLength(2);
    expect(pair.relationshipProcess).toEqual({ channel: 'email', connectionStatus: 'observed' });
    expect(mesoPairEvidence('The parent has a strong email connection with the teacher for 0 families.', nodes)[0].relationshipProcess.familyCount).toBe(0);
  });

  it('leaves unrelated descriptors and three-participant claims out of the reading aid', () => {
    expect(mesoPairEvidence('The parent feels strong while meeting the teacher. The parent and teacher watch 24 families arrive. The parent and teacher ask the therapist to email messages.', nodes)).toEqual([]);
  });

  it('limits pair count in narrative order and accounts for actual UTF-8 bytes', () => {
    const manyNodes = [...nodes, ...Array.from({ length: 10 }, (_, index) => ({ id: `n${index}`, label: `Role ${index}` }))];
    const text = Array.from({ length: 10 }, (_, index) => `Role ${index} has no phone contact with the teacher.`).join(' ');
    const result = mesoPairEvidence(text, manyNodes);
    expect(result).toHaveLength(8);
    expect(result[0].target).toBe('n0');
    expect(result.at(-1).target).toBe('n7');
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(2048);
    expect(mesoPairEvidence(text, manyNodes, { maxPairs: 1 })).toHaveLength(1);
    expect(mesoPairEvidence(text, manyNodes, { maxPairs: 0 })).toEqual([]);
  });

  it('bounds multibyte passages and retains only metadata visible in the included exact source slices', () => {
    const first = `The parent and teacher ${'観察 '.repeat(200)}have a strong email connection for 24 families.`;
    const second = `The therapist has no phone contact with the teacher, ${'記録 '.repeat(200)}.`;
    const text = first + ' ' + second;
    const result = mesoPairEvidence(text, nodes);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(2048);
    for (const pair of result) for (const passage of pair.passages) {
      expect(Array.from(passage).length).toBeLessThanOrEqual(500);
      expect(text).toContain(passage);
    }
    expect(result.flatMap(pair => Object.keys(pair.relationshipProcess))).not.toContain('familyCount');
  });
});
