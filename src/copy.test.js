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

  it('uses action labels without repeated candidate explanations', () => {
    const source = readFileSync(fileURLToPath(new URL(studentCopySources[0], import.meta.url)), 'utf8');
    expect(source).toContain('Choose what belongs on the map');
    expect(source).toContain('Item settings');
    expect(source).not.toContain('Add puts a suggestion on the map');
    expect(source).not.toContain('Only what you add joins the map');
    expect(source).not.toContain('Runs on the class server. Your memo goes to no outside model');
  });

  it('keeps the shared student actions concise and separate from teacher and model setup', () => {
    const descriptions = SYSTEMS_MAPPING_STAGES.map(({ description }) => description);
    expect(descriptions[0]).toBe('Memo');
    descriptions.forEach((description) => {
      expect(description.length).toBeLessThanOrEqual(65);
      expect(description).not.toContain('.');
    });
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
    expect(SYSTEMS_MAPPING_LEVELS.find(({ id }) => id === 'micro').reviewInstruction).toContain('Relationships are added during Meso');
    const meso = SYSTEMS_MAPPING_LEVELS.find(({ id }) => id === 'meso');
    expect(meso.description).toMatch(/relationships.*already mapped at Micro-level/i);
    expect(meso.chooseInstruction).toMatch(/connect two existing Micro nodes.*one-way or two-way arrow/i);
    expect(SYSTEMS_MAPPING_LEVELS.find(({ id }) => id === 'macrosphere').description).toMatch(/relationships.*larger-scale.*local map/i);
  });

  it('keeps level distinctions without the repeated Uses/Adds/Boundary panel', () => {
    SYSTEMS_MAPPING_LEVELS.forEach((level) => {
      expect(level.reviewInstruction, `${level.id} review instruction`).toBeTruthy();
      expect(level.chooseInstruction, `${level.id} choose instruction`).toBeTruthy();
      expect(level).not.toHaveProperty('uses');
      expect(level).not.toHaveProperty('adds');
      expect(level).not.toHaveProperty('boundary');
    });
    expect(SYSTEMS_MAPPING_LEVELS.find(({ id }) => id === 'meso').checklist).toContain('Keep the same nodes and their positions from Micro-level.');
    expect(SYSTEMS_MAPPING_LEVELS.find(({ id }) => id === 'exosphere').description).toMatch(/larger-scale/i);
    expect(SYSTEMS_MAPPING_LEVELS.find(({ id }) => id === 'macrosphere').description).toMatch(/relationships.*larger-scale/i);
  });

  it('uses paired node and relationship language without obsolete pathway forms', () => {
    expect(SYSTEMS_MAPPING_LEVELS.find(level => level.id === 'exosphere').reviewInstruction).toMatch(/additional larger-scale nodes/);
    expect(SYSTEMS_MAPPING_LEVELS.find(level => level.id === 'macrosphere').chooseInstruction).toContain('Cross-scale connections are allowed');
    const source = readFileSync(fileURLToPath(new URL(studentCopySources[0], import.meta.url)), 'utf8');
    expect(source).not.toContain('Disclosure title="Add decision setting"');
    expect(source).not.toContain('Disclosure title="Add condition"');
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
