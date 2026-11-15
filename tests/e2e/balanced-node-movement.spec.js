import { test, expect, captureSourceRenderedScreenshot } from './support/test.js';
import { buildEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';
import { validateProject } from '../../src/domain.js';
import { showMap, openTools } from './support/notebook.js';

function fixture() {
  const project=buildEastHarlemDisabilityProject();
  project.id='project_balanced_move';project.title='Balanced placement acceptance';
  const local=project.graph.nodes.filter(n=>n.scale==='micro').slice(0,3);
  const outside=project.graph.nodes.filter(n=>['exosphere','macrosphere'].includes(n.scale));
  const coordinates=[[500,500],[730,500],[500,650],[700,950],[700,1150]];
  project.graph.nodes=[...local,...outside].map((n,i)=>({...n,label:['Alpha','Beta','Gamma','Office','Public funding policy'][i],
    x:coordinates[i][0],y:coordinates[i][1],
    ...(n.scale==='micro'?{settingNodeIds:[]}:{}),
    ...(n.scale==='macrosphere'?{scopeNodeIds:local.map(n=>n.id)}:{})}));
  project.graph.edges=[];
  project.layout={autoFit:true,phoneOverview:'preserve',manualNodeIds:project.graph.nodes.map(n=>n.id)};
  return validateProject(project);
}
const positions=page=>page.locator('.graph-node').evaluateAll(elements=>Object.fromEntries(elements.map(el=>{
  const [x,y]=el.getAttribute('transform').match(/-?[\d.]+/g).map(Number);
  return [el.dataset.graphId,{x,y}];
})));
async function dragTo(page,id,target) {
  const node=page.locator(`.graph-node[data-graph-id="${id}"]`);
  const points=await node.evaluate((el,target)=>{
    const [x,y]=el.getAttribute('transform').match(/-?[\d.]+/g).map(Number),matrix=el.getScreenCTM();
    const start=new DOMPoint(0,0).matrixTransform(matrix),end=new DOMPoint(target.x-x,target.y-y).matrixTransform(matrix);
    return {start:{x:start.x,y:start.y},end:{x:end.x,y:end.y}};
  },target);
  await page.mouse.move(points.start.x,points.start.y);await page.mouse.down();
  await page.mouse.move(points.end.x,points.end.y,{steps:8});await page.mouse.up();
}
async function expectClear(page) {
  const result=await page.locator('.graph-canvas').evaluate(svg=>{
    const cards=[...svg.querySelectorAll('.graph-node')].map(node=>({node,b:node.querySelector('.node-card').getBBox(),
      p:node.transform.baseVal.consolidate().matrix}));
    const areas=cards.map(({b,p})=>({left:p.e+b.x,right:p.e+b.x+b.width,top:p.f+b.y,bottom:p.f+b.y+b.height}));
    let overlaps=0;
    for(let i=0;i<areas.length;i++)for(let j=i+1;j<areas.length;j++){
      const a=areas[i],b=areas[j];if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)overlaps++;
    }
    return {overlaps};
  });
  expect(result.overlaps).toBe(0);
}

test('manual moves honor the drop, make nearby room, and persist as one reversible change',async({page},testInfo)=>{
  const project=fixture(),[moving,neighbor,far,office]=project.graph.nodes;
  await page.addInitScript(({key,value})=>{if(!localStorage.getItem('balanced-seeded')){
    localStorage.setItem(key,value);localStorage.setItem('balanced-seeded','1');
  }},{key:STORAGE_KEY,value:JSON.stringify(project)});
  await page.goto('/');await page.getByRole('textbox',{name:'Class code'}).fill('101');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  const open=async()=>{await page.getByRole('article',{name:project.title}).getByRole('button',{name:'Open project'}).click();await showMap(page);};
  await open();
  const initial=await positions(page);
  const widths=await page.locator('.graph-node').evaluateAll(elements=>Object.fromEntries(elements.map(el=>[el.dataset.graphId,el.querySelector('.node-card').getBBox().width])));
  const requested={x:initial[neighbor.id].x-(widths[moving.id]+widths[neighbor.id])/2+10,y:initial[neighbor.id].y};
  await dragTo(page,moving.id,requested);
  await expect.poll(async()=>(await positions(page))[neighbor.id].x).toBeGreaterThan(initial[neighbor.id].x);
  const balanced=await positions(page);
  expect(balanced[moving.id].x).toBeGreaterThan(initial[moving.id].x);
  expect(Math.hypot(requested.x-balanced[moving.id].x,requested.y-balanced[moving.id].y)).toBeLessThan(2);
  expect(balanced[far.id]).toEqual(initial[far.id]);await expectClear(page);
  const canvas=page.locator('.graph-canvas');
  await canvas.press('ControlOrMeta+z');await expect.poll(()=>positions(page)).toEqual(initial);
  await canvas.press('ControlOrMeta+Shift+z');await expect.poll(()=>positions(page)).toEqual(balanced);
  await expect.poll(async()=>page.evaluate(({key,id})=>{
    const n=JSON.parse(localStorage.getItem(key)).graph.nodes.find(n=>n.id===id);return {x:n.x,y:n.y};
  },{key:STORAGE_KEY,id:moving.id})).toEqual(balanced[moving.id]);
  await page.reload();await open();expect(await positions(page)).toEqual(balanced);
  const beforeExpansion=await positions(page);
  await dragTo(page,moving.id,beforeExpansion[office.id]);
  await expect.poll(async()=>(await positions(page))[office.id]).not.toEqual(beforeExpansion[office.id]);
  const expanded=await positions(page);
  expect(Math.hypot(expanded[moving.id].x-beforeExpansion[office.id].x,expanded[moving.id].y-beforeExpansion[office.id].y)).toBeLessThan(2);
  await expectClear(page);
  await canvas.press('ControlOrMeta+z');await expect.poll(()=>positions(page)).toEqual(beforeExpansion);
  await canvas.press('ControlOrMeta+Shift+z');await expect.poll(()=>positions(page)).toEqual(expanded);
  await captureSourceRenderedScreenshot(page,testInfo,'Balanced movement with expanding levels');
  await openTools(page);await page.getByRole('checkbox',{name:'Auto-fit layout',exact:true}).uncheck();await showMap(page);
  const freeStart=await positions(page);
  await dragTo(page,moving.id,freeStart[neighbor.id]);
  await expect.poll(async()=>{
    const p=(await positions(page))[moving.id];return Math.hypot(p.x-freeStart[neighbor.id].x,p.y-freeStart[neighbor.id].y);
  }).toBeLessThan(2);
  expect((await positions(page))[neighbor.id]).toEqual(freeStart[neighbor.id]);
});
