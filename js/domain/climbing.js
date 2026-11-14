// Climbing: session types and project progress.
import { compareGrades, normalizeGrade } from './grades.js';

export const SESSION_TYPES = ['Projektieren', 'Volumen', 'Power-Endurance (Route)', 'Technik', 'Onsight-Training', 'Bouldern', 'Sonstiges'];
export const PLACES = ['Halle', 'Fels'];
export const PROJECT_STATUS = ['aktiv', 'pausiert', 'geschafft', 'aufgegeben'];

/** Every attempt entry of a project across all sessions, oldest first. */
export function projectTimeline(projectId, sessions) {
  const out = [];
  for (const s of sessions) {
    for (const a of s.projectAttempts ?? []) {
      if (a.projectId !== projectId) continue;
      out.push({ date: s.date, sessionId: s.id, attempts: Number(a.attempts) || 0, highpoint: a.highpoint || '', highpointPct: a.highpointPct ?? null, note: a.note || '' });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function projectStats(project, sessions) {
  const tl = projectTimeline(project.id, sessions);
  const pcts = tl.map(t => t.highpointPct).filter(v => v != null);
  return {
    timeline: tl,
    sessions: tl.length,
    attempts: tl.reduce((a, t) => a + t.attempts, 0),
    bestPct: project.status === 'geschafft' ? 100 : (pcts.length ? Math.max(...pcts) : null),
    lastDate: tl.at(-1)?.date ?? null,
    lastHighpoint: [...tl].reverse().find(t => t.highpoint)?.highpoint ?? '',
  };
}

/** Projects that an RP/OS/Flash tick would complete. */
export function projectsCompletedBy(ticks, projects) {
  const open = projects.filter(p => p.status === 'aktiv' || p.status === 'pausiert');
  const hits = [];
  for (const t of ticks) {
    if (!['RP', 'OS', 'Flash'].includes(t.style)) continue;
    const name = (t.route ?? '').trim().toLowerCase();
    const p = open.find(x => x.id === t.projectId) ?? (name ? open.find(x => (x.name ?? '').trim().toLowerCase() === name) : null);
    if (p && !hits.some(h => h.project.id === p.id)) hits.push({ project: p, tick: t });
  }
  return hits;
}

/** Short summary of a session's ticks: count and hardest send. */
export function tickSummary(ticks) {
  const sends = ticks.filter(t => t.style !== 'Repeat' && normalizeGrade(t.grade));
  const hardest = sends.reduce((best, t) => (best == null || compareGrades(t.grade, best) > 0 ? normalizeGrade(t.grade) : best), null);
  return { count: ticks.length, hardest };
}
