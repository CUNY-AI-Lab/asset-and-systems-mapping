import { createHash } from 'node:crypto';

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export function revisionContent(project) {
  const { id, revision, fingerprint, ...submission } = project.submission;
  const source = { inquiry: project.inquiry, submission };
  const content = [source,
    { ...source, review: project.preflight?.memoReview ?? null },
    { candidates: project.candidates },
    { graph: project.graph, annotation: project.mapAnnotation },
    { graph: project.graph, annotation: project.mapAnnotation, reflection: project.reflection },
  ][project.stage];
  return createHash('sha256').update(JSON.stringify(stable(content))).digest('hex');
}
export class SubmittedRevisions {
  constructor(db) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS cloud_submitted_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,project_id TEXT NOT NULL,
      scale TEXT NOT NULL,stage INTEGER NOT NULL,content_hash TEXT NOT NULL,
      saved_revision INTEGER NOT NULL,submitted_at TEXT NOT NULL,
      UNIQUE(owner,project_id,saved_revision)
    );
    CREATE INDEX IF NOT EXISTS cloud_submitted_revisions_project ON cloud_submitted_revisions(owner,project_id,scale,stage,id);`);
  }
  submit(owner, project, savedRevision) {
    const previous = this.db.prepare('SELECT content_hash FROM cloud_submitted_revisions WHERE owner=? AND project_id=? AND scale=? AND stage=? ORDER BY id DESC LIMIT 1').get(owner, project.id, project.activeScale, project.stage);
    const hash = revisionContent(project);
    if (previous?.content_hash === hash) return { recorded: false };
    const result = this.db.prepare('INSERT OR IGNORE INTO cloud_submitted_revisions(owner,project_id,scale,stage,content_hash,saved_revision,submitted_at) VALUES (?,?,?,?,?,?,?)')
      .run(owner, project.id, project.activeScale, project.stage, hash, savedRevision, new Date().toISOString());
    return { recorded: result.changes === 1 };
  }
  summary(owner, projectId) {
    return this.db.prepare('SELECT scale,stage,count(*) AS count,max(submitted_at) AS lastSubmittedAt FROM cloud_submitted_revisions WHERE owner=? AND project_id=? GROUP BY scale,stage ORDER BY scale,stage').all(owner, projectId);
  }
}
