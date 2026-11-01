import { describe, expect, it } from 'vitest';
import { mesoSourceDetails, mesoPairEvidence, explicitMissingMesoPairs, mesoTableRows, mesoTableCoverage, missingMesoTableRolesReview } from './meso-source-details.js';
const header='| People connected (exact roles) | Information exchanged / missing | Strength + direction | Method + connector | Children / families affected | Evidence / source OR plan to find out |\n| --- | --- | --- | --- | --- | --- |\n';
const table = rows => header + rows.map(row=>'| '+row.join(' | ')+' |').join('\n');
const observed=['Safety agents and Assistant principals','Campus incidents','Strong; two way','Communication through radio/walkie-talkies and meetings.','Unknown for the district; an example is 2,400 students.','A published campus report.'];
const missing=['Safety agents and Counselors','Student distress','Missing, no clear communication line.','There may be indirect contact through administrators.','62% of students.','We plan to research the effects of this division.'];
const planned=['Parent and Teacher','Progress','Strong; two-way','Phone and school meetings','Unknown — research needed','Parent/teacher interviews (planned)'];
const nodes=['Safety agents','Assistant principals','Counselors','Parent','Teacher'].map((label,i)=>({id:`n${i}`,label,scale:'micro'}));
describe('Meso evidence in tables',()=>{
  it('identifies missing roles only for a table-only source with every pair incomplete',()=>{
    const source=table([observed,missing]);
    const incomplete=[{id:'agent',label:'Safety agent'}];
    expect(missingMesoTableRolesReview(source,incomplete)).toMatchObject({nodes:[],connections:[],readiness:{ready:false}});
    expect(missingMesoTableRolesReview(source,nodes)).toBeNull();
    expect(missingMesoTableRolesReview('The parent phones the teacher.\n'+source,incomplete)).toBeNull();
    expect(missingMesoTableRolesReview(source+'\nThe parent phones the teacher.',incomplete)).toBeNull();
    expect(missingMesoTableRolesReview(table([planned]),incomplete)).toBeNull();
    const preface='LAYER 2 | MESOSYSTEM CONNECTIONS\nStudent(s): Test\nIssue/community: A synthetic map\nPurpose: Map roles.\nHow to complete the table: Check source evidence.\n';
    expect(missingMesoTableRolesReview(preface+source,incomplete)?.readiness.ready).toBe(false);
  });
  it('matches singular and plural role names while keeping offices distinct from people',()=>{
    const carried=[{id:'agent',label:'Safety agent',scale:'micro'},{id:'principal',label:'Assistant principal',scale:'micro'},{id:'office',label:'Counselor office',scale:'micro'}];
    const source=table([observed,missing]);
    expect(mesoTableCoverage(source,carried)).toEqual([
      {people:observed[0],mappedIds:['agent','principal'],complete:true},{people:missing[0],mappedIds:['agent'],complete:false},
    ]);
    expect(mesoSourceDetails(source,'Safety agent','Assistant principal',{carriedNodes:carried})).toMatchObject({strength:'strong',direction:'both directions',channel:'radio/walkie-talkies'});
    expect(mesoSourceDetails(source,'Safety agent','Counselor office',{carriedNodes:carried}).passages).toEqual([]);
    expect(mesoPairEvidence(source,carried)[0]).toMatchObject({source:'agent',target:'principal',relationshipProcess:{strength:'strong'}});
    expect(explicitMissingMesoPairs(source,carried)).toEqual([]);
  });
  it('keeps names, numbers and role qualifiers distinct while bounding table coverage',()=>{
    const source=table([['School 12 teachers and School 24 counselors','Updates','Weak; one way','email','Unknown','A report.']]);
    const carried=[{id:'wrong-school',label:'School 21 teacher'},{id:'other-role',label:'School 12 counselor'},{id:'right-school',label:'School 12 teacher'}];
    expect(mesoTableCoverage(source,carried)).toEqual([{people:'School 12 teachers and School 24 counselors',mappedIds:['right-school'],complete:false}]);
    const oversized=table(Array.from({length:30},(_,i)=>[`${'Long source role '.repeat(30)} ${i} and Teacher`,'Updates','Weak','email','Unknown','A report.']));
    expect(new TextEncoder().encode(JSON.stringify(mesoTableCoverage(oversized,carried))).byteLength).toBeLessThanOrEqual(2048);
  });
  it('requires one distinct mapped role on each side of the source pair',()=>{
    const source=table([['Classroom teachers and Guidance counselors','Updates','Weak; one way','email','Unknown','A report.']]);
    const carried=[{id:'classroom',label:'Classroom'},{id:'teacher',label:'Teacher'},{id:'office',label:'Guidance counselor office'}];
    expect(mesoTableCoverage(source,carried)).toEqual([{people:'Classroom teachers and Guidance counselors',mappedIds:['teacher'],complete:false}]);
    expect(mesoPairEvidence(source,carried)).toEqual([]);
    expect(mesoSourceDetails(source,'Classroom','Teacher',{carriedNodes:carried}).passages).toEqual([]);
    carried.push({id:'counselor',label:'Guidance counselor'});
    expect(mesoPairEvidence(source,carried)[0]).toMatchObject({source:'teacher',target:'counselor',relationshipProcess:{strength:'weak',channel:'email'}});
    carried.push({id:'duplicate',label:'Classroom teacher'});
    expect(mesoTableCoverage(source,carried)[0].complete).toBe(false);
    expect(mesoPairEvidence(source,carried)).toEqual([]);
  });
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
