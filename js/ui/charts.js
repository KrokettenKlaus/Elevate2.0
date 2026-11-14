// SVG charts, grown out of RehabBoard's barChart / lineChart / sparkline / niceTicks.
// One y-axis per chart, thin marks, 2 px gaps between stacked segments, a hover
// layer on everything. Colours come from the CSS tokens.
import { MSHORT, addDays, dateRange, daysBetween, fmtD, fmtDs, toUTC, today, wd, weekday } from '../domain/dates.js';
import { esc, fmtNum, h } from './dom.js';
import { hideTip, showTip } from './dialog.js';

const NS = 'http://www.w3.org/2000/svg';
const DAY = 864e5;
export const sv = (tag, attrs = {}, text) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};
const M = { l: 44, r: 16, t: 12, b: 26 };
const widthOf = el => Math.max(260, el.clientWidth || 520);
const noData = (el, text = 'Noch keine Daten') => { el.replaceChildren(h('div', { class: 'chart-empty' }, text)); };

export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) { max = min + 1; min = Math.max(0, min - 1); }
  const span = max - min, step0 = span / count, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= count) || 10 * mag;
  const lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step;
  const t = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) t.push(+v.toFixed(6));
  return t;
}

const fmtTick = t => (Math.abs(t) >= 10000 ? `${fmtNum(t / 1000, 0)}k` : Math.abs(t) >= 1000 ? `${fmtNum(t / 1000, 1)}k` : fmtNum(t, 2));

function yAxis(svg, ticks, Y, W, fmt = fmtTick) {
  const g = sv('g', { class: 'axis' });
  for (const t of ticks) {
    g.append(sv('line', { x1: M.l, x2: W - M.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'baseline' : 'gridline' }));
    g.append(sv('text', { x: M.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }, fmt(t)));
  }
  svg.append(g);
  return g;
}

