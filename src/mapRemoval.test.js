import { describe, it, expect } from 'vitest';
import { groupProject } from '../tests/fixtures/group-project.js';
import { removeMapSelection } from './mapRemoval.js';
import { recordEdit, restoreEdit } from './editHistory.js';
import { parseProject, serializeProject } from './domain.js';
import { mapShortcut } from './mapShortcuts.js';

describe('recoverable map removal', () => {
  it('reanchors grouped lines to their surviving member, including a different candidate group', () => {
    const p=groupProject(), group=p.graph.edges.at(-1), [a,b]=group.relationshipIds;
    const proposed={...structuredClone(group),id:'other-candidate-group',annotation:{...group.annotation,id:'other-group-annotation'}};
    p.candidates.edges.push(proposed);
    const annotation=structuredClone(group.annotation);
    removeMapSelection(p,'edge',a);
    for (const g of [group,proposed]) {
      expect(g.relationshipIds).toEqual([b]);
      expect(g.target).toBe(p.graph.edges.find(e=>e.id===b).source);
    }
    expect(group.annotation).toEqual(annotation);
    expect(() => parseProject(serializeProject(p))).not.toThrow();
  });
  it('one persisted Undo restores the node, its direct lines and the last group branch with all evidence', () => {
    const p=groupProject(), before=structuredClone(p), group=p.graph.edges.at(-1);
    const node=p.graph.edges[0].target;
    removeMapSelection(p,'node',node);
    expect(p.graph.nodes.find(n=>n.id===node).claimState).toBe('retired');
    expect(p.graph.edges.filter(e=>e.source===node||e.target===node).every(e=>e.claimState==='retired')).toBe(true);
    expect(group.claimState).toBe('retired');
    const after=structuredClone(p.graph);
    expect(recordEdit(before,p,'Remove node')).toBe(true);
    const undo=restoreEdit(parseProject(serializeProject(p)),'undo');
    expect(undo.error).toBe('');
    expect(undo.project.graph).toEqual(before.graph);
    const redo=restoreEdit(parseProject(serializeProject(undo.project)),'redo');
    expect(redo.error).toBe('');
    expect(redo.project.graph).toEqual(after);
  });
  it('leaves editable fields, composition, dialogs and consumed shortcuts to their owners', () => {
    for (const tag of ['input','textarea','select','dialog']) {
      const target=document.createElement(tag);
      expect(mapShortcut({key:'Backspace',target})).toBeNull();
      expect(mapShortcut({key:'z',metaKey:true,target})).toBeNull();
    }
    expect(mapShortcut({key:'Delete',isComposing:true})).toBeNull();
    expect(mapShortcut({key:'z',ctrlKey:true,defaultPrevented:true})).toBeNull();
    expect(mapShortcut({key:'z',metaKey:true,shiftKey:true})).toBe('redo');
  });
});
