// Hangboard: execution modes and the derived "% of body weight" value.

export const GRIPS = ['halfcrimp', 'open', 'slope', 'fullcrimp', 'pinch'];
export const GRIP_LABEL = { halfcrimp: 'Half Crimp', open: 'Open Hand', slope: 'Sloper', fullcrimp: 'Full Crimp', pinch: 'Pinch' };
export const HB_TYPES = ['Strength', 'PowerEndurance', 'PullUp'];
export const HB_TYPE_LABEL = { Strength: 'Maximalkraft', PowerEndurance: 'Power-Endurance', PullUp: 'Klimmzüge', Custom: 'Eigenes Training' };
/** Free-form training with its own name (`session.name`); blocks may use any mode incl. pull-ups. */
export const CUSTOM = 'Custom';
export const EDITOR_TYPES = [...HB_TYPES, CUSTOM];
export const MODES = ['lift_one_arm', 'hang_one_arm', 'hang_two_arm'];
export const CUSTOM_MODES = [...MODES, 'pullup'];
export const MODE_LABEL = { lift_one_arm: 'Einarmig heben', hang_one_arm: 'Einarmig hängen', hang_two_arm: 'Beidarmig hängen', pullup: 'Klimmzug' };
export const MODE_SHORT = { lift_one_arm: '1-arm Lift', hang_one_arm: '1-arm Hang', hang_two_arm: '2-arm Hang', pullup: 'Klimmzug' };
/** Modes that load one hand at a time. */
export const isOneArm = mode => mode === 'lift_one_arm' || mode === 'hang_one_arm';

/**
 * Body weight valid for `date`: the last entry on or before it.
 * If the series only starts later, the earliest entry is used and flagged `approx`.
 */
export function bodyweightAt(entries, date) {
  let before = null, earliest = null;
  for (const e of entries) {
    if (!(Number(e.kg) > 0) || !e.date) continue;
    if (e.date <= date && (!before || e.date > before.date)) before = e;
    if (!earliest || e.date < earliest.date) earliest = e;
  }
  if (before) return { kg: Number(before.kg), date: before.date, approx: false };
  if (earliest) return { kg: Number(earliest.kg), date: earliest.date, approx: true };
  return null;
}

/**
 * % of body weight.
 *  - hang_two_arm / pullup: (BW + load) / BW   (negative load = assisted)
 *  - hang_one_arm:          (BW + load) / BW   on one hand (negative load = assisted)
 *  - lift_one_arm:          load / BW          (per hand)
 */
export function pctBodyweight(mode, loadKg, bwKg) {
  const load = Number(loadKg), bw = Number(bwKg);
  if (!Number.isFinite(load) || !(bw > 0)) return null;
  return (mode === 'lift_one_arm' ? load / bw : (bw + load) / bw) * 100;
}

/** Display name of a session's training type; custom trainings show their own name. */
export const sessionLabel = s => (s.type === CUSTOM ? (s.name?.trim() || HB_TYPE_LABEL.Custom) : HB_TYPE_LABEL[s.type] ?? s.type);

