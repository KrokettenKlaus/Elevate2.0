// Planning: week templates, planned units and the planned-vs-actual reconciliation.
import { DAY_KEYS, addDays, dayKey, inSeason, weekDates, weekStart } from './dates.js';

export const PLAN_MODULES = ['climbing', 'hangboard', 'strength', 'run', 'ride', 'mobility', 'rest'];
export const BLOCK_TYPES = ['Basis', 'Kraft', 'Power', 'Power-Endurance', 'Performance', 'Deload', 'Übergang'];
export const RUN_SPORTS = ['Run', 'TrailRun'];
export const RIDE_SPORTS = ['Ride', 'GravelRide', 'MountainBikeRide', 'VirtualRide'];

/** Default templates, created once on first start (plan 3.8). */
export function defaultTemplates() {
  const days = {
    mon: [{ module: 'rest' }],
    tue: [{ module: 'climbing' }],
    wed: [{ module: 'strength' }, { module: 'run' }],
    thu: [{ module: 'strength' }, { module: 'hangboard' }],
    fri: [{ module: 'run' }, { module: 'mobility' }],
    sat: [{ module: 'climbing' }],
    sun: [{ module: 'climbing', alt: 'a' }, { module: 'hangboard', alt: 'a' }],
  };
  return [
    { id: 'standard', name: 'Standard', variant: 'standard', days },
    { id: 'summer', name: 'Sommer', variant: 'summer', days: { ...days, sat: [{ module: 'ride' }] } },
  ];
}

export const blockAt = (blocks, date) => blocks.find(b => b.start && b.end && b.start <= date && date <= b.end) ?? null;

/** Which template applies on `date`: block template → summer variant → standard. */
export function templateForDate(date, templates, blocks, settings) {
  const block = blockAt(blocks, date);
  if (block?.templateId) {
    const t = templates.find(x => x.id === block.templateId);
    if (t) return t;
  }
  const summer = templates.find(t => t.variant === 'summer');
  if (summer && inSeason(date, settings?.summer?.from, settings?.summer?.to)) return summer;
  return templates.find(t => t.variant === 'standard') ?? templates[0] ?? null;
}

export const unitId = (date, n) => `pu-${date.replaceAll('-', '')}-${n}`;

/** Planned units of one week as the templates would produce them (nothing is stored). */
export function generateWeek(ws, templates, blocks, settings) {
  const units = [];
  for (const date of weekDates(ws)) {
    const tpl = templateForDate(date, templates, blocks, settings);
    const day = tpl?.days?.[dayKey(date)] ?? [];
    const list = day.length ? day : [{ module: 'rest' }];
    list.forEach((u, i) => units.push({ ...u, id: unitId(date, i + 1), date, templateId: tpl?.id ?? null }));
  }
  return units;
}

/**
 * The plan in force for a week. A week counts as "fixed" as soon as at least one
 * stored unit exists in it; otherwise the template is shown. Before `planStart`
 * there is no plan at all.
 */
export function weekPlan(ws, { planUnits, templates, blocks, settings }) {
  const end = addDays(ws, 6);
  const stored = planUnits.filter(u => u.date >= ws && u.date <= end);
  if (stored.length) return { fixed: true, planned: true, units: stored.slice().sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) };
  if (settings?.planStart && end < settings.planStart) return { fixed: false, planned: false, units: [] };
  return { fixed: false, planned: true, units: generateWeek(ws, templates, blocks, settings) };
}

const MOBILITY_RE = /yoga|mobil|stretch|dehn/i;