/** Date ticks that fit the width: days, weeks (Mondays) or months. */
function dateTicks(x0, x1, maxLabels) {
  const from = new Date(x0).toISOString().slice(0, 10), to = new Date(x1).toISOString().slice(0, 10);
  const span = daysBetween(from, to);
  const out = [];
  if (span <= 62) {
    const stepDays = [1, 2, 7, 14].find(s => span / s <= maxLabels) ?? 14;
    let d = from;
    if (stepDays >= 7) while (weekday(d) !== 1) d = addDays(d, 1);
    for (; d <= to; d = addDays(d, stepDays)) out.push({ t: toUTC(d), label: fmtDs(d) });
    return out;
  }
  const months = [];
  const d = new Date(x0);
  d.setUTCDate(1);
  if (d.getTime() < x0) d.setUTCMonth(d.getUTCMonth() + 1);
  for (; d.getTime() <= x1; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(new Date(d));
  const every = Math.max(1, Math.ceil(months.length / maxLabels));
  months.forEach((m, i) => {
    if (i % every) return;
    out.push({ t: m.getTime(), label: m.getUTCMonth() === 0 ? `${MSHORT[0]} ${m.getUTCFullYear()}` : MSHORT[m.getUTCMonth()] });
  });
  return out;
}

/**
 * Line chart over time.
 * series: [{ name, color, pts: [{ date, y, … }], dash?, area?, markers? }]
 * opts: { height, unit, dec, tipFn(pts), refLines: [{ y, label, color }], bands: [{ from, to, cls }],
 *         xFrom, xTo, bandScale, yMin, yMax, zeroBased = true, yFmt }
 */
export function lineChart(el, series, o = {}) {
  const live = series.map(s => ({ ...s, pts: s.pts.filter(p => p.y != null && Number.isFinite(p.y)).sort((a, b) => a.date.localeCompare(b.date)) }));
  const all = live.flatMap(s => s.pts);
  if (!all.length) return noData(el, o.empty);
  el.replaceChildren();
  const W = widthOf(el), H = o.height ?? 220;
  const refs = o.refLines ?? [];
  let x0 = o.xFrom ? toUTC(o.xFrom) : Math.min(...all.map(p => toUTC(p.date)), ...refs.filter(r => r.date).map(r => toUTC(r.date)));
  let x1 = o.xTo ? toUTC(o.xTo) : Math.max(...all.map(p => toUTC(p.date)));
  if (x0 === x1) { x0 -= DAY * 3; x1 += DAY * 3; }
  const ys = [...all.map(p => p.y), ...refs.map(r => r.y), ...(o.bands ?? []).flatMap(b => [b.from, b.to])].filter(Number.isFinite);
  const lo = o.yMin ?? (o.zeroBased === false ? Math.min(...ys) : Math.min(0, ...ys));
  const hi = o.yMax ?? Math.max(...ys);
  const ticks = niceTicks(lo, hi, o.ticks ?? 5);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const plotW = W - M.l - M.r;
  const nDays = Math.round((x1 - x0) / DAY) + 1;
  const X = o.bandScale ? t => M.l + ((t - x0) / DAY + 0.5) * (plotW / nDays) : t => M.l + (t - x0) / (x1 - x0) * plotW;
  const Y = v => H - M.b - (v - y0) / (y1 - y0) * (H - M.t - M.b);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': o.label ?? series.map(s => s.name).filter(Boolean).join(', ') });

  for (const b of o.bands ?? []) {
    svg.append(sv('rect', { x: M.l, width: plotW, y: Y(Math.min(b.to, y1)), height: Math.max(0, Y(Math.max(b.from, y0)) - Y(Math.min(b.to, y1))), class: `band ${b.cls ?? ''}` }));
  }
  const ax = yAxis(svg, ticks, Y, W, o.yFmt);
  for (const t of dateTicks(x0, x1, Math.max(2, Math.floor(plotW / 64)))) {
    ax.append(sv('text', { x: X(t.t), y: H - 6, 'text-anchor': 'middle' }, t.label));
  }
  for (const r of refs) {
    if (!(r.y >= y0 && r.y <= y1)) continue;
    svg.append(sv('line', { x1: M.l, x2: W - M.r, y1: Y(r.y), y2: Y(r.y), class: `refline ${r.cls ?? ''}`, style: r.color ? `stroke:${r.color}` : null }));
    if (r.label) svg.append(sv('text', { x: W - M.r - 2, y: Y(r.y) + (r.below ? 14 : -5), 'text-anchor': 'end', class: 'reflabel' }, r.label));
  }
  for (const s of live) {
    if (!s.pts.length) continue;
    const color = s.color ?? 'var(--accent)';
    const coords = s.pts.map(p => [X(toUTC(p.date)), Y(p.y)]);
    const d = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    if (s.area && coords.length > 1) {
      svg.append(sv('path', { d: `${d}L${coords.at(-1)[0].toFixed(1)},${Y(Math.max(0, y0))}L${coords[0][0].toFixed(1)},${Y(Math.max(0, y0))}Z`, fill: color, opacity: 0.12 }));
    }
    svg.append(sv('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dash ?? null }));
    if ((s.markers ?? s.pts.length <= 60)) {
      for (const [x, y] of coords) svg.append(sv('circle', { cx: x, cy: y, r: 4, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 }));
    } else {
      const [x, y] = coords.at(-1);
      svg.append(sv('circle', { cx: x, cy: y, r: 4, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 }));
    }
  }

  // hover layer: crosshair on the nearest date, tooltip lists every series at that date
  const cross = sv('line', { y1: M.t, y2: H - M.b, class: 'crosshair', opacity: 0 });
  const hots = live.map(s => sv('circle', { r: 6, fill: s.color ?? 'var(--accent)', stroke: 'var(--surface)', 'stroke-width': 2, opacity: 0 }));
  svg.append(cross, ...hots);
  const dates = [...new Set(all.map(p => p.date))].sort();
  const ov = sv('rect', { x: M.l, y: 0, width: plotW, height: H, fill: 'transparent' });
  const move = ev => {
    const r = svg.getBoundingClientRect(), mx = (ev.clientX - r.left) * (W / r.width);
    let best = dates[0];
    for (const d of dates) if (Math.abs(X(toUTC(d)) - mx) < Math.abs(X(toUTC(best)) - mx)) best = d;
    const x = X(toUTC(best));
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('opacity', 1);
    const hits = [];
    live.forEach((s, i) => {
      const p = s.pts.find(q => q.date === best);
      hots[i].setAttribute('opacity', p ? 1 : 0);
      if (p) { hots[i].setAttribute('cx', x); hots[i].setAttribute('cy', Y(p.y)); hits.push({ ...p, series: s }); }
    });
    const html = o.tipFn ? o.tipFn(hits, best) : `<div class="t">${wd(best)}, ${fmtD(best)}</div>${hits.map(p => `${tipKey(p.series.color)}${live.length > 1 ? `${esc(p.series.name)} ` : ''}<b>${fmtNum(p.y, o.dec ?? 1)}${o.unit ?? ''}</b>`).join('<br>')}`;
    showTip(ev, html);
  };
  const leave = () => { cross.setAttribute('opacity', 0); hots.forEach(c => c.setAttribute('opacity', 0)); hideTip(); };
  ov.addEventListener('pointermove', move);
  ov.addEventListener('pointerdown', move);
  ov.addEventListener('pointerleave', leave);
  svg.append(ov);
  el.append(svg);
}

export const tipKey = color => `<i class="tip-key" style="background:${color ?? 'var(--accent)'}"></i>`;

/**
 * Stacked bar chart.
 * items: [{ label, segs: [{ v, color, name }], tip, date?, muted? }]
 * opts: { height, labelEvery, yFmt, onClick(item), refLines, maxBar, yMax }
 */
export function barChart(el, items, o = {}) {
  if (!items.length) return noData(el, o.empty);
  el.replaceChildren();
  const W = widthOf(el), H = o.height ?? 220;
  const totals = items.map(it => it.segs.reduce((a, s) => a + (s.v || 0), 0));
  const refs = o.refLines ?? [];
  const ticks = niceTicks(0, Math.max(o.yMax ?? 0, ...totals, ...refs.map(r => r.y), 1), o.ticks ?? 4);
  const y1 = ticks[ticks.length - 1];
  const Y = v => H - M.b - v / y1 * (H - M.t - M.b);
  const bw = (W - M.l - M.r) / items.length, barW = Math.max(3, Math.min(o.maxBar ?? 28, bw - (bw > 10 ? 4 : 1.5)));
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': o.label ?? 'Balkendiagramm' });
  const ax = yAxis(svg, ticks, Y, W, o.yFmt);
  const every = o.labelEvery ?? Math.max(1, Math.ceil(items.length / Math.max(2, Math.floor((W - M.l - M.r) / 56))));
  items.forEach((it, i) => {
    if (i % every || !it.label) return;
    ax.append(sv('text', { x: M.l + bw * i + bw / 2, y: H - 6, 'text-anchor': 'middle', class: it.strong ? 'strong' : null }, it.label));
  });
  for (const r of refs) {
    svg.append(sv('line', { x1: M.l, x2: W - M.r, y1: Y(r.y), y2: Y(r.y), class: `refline ${r.cls ?? ''}` }));
    if (r.label) svg.append(sv('text', { x: W - M.r - 2, y: Y(r.y) - 5, 'text-anchor': 'end', class: 'reflabel' }, r.label));
  }
  items.forEach((it, i) => {
    const cx = M.l + bw * i + bw / 2, g = sv('g', { opacity: it.muted ? 0.45 : 1 });
    let base = 0;
    const segs = it.segs.filter(s => s.v > 0);
    segs.forEach((s, si) => {
      const top = si === segs.length - 1;
      const yTop = Y(base + s.v), yBot = Y(base);
      const hgt = Math.max(0.5, yBot - yTop - (si > 0 ? 2 : 0));
      const r = top ? Math.min(4, barW / 2, hgt) : 0;
      const x = cx - barW / 2, y = yTop, yb = y + hgt;
      g.append(sv('path', { d: `M${x},${yb}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${yb}Z`, fill: s.color ?? 'var(--accent)' }));
      base += s.v;
    });
    if (it.marker) g.append(sv('circle', { cx, cy: H - M.b + 5, r: 2.5, class: 'bar-marker' }));
    const hit = sv('rect', { x: M.l + bw * i, y: M.t, width: bw, height: H - M.t - M.b, fill: 'transparent', style: o.onClick ? 'cursor:pointer' : null });
    const tip = ev => { g.setAttribute('opacity', 0.78); if (it.tip) showTip(ev, it.tip); };
    hit.addEventListener('pointermove', tip);
    hit.addEventListener('pointerdown', tip);
    hit.addEventListener('pointerleave', () => { g.setAttribute('opacity', it.muted ? 0.45 : 1); hideTip(); });
    if (o.onClick) hit.addEventListener('click', () => { hideTip(); o.onClick(it); });
    svg.append(g, hit);
  });
  el.append(svg);
}

/** Tiny inline trend line; returns markup. */
export function sparkline(vals, w = 120, hgt = 28, color = 'var(--accent)') {
  const v = vals.filter(x => x != null);
  if (v.length < 2) return '';
  const min = Math.min(...v), max = Math.max(...v), rng = max - min || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1) * (w - 8) + 4).toFixed(1)},${(hgt - 4 - (y - min) / rng * (hgt - 8)).toFixed(1)}`);
  const [lx, ly] = pts[pts.length - 1].split(',');
  return `<svg class="spark" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${lx}" cy="${ly}" r="3" fill="${color}"/></svg>`;
}

