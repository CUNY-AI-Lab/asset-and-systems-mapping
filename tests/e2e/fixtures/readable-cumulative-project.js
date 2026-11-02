import { buildEastHarlemDisabilityProject } from './east-harlem-disability-project.js';
import { validateProject } from '../../../src/domain.js';

export function denseCumulativeProject() {
  const project = buildEastHarlemDisabilityProject();
  project.id = 'project_readable_dense_cumulative';
  project.title = 'Community services map';
  project.graph.nodes = project.graph.nodes.filter(node => node.scale !== 'meso');
  const local = project.graph.nodes.filter(node => node.scale === 'micro');
  const labels = ['Community nurse', 'School counselor', 'Tenant association', 'Library staff', 'Youth program', 'Legal clinic'];
  for (const [index, label] of labels.entries()) {
    const id = `node_dense_local_${index}`;
    local.push({ ...structuredClone(local[index]), id, label, x: 1200 + index * 20, y: 1100 + index * 20, settingNodeIds: [],
      annotations: {analytical:{id:`${id}_interpretation`,text:''},evidence:{id:`${id}_evidence`,text:''}} });
  }
  const outer = project.graph.nodes.filter(node => node.scale !== 'micro').map(({scopeNodeIds, deontic, ...node}) => ({...node,scale:'exosphere'}));
  for (const [index,label] of ['City health department','Public library funding'].entries()) {
    const id=`node_dense_outer_${index}`;
    outer.push({...structuredClone(outer[index]),id,label,x:2650+index*20,y:1200,
      annotations:{analytical:{id:`${id}_interpretation`,text:''},evidence:{id:`${id}_evidence`,text:''}}});
  }
  project.graph.nodes=[...local,...outer];
  const sample=project.graph.edges[0];
  const connect=(source,target,scale,index,verb='supports')=>({...structuredClone(sample),id:`edge_dense_${index}`,source:source.id,target:target.id,sourceLabel:source.label,targetLabel:target.label,scale,verb,annotation:{id:`edge_dense_${index}_interpretation`,text:''}});
  project.graph.edges=local.map((source,index)=>connect(source,local[(index+1)%local.length],'meso',index));
  for(const [index,node] of outer.entries()) {
    project.graph.edges.push(connect(node,local[index*3],'macrosphere',12+index,'funds'));
    if(index) project.graph.edges.push(connect(outer[index-1],node,'macrosphere',16+index,'coordinates with'));
  }
  project.instructor.evidenceRequired=false;
  return validateProject(project);
}