/** Every recorded session/activity as a comparable "actual". */
export function collectActuals(data) {
  const out = [];
  for (const s of data.climb_sessions ?? []) {
    out.push({ id: s.id, col: 'climb_sessions', date: s.date, module: 'climbing', label: s.type || 'Klettern', sub: s.place || '', duration_min: s.duration_min, rpe: s.rpe });
  }
  for (const s of data.hangboard_sessions ?? []) {
    out.push({ id: s.id, col: 'hangboard_sessions', date: s.date, module: 'hangboard', label: s.type || 'Hangboard', sub: '', duration_min: s.duration_min, rpe: s.rpe });
  }
  for (const s of data.strength_sessions ?? []) {
    const hasMobility = (s.exercises ?? []).some(e => e.category === 'Mobilität' || MOBILITY_RE.test(e.name ?? ''));
    out.push({ id: s.id, col: 'strength_sessions', date: s.date, module: 'strength', label: s.kind === 'physio' ? 'Physio' : 'Eigentraining', sub: `${(s.exercises ?? []).length} Übungen`, duration_min: s.duration_min, rpe: s.rpe, hasMobility });
  }
  for (const a of data.endurance_activities ?? []) {
    const mobility = MOBILITY_RE.test(a.sport ?? '') || MOBILITY_RE.test(a.name ?? '');
    out.push({ id: a.id, col: 'endurance_activities', date: a.date, module: mobility && a.module === 'other' ? 'mobility' : (a.module || 'other'), label: a.name || a.sport || 'Aktivität', sub: a.sport || '', duration_min: a.duration_min, rpe: a.rpe, hasMobility: mobility });
  }
  return out;
}

/**
 * Reconcile the planned units of one day with what actually happened.
 * Status: done | open | missed | alt (alternative that was not needed) | rest.
 * Actuals without a matching unit are returned as `extras`.
 */
export function reconcileDay(date, units, actuals, todayStr) {
  const pool = actuals.filter(a => a.date === date);
  const used = new Set();
  const pending = date >= todayStr ? 'open' : 'missed';
  const take = module => {
    const hit = pool.find(a => !used.has(a) && a.module === module);
    if (hit) used.add(hit);
    return hit ?? null;
  };
  const resolve = u => {
    if (u.module === 'rest') return { unit: u, status: 'rest', actual: null };
    if (u.manual === 'done') return { unit: u, status: 'done', actual: null, manual: true };
    if (u.manual === 'skipped') return { unit: u, status: 'missed', actual: null, manual: true };
    if (u.module === 'mobility') {
      const hit = take('mobility') ?? pool.find(a => a.hasMobility) ?? null;
      return { unit: u, status: hit ? 'done' : pending, actual: hit };
    }
    const hit = take(u.module);
    return { unit: u, status: hit ? 'done' : pending, actual: hit };
  };

  const items = [];
  const groups = new Map();
  for (const u of units) {
    if (u.alt) { const g = groups.get(u.alt) ?? []; g.push(u); groups.set(u.alt, g); }
  }
  const doneGroups = new Set();
  for (const u of units) {
    if (!u.alt) { items.push(resolve(u)); continue; }
    const group = groups.get(u.alt);
    if (group[0] !== u) continue; // a group is resolved once, at its first member
    const resolved = group.map(resolve);
    if (resolved.some(r => r.status === 'done')) {
      doneGroups.add(u.alt);
      for (const r of resolved) if (r.status !== 'done') r.status = 'alt';
    }
    for (const r of resolved) items.push({ ...r, alt: u.alt, altSize: group.length });
  }
  const extras = pool.filter(a => !used.has(a) && !items.some(i => i.actual === a));
  return { date, items, extras };
}

/** Reconcile a whole week. */
export function reconcileWeek(ws, plan, actuals, todayStr) {
  const days = weekDates(ws).map(date => {
    const day = reconcileDay(date, plan.units.filter(u => u.date === date), actuals, todayStr);
    return { ...day, planned: plan.planned };
  });
  return { weekStart: ws, fixed: plan.fixed, planned: plan.planned, days, summary: summarize(days) };
}

/** Counts per status; an "or" group counts as one planned unit. */
export function summarize(days) {
  const s = { planned: 0, done: 0, open: 0, missed: 0, extra: 0 };
  for (const d of days) {
    const seen = new Set();
    for (const i of d.items) {
      if (i.status === 'rest') continue;
      if (i.alt) {
        if (seen.has(i.alt)) continue;
        seen.add(i.alt);
        const group = d.items.filter(x => x.alt === i.alt);
        s.planned++;
        if (group.some(x => x.status === 'done')) s.done++;
        else if (group.some(x => x.status === 'open')) s.open++;
        else s.missed++;
        continue;
      }
      s.planned++;
      s[i.status]++;
    }
    s.extra += d.planned ? d.extras.length : 0;
  }
  s.adherence = s.planned ? s.done / s.planned : null;
  return s;
}

export { DAY_KEYS, weekStart };