/**
 * Grade pyramid made of bricks: one brick per ascent, coloured by style;
 * missing ascents of the target pyramid are drawn as empty outlines.
 * rows: [{ grade, OS, Flash, RP, Repeat, sends, target, missing }] (hardest first)
 */
export function pyramidChart(el, rows, { goal, compact = false, onRow } = {}) {
  if (!rows.length) return noData(el, 'Noch keine Ticks');
  const STYLE_ORDER = ['OS', 'Flash', 'RP', 'Repeat'];
  const widest = Math.max(1, ...rows.map(r => Math.max(r.sends + r.Repeat, r.target) + (r.Repeat ? 0 : 0)));
  const avail = Math.max(120, (el.clientWidth || 480) - 108);
  const brick = Math.max(4, Math.min(compact ? 20 : 30, Math.floor(avail / widest) - 3));
  const wrap = h('div', { class: `pyramid${compact ? ' compact' : ''}`, style: { '--brick': `${brick}px` } });
  for (const r of rows) {
    const bricks = [];
    for (const st of STYLE_ORDER) for (let i = 0; i < r[st]; i++) bricks.push(h('i', { class: `brick st-${st}` }));
    for (let i = 0; i < r.missing; i++) bricks.push(h('i', { class: 'brick missing' }));
    const count = r.target ? `${r.sends}/${r.target}` : String(r.sends || '');
    const row = h('div', { class: `pyr-row${r.grade === goal ? ' goal' : ''}${onRow ? ' click' : ''}`, onclick: onRow ? () => onRow(r) : null },
      h('span', { class: 'pyr-grade' }, r.grade),
      h('div', { class: 'pyr-bricks' }, bricks),
      h('span', { class: `pyr-count${r.target && r.sends >= r.target ? ' full' : ''}` }, count));
    const tip = ev => showTip(ev, `<div class="t">${esc(r.grade)}${r.grade === goal ? ' · Ziel' : ''}</div>`
      + STYLE_ORDER.filter(s => r[s]).map(s => `<i class="tip-key st-${s}"></i>${s} <b>${r[s]}</b>`).join('<br>')
      + (r.target ? `${r.sends || r.Repeat ? '<br>' : ''}Soll <b>${r.target}</b>${r.missing ? ` · es fehlen <b>${r.missing}</b>` : ' · erfüllt'}` : '')
      + (!r.sends && !r.Repeat && !r.target ? 'keine Begehung' : ''));
    row.addEventListener('pointermove', tip);
    row.addEventListener('pointerleave', hideTip);
    wrap.append(row);
  }
  el.replaceChildren(wrap);
}