/** Names of all custom trainings used so far, most recent first. */
export function customNames(sessions) {
  const out = [];
  for (const s of [...sessions].sort((a, b) => b.date.localeCompare(a.date))) {
    const n = s.type === CUSTOM ? s.name?.trim() : '';
    if (n && !out.some(x => x.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return out;
}

/** Type part of a series key: custom trainings are only comparable with the same name. */
const typeKey = (type, name) => (type === CUSTOM ? `${CUSTOM}:${(name ?? '').trim()}` : type);

/** Series key: values are only comparable within the same type, mode, grip and edge. */
export function blockKey(type, b, name) {
  if (type === CUSTOM && b.mode === 'pullup') return `${typeKey(type, name)}|pullup||`;
  if (type === 'PullUp' || b.mode === 'pullup') return 'PullUp|pullup||';
  return `${typeKey(type, name)}|${b.mode}|${b.grip ?? ''}|${b.edge_mm ?? ''}`;
}

export function keyLabel(key) {
  const [type, mode, grip, edge] = key.split('|');
  const custom = type.startsWith(`${CUSTOM}:`) ? type.slice(CUSTOM.length + 1) || HB_TYPE_LABEL.Custom : null;
  if (mode === 'pullup') return custom ? `${custom} · Klimmzug` : 'Klimmzüge mit Zusatzgewicht';
  return [custom ?? HB_TYPE_LABEL[type] ?? type, MODE_SHORT[mode] ?? mode, GRIP_LABEL[grip] ?? grip, edge ? `${edge} mm` : ''].filter(Boolean).join(' · ');
}

export const fmtLoad = (mode, kg) => {
  if (kg == null) return '–';
  const n = Number(kg).toLocaleString('de-DE', { maximumFractionDigits: 1 });
  if (mode === 'lift_one_arm') return `${n} kg`;
  return Number(kg) === 0 ? 'Körpergewicht' : `${Number(kg) > 0 ? '+' : '−'}${Math.abs(Number(kg)).toLocaleString('de-DE', { maximumFractionDigits: 1 })} kg`;
};

/** Human-readable one-liner for a block. */
export function describeBlock(type, b) {
  const sets = Number(b.sets) > 1 ? `${b.sets} × ` : '';
  if (type === 'PullUp' || b.mode === 'pullup') return `${sets}${b.reps ?? '?'} Klimmzüge ${fmtLoad('pullup', b.load_kg)}${b.rest_s ? ` · ${fmtSecs(b.rest_s)} Pause` : ''}`;
  const proto = type === 'PowerEndurance'
    ? (b.work_s ? `${b.work_s}/${b.rest_s ?? '?'} s` : '')
    : (b.work_s ? `${b.work_s} s${b.rest_s ? ` / ${fmtSecs(b.rest_s)} Pause` : ''}` : '');
  const reps = b.reps != null ? `${sets}${b.reps} Wdh.` : (b.sets > 1 ? `${b.sets} Sätze` : '');
  return [fmtLoad(b.mode, b.load_kg), reps, proto, GRIP_LABEL[b.grip] ?? b.grip, b.edge_mm ? `${b.edge_mm} mm` : '', MODE_SHORT[b.mode], b.switching ? 'Seitenwechsel' : '']
    .filter(Boolean).join(' · ');
}

export const fmtSecs = s => (s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);

/** Time under tension of a block in seconds (0 if unknown). */
export function timeUnderTension(b) {
  return (Number(b.work_s) || 0) * (Number(b.reps) || 0) * (Number(b.sets) || 1);
}

/**
 * Per series key the heaviest block of each session, as % of body weight.
 * @returns Map key → { key, label, type, mode, grip, edge, pts: [{ date, pct, load, bw, bwApprox, block, session }] }
 */
export function hangSeries(sessions, bodyweights) {
  const out = new Map();
  for (const s of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    const bw = bodyweightAt(bodyweights, s.date);
    const best = new Map();
    for (const b of s.blocks ?? []) {
      if (b.load_kg == null) continue;
      const key = blockKey(s.type, b, s.name);
      const cur = best.get(key);
      if (!cur || Number(b.load_kg) > Number(cur.load_kg)) best.set(key, b);
    }
    for (const [key, b] of best) {
      const mode = s.type === 'PullUp' ? 'pullup' : b.mode;
      const series = out.get(key) ?? { key, label: keyLabel(key), type: s.type, mode, grip: b.grip, edge: b.edge_mm, pts: [] };
      series.pts.push({
        date: s.date, load: Number(b.load_kg), bw: bw?.kg ?? null, bwApprox: bw?.approx ?? false,
        pct: bw ? pctBodyweight(mode, b.load_kg, bw.kg) : null, block: b, session: s,
      });
      out.set(key, series);
    }
  }
  return out;
}

/** Epley estimate of the one-rep maximum for a total load. */
export const epley1RM = (totalKg, reps) => (reps > 1 ? totalKg * (1 + reps / 30) : totalKg);
