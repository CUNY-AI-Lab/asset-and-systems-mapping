import { describe, expect, it } from 'vitest';
import { mesoSourceDetails, mesoPairEvidence, explicitMissingMesoPairs, mesoTableRows } from './meso-source-details.js';
const header='| People connected (exact roles) | Information exchanged / missing | Strength + direction | Method + connector | Children / families affected | Evidence / source OR plan to find out |\n| --- | --- | --- | --- | --- | --- |\n';
const table = rows => header + rows.map(row=>'| '+row.join(' | ')+' |').join('\n');
const observed=['Safety agents and Assistant principals','Campus incidents','Strong; two way','Communication through radio/walkie-talkies and meetings.','Unknown for the district; an example is 2,400 students.','A published campus report.'];
const missing=['Safety agents and Counselors','Student distress','Missing, no clear communication line.','There may be indirect contact through administrators.','62% of students.','We plan to research the effects of this division.'];
const planned=['Parent and Teacher','Progress','Strong; two-way','Phone and school meetings','Unknown — research needed','Parent/teacher interviews (planned)'];
const nodes=['Safety agents','Assistant principals','Counselors','Parent','Teacher'].map((label,i)=>({id:`n${i}`,label,scale:'micro'}));
describe('Meso evidence in tables',()=>{
  it('keeps an explicit pair rating and channel when its population count is unknown',()=>{
    const result=mesoSourceDetails(table([observed,missing,planned]),'Safety agents','Assistant principals',{carriedNodes:nodes});
    expect(result).toMatchObject({strength:'strong',direction:'both directions',channel:'radio/walkie-talkies',connectionStatus:'observed',familyCount:null});
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0]).toContain('2,400 students');
  });
  it('recognizes a documented missing pair and excludes a planned interview template',()=>{
    const source=table([observed,missing,planned]);
    expect(mesoTableRows(source)).toHaveLength(2);
    expect(explicitMissingMesoPairs(source,nodes).map(pair=>pair.map(node=>node.id))).toEqual([['n0','n2']]);
    expect(mesoSourceDetails(source,'Parent','Teacher').passages).toEqual([]);
    expect(mesoSourceDetails(source,'Safety agents','Counselors').connectionStatus).toBe('missing');
  });
  it('limits evidence to named endpoints and never borrows from another row',()=>{
    expect(mesoSourceDetails(table([observed,missing]),'Assistant principals','Counselors').passages).toEqual([]);
    const result=mesoSourceDetails(table([observed,missing]),'Safety agents','Counselors');
    expect(result.channel).toBeNull();expect(result.strength).toBeNull();expect(result.direction).toBeNull();
  });
  it.each([['24 families',24],['24 students',null],['24 students and their families',null],['about 24 families',null],['24% of families',null]])('keeps count units for %s',(count,expected)=>{
    const row=[...observed];row[4]=count;
    expect(mesoSourceDetails(table([row]),'Safety agents','Assistant principals').familyCount).toBe(expected);
  });
  it('keeps conflicting strengths uncertain and gives bounded source excerpts to the model',()=>{
    const row=[...observed];row[2]='Weak; contested/two way';
    const source=table([row,missing]);
    expect(mesoSourceDetails(source,'Safety agents','Assistant principals')).toMatchObject({strength:null,conflicts:['strength']});
    const aid=mesoPairEvidence(source,nodes);
    expect(aid).toHaveLength(2);expect(aid[0].relationshipProcess).toMatchObject({direction:'both directions',channel:'radio/walkie-talkies'});
    expect(aid[0].relationshipProcess).not.toHaveProperty('strength');
    for(const pair of aid)for(const passage of pair.passages)expect(source).toContain(passage);
    expect(new TextEncoder().encode(JSON.stringify(aid)).byteLength).toBeLessThanOrEqual(2048);
  });
});
