import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProjectCompletion from './ProjectCompletion.jsx';
import { buildEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';
afterEach(cleanup);
it('summarizes actual saved work and notes without inventing learning outcomes', () => {
 const p=buildEastHarlemDisabilityProject();p.activeScale='macrosphere';p.reflection='Synthetic final observation.';p.levelProgress.micro.reflection='Earlier local observation.';
 p.graph.edges.push({...p.graph.edges[0],id:'legacy-micro-summary',scale:'micro'});
 const back=vi.fn();render(<ProjectCompletion project={p} onReturn={back} onExport={vi.fn()} />);
 expect(screen.getByRole('heading',{name:p.title})).toBeVisible();expect(screen.getByText('Earlier local observation.')).toBeVisible();expect(screen.getByText('Synthetic final observation.')).toBeVisible();
 expect(within(screen.getByRole('region',{name:'Micro-level summary'})).getByText('6 nodes · 1 relationship')).toBeVisible();
 expect(within(screen.getByRole('region',{name:'Meso-level summary'})).getByText(/1 node/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Return to map'}));expect(back).toHaveBeenCalledTimes(1);
});
it('keeps exports explicit, reports failure and allows a retry without losing synthesis', async () => {
 const p=buildEastHarlemDisabilityProject();const output=vi.fn().mockRejectedValueOnce(new Error('Synthetic export unavailable.')).mockResolvedValueOnce(undefined);
 render(<ProjectCompletion project={p} onReturn={vi.fn()} onExport={output} />);
 fireEvent.click(screen.getByRole('button',{name:'Private backup'}));expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic export unavailable.');
 expect(screen.getByRole('heading',{name:p.title})).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Private backup'}));
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Private backup downloaded.'));expect(output).toHaveBeenCalledTimes(2);
});
it('uses the selected audience for visual exports and disables extra requests while preparing', async () => {
 let finish;const output=vi.fn(()=>new Promise(resolve=>{finish=resolve}));const p=buildEastHarlemDisabilityProject();p.sharingTier='course';
 render(<ProjectCompletion project={p} onReturn={vi.fn()} onExport={output}/>);
 fireEvent.click(screen.getByRole('button',{name:'PNG',exact:true}));expect(output).toHaveBeenCalledWith('png','course');expect(screen.getByRole('button',{name:'PDF',exact:true})).toBeDisabled();
 finish();await waitFor(()=>expect(screen.getByRole('button',{name:'PDF',exact:true})).toBeEnabled());
});
