import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const studentCopySources = [
  './App.jsx',
  './domain.js',
  '../server/app.js',
  '../server/config.js',
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
    expect(source).toContain('Keep means add this suggestion to the map. Suggestions begin on Keep so you can review them together. Choose Needs more evidence to set one aside, or Remove to leave it off the map.');
    expect(source).not.toContain('Suggestions start on Keep. They appear together after you open the map. Choose Remove or Needs more evidence for anything that should not be added as shown.');
  });
});