/**
 * GitHub-style calendar: one column per week, Monday on top.
 * cellFn(date) → { cls?, color?, tip?, onClick? } | null
 */
export function heatCalendar(el, from, to, cellFn) {
  const t = today();
  const days = h('div', { class: 'cal-days' }, h('span'), ['Mo', '', 'Mi', '', 'Fr', '', 'So'].map(d => h('span', {}, d)));
  const weeks = h('div', { class: 'cal-weeks' });
  let lastMonth = -1;
  for (let w = from; w <= to; w = addDays(w, 7)) {
    const m = Number(addDays(w, 3).slice(5, 7)) - 1;
    weeks.append(h('span', { class: 'cal-month' }, m !== lastMonth ? MSHORT[m] : ''));
    lastMonth = m;
    for (const date of dateRange(w, addDays(w, 6))) {
      const c = cellFn(date) ?? {};
      const cell = h('div', { class: `cal-cell ${c.cls ?? ''}${date === t ? ' today' : ''}${date > t ? ' future' : ''}${c.onClick ? ' click' : ''}`, style: c.color ? { background: c.color } : null });
      cell.addEventListener('pointermove', ev => showTip(ev, `<div class="t">${wd(date)}, ${fmtD(date)}</div>${c.tip ?? 'kein Training'}`));
      cell.addEventListener('pointerleave', hideTip);
      if (c.onClick) cell.addEventListener('click', () => { hideTip(); c.onClick(); });
      weeks.append(cell);
    }
  }
  el.replaceChildren(days, weeks);
  requestAnimationFrame(() => { el.scrollLeft = el.scrollWidth; });
}

