import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SYSTEMS_MAPPING_LEVELS, systemsMappingLevelTitle } from '../shared/systems-mapping-parts.js';
import { SYSTEMS_MAPPING_STAGES } from '../shared/systems-mapping-stages.js';

const studentCopySources = [
  './App.jsx',
  './MapListView.jsx',
  './TeacherDashboard.jsx',
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
    expect(source).toContain('Model suggestions stay off the map until you choose Add to map. Editing a suggestion does not add it. Choose Set aside — needs evidence to preserve a question for later, or Remove to leave it off the map.');
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
    expect(SYSTEMS_MAPPING_LEVELS.find(({ id }) => id === 'macrosphere').description).toMatch(/broader laws.*more than one map item/i);
  });

  it('gives every level one explicit progression contract', () => {
    const contracts = Object.fromEntries(SYSTEMS_MAPPING_LEVELS.map((level) => [level.id, level]));
    SYSTEMS_MAPPING_LEVELS.forEach((level) => {
      expect(level.reviewInstruction, `${level.id} review instruction`).toBeTruthy();
      expect(level.chooseInstruction, `${level.id} choose instruction`).toBeTruthy();
      expect(level.uses, `${level.id} uses`).toBeTruthy();
      expect(level.adds, `${level.id} adds`).toBeTruthy();
      expect(level.boundary, `${level.id} boundary`).toBeTruthy();
    });
    expect(contracts.meso.boundary).toMatch(/do not add.*relationship edges/i);
    expect(contracts.exosphere.uses).toBe('Micro-level settings');
    expect(contracts.exosphere.boundary).toMatch(/participates.*Micro-level.*broader conditions.*Macro-level/i);
    expect(contracts.macrosphere.uses).toBe('Map items from earlier levels');
    expect(contracts.macrosphere.boundary).toMatch(/Micro-level.*participates.*Exo-level.*decisions/i);
  });

  it('uses decision-setting language for Exo-level and plain Meso explanation copy', () => {
    const source = readFileSync(fileURLToPath(new URL(studentCopySources[0], import.meta.url)), 'utf8');
    expect(source).toContain('Suggested Exo-level decision settings');
    expect(source).toContain('New decision setting');
    expect(source).toContain('Decision setting name');
    expect(source).toContain('Add decision setting');
    expect(source).toContain('Explain how these settings interact');
    expect(source).not.toContain('Suggested Exo-level institutions');
    expect(source).not.toContain('Place named institutions at Exo-level');
    expect(source).not.toContain('What passes, coordinates, or conflicts?');
  });

  it('keeps student headings free of standalone articles', () => {
    const appSource = readFileSync(fileURLToPath(new URL(studentCopySources[0], import.meta.url)), 'utf8');
    const listSource = readFileSync(fileURLToPath(new URL(studentCopySources[1], import.meta.url)), 'utf8');
    const teacherSource = readFileSync(fileURLToPath(new URL(studentCopySources[2], import.meta.url)), 'utf8');
    const visibleSource = `${appSource}\n${listSource}\n${teacherSource}`;
    const literalHeadings = [
      ...[...visibleSource.matchAll(/<h[1-3][^>]*>([^<>{}]+)<\/h[1-3]>/g)].map((match) => match[1].trim()),
      ...[...appSource.matchAll(/<(?:Modal)[^>]*\btitle="([^"]+)"/g)].map((match) => match[1].trim()),
      ...[...appSource.matchAll(/\b(?:title|scaffoldTitle):\s*['`]([^'`]+)['`]/g)].map((match) => match[1].trim()),
      ...[...teacherSource.matchAll(/<h[1-3][^>]*>([^<>{}]+)<\/h[1-3]>/g)].map((match) => match[1].trim()),
    ];
    literalHeadings.forEach((heading) => expect(heading, heading).not.toMatch(/\b(?:a|an|the)\b/i));
    [
      'Describe a direct relationship',
      'Describe a decision pathway',
      'Add a mesosystem',
      'Add an institution',
      'Add a Macro-level condition',
      'Map as a list',
      'Build the map',
      'Add a node',
      'Add a relationship',
      'Export the full map',
      'Start a new project?',
      'Work at a released level',
      'Start a new map from this memo?',
      'Delete the server copy?',
      'Set up a teacher account',
    ].forEach((heading) => expect(visibleSource).not.toContain(heading));
  });
});
