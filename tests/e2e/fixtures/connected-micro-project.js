import { buildEastHarlemDisabilityProject } from './east-harlem-disability-project.js';
import { createLevelProgress, stableId, validateProject } from '../../../src/domain.js';
import { appendSubmittedNodes } from '../../../src/memoWorkflow.js';

export function connectedMicroProject() {
  const project=buildEastHarlemDisabilityProject();
  const labels=['Maya','Coordinator Lee','Librarian Jo','Neighborhood library','Community garden','Library workshop','Shared calendar','Gardening books','Tools','Seeds','Storage room','Volunteer handbook'];
  const types=['person','role','role','setting','setting','activity','object','object','object','object','setting','object'];
  const nodes=labels.map((label,i)=>({...structuredClone(project.graph.nodes[0]),id:`micro-${i}`,label,type:types[i],scale:'micro',x:200+i*100,y:300,settingNodeIds:[],evidence:'Fictional layout example.',
    annotations:{analytical:{id:`micro-${i}-note`,text:''},evidence:{id:`micro-${i}-evidence`,text:''}}}));
  const pairs=[[1,0,'gives guidance to'],[1,6,'uses'],[2,0,'assists'],[2,7,'organizes'],[0,3,'visits'],[0,4,'volunteers at'],[0,5,'attends']];
  const edges=pairs.map(([a,b,verb],i)=>({...structuredClone(project.graph.edges[0]),id:`micro-edge-${i}`,source:nodes[a].id,target:nodes[b].id,sourceLabel:nodes[a].label,targetLabel:nodes[b].label,verb,evidence:'Student-created connection in a fictional layout example.',
    annotation:{id:`micro-edge-${i}-note`,text:''}}));
  Object.assign(project,{id:'connected-micro-layout-example',title:'Maya — library and garden',participantName:'Fictional layout example',inquiry:'How do Maya’s local connections fit together?',activeScale:'meso',releasedScales:['micro','meso'],completedScales:['micro'],stage:3,furthestStage:3,
    levelProgress:createLevelProgress({activeScale:'meso',stage:3,completedScales:['micro']}),graph:{nodes,edges},layout:{autoFit:true}});
  const text='Maya visits the neighborhood library, volunteers at the community garden and attends the library workshop. Coordinator Lee gives guidance to Maya and uses a shared calendar. Librarian Jo assists Maya and organizes gardening books. Tools, seeds, a storage room and a volunteer handbook have no mapped connections yet. All names and events are fictional.';
  Object.assign(project.submission,{title:'Fictional library and garden memo',author:'Fictional layout example',location:'Fictional neighborhood',text,fingerprint:stableId('src',text)});
  project.activeScale='micro';
  appendSubmittedNodes(project,{guidance:[],nodes:[],connections:[],example:null,readiness:{ready:true,note:'Manual teaching example.'}});
  project.activeScale='meso';
  project.instructor.evidenceRequired=false;
  return validateProject(project);
}