/**
 * Horizontal timeline of dated spans (training blocks, projects).
 * rows: [{ label, sub, from, to, color, tip, onClick, open? }]
 */
export function timeline(el, rows, { from, to, markToday = true, labelWidth = 0 } = {}) {
  if (!rows.length) return noData(el);
  const x0 = toUTC(from), x1 = toUTC(to) + DAY;
  const pct = d => Math.min(100, Math.max(0, (toUTC(d) - x0) / (x1 - x0) * 100));
  const track = h('div', { class: 'tl' });
  const axis = h('div', { class: 'tl-axis' });
  const W = Math.max(200, (el.clientWidth || 600) - labelWidth);
  for (const t of dateTicks(x0, x1 - DAY, Math.max(2, Math.floor(W / 70)))) {
    axis.append(h('span', { style: { left: `${(t.t - x0) / (x1 - x0) * 100}%` } }, t.label));
  }
  track.append(axis);
  const t = today();
  for (const r of rows) {
    const left = pct(r.from), right = pct(addDays(r.to, 1));
    const bar = h('div', { class: `tl-bar${r.onClick ? ' click' : ''}${r.open ? ' open' : ''}`, style: { left: `${left}%`, width: `${Math.max(0.8, right - left)}%`, '--c': r.color ?? 'var(--accent)' }, onclick: r.onClick ?? null },
      h('b', {}, r.label), r.sub ? h('small', {}, r.sub) : null);
    if (r.tip) { bar.addEventListener('pointermove', ev => showTip(ev, r.tip)); bar.addEventListener('pointerleave', hideTip); }
    track.append(h('div', { class: 'tl-row' }, bar));
  }
  if (markToday && t >= from && t <= to) track.append(h('div', { class: 'tl-today', style: { left: `${pct(t)}%` } }, h('span', {}, 'heute')));
  el.replaceChildren(track);
}

/** Ranked horizontal bars (e.g. most frequent exercises). rows: [{ label, value, cls, tip }] */
export function rankBars(el, rows, { color } = {}) {
  if (!rows.length) return noData(el);
  const max = Math.max(1, ...rows.map(r => r.value));
  el.replaceChildren(...rows.map(r => {
    const row = h('div', { class: 'freq-row' },
      h('span', { class: 'lbl', title: r.label }, r.label),
      h('div', { class: 'freq-track' }, h('div', { class: `bar ${r.cls ?? ''}`, style: { width: `${r.value / max * 100}%`, background: r.color ?? color ?? null } })),
      h('span', { class: 'num' }, fmtNum(r.value)));
    if (r.tip) { row.addEventListener('pointermove', ev => showTip(ev, r.tip)); row.addEventListener('pointerleave', hideTip); }
    return row;
  }));
}
