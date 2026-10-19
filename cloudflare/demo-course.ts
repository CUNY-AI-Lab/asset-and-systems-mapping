/** Read-only illustration shown only inside the authorized teaching demo. */
export const DEMO_COURSE_ID = 'cail-teaching-tools-demo';
export function demonstrationProgress() {
  return {
    demonstration: true, memberId: 'demonstration-student', displayName: 'Example student',
    firstSeen: null, lastSeen: null, projectCount: 1,
    projects: [{ id: 'demonstration-map', title: 'Example: classroom and family connections',
      revision: 3, updatedAt: null, activeScale: 'meso',
      submittedRevisions: [{ scale: 'micro', stage: 4, count: 2 }, { scale: 'meso', stage: 2, count: 1 }],
      levels: [
        { scale: 'micro', stage: 4, completed: true, started: true },
        { scale: 'meso', stage: 2, completed: false, started: true },
        { scale: 'exosphere', stage: 0, completed: false, started: false },
        { scale: 'macrosphere', stage: 0, completed: false, started: false },
      ],
    }],
  };
}
