import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SYSTEMS_MAPPING_LEVELS, systemsMappingLevelTitle } from '../shared/systems-mapping-parts.js';
import { SYSTEMS_MAPPING_STAGES } from '../shared/systems-mapping-stages.js';

const studentCopySources = [
  './App.jsx',
  './domain.js',
  '../server/app.js',
  '../server/config.js',
  '../shared/systems-mapping-parts.js',
  '../shared/systems-mapping-stages.js',
];

const unexplainedMetaphors = /patterns?[\s-]+with[\s-]+no[\s-]+door|never[\s-]+in[\s-]+the[\s-]+room|in[\s-]+the[\s-]+room[\s-]+with|\bstuck\b|has[\s-]+energy|ripples?[\s-]+outward|this[\s-]+ring[\s-]+holds/i;

describe('student-facing copy', () => {
  it('does not reintroduce unexplained scale metaphors or leverage labels', () => {
    studentCopySources.forEach((relativePath) => {
      const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
      expect(source, relativePath).not.toMatch(unexplainedMetaphors);
    });
  });

  it('defines each candidate decision in plain language', () => {
    const source = readFileSync(fileURLToPath(new URL(studentCopySources[0], import.meta.url)), 'utf8');
    expect(source).toContain('Model suggestions stay off the map until you choose Add to map. Editing a suggestion does not add it. Choose Needs more evidence to set one aside, or Remove to leave it off the map.');
    expect(source).not.toContain('Keep means add this suggestion to the map. Suggestions begin on Keep so you can review them together.');
  });

  it('keeps the shared student actions concise and separate from teacher and model setup', () => {
    const descriptions = SYSTEMS_MAPPING_STAGES.map(({ description }) => description);
    expect(descriptions[0]).toBe('Students add one memo. It stays with the project through all four levels.');
    descriptions.forEach((description) => expect(description.length).toBeLessThanOrEqual(100));
    expect(descriptions.join(' ')).not.toMatch(/choose a level|new memo|teacher|instructor|model|provider|prompt|submission|approval/i);
  });

  it('uses the normalized level titles and keeps their fixed distinctions in shared copy', () => {
    expect(SYSTEMS_MAPPING_LEVELS.map(({ title }) => title)).toEqual([
      'Micro-level',
      'Meso-level',
      'Exo-level',
      'Macro-level',
    ]);
    expect(systemsMappingLevelTitle('exosphere')).toBe('Exo-level');
    expect(systemsMappingLevelTitle('macrosphere')).toBe('Macro-level');
    expect(SYSTEMS_MAPPING_LEVELS.find(({ id }) => id === 'meso').description).toMatch(/at least two immediate settings.*without adding a directional relationship/i);
    expect(SYSTEMS_MAPPING_LEVELS.find(({ id }) => id === 'macrosphere').description).toMatch(/broader laws.*more than one mapped element/i);
  });
});
