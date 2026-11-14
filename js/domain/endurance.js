// Endurance: sport mapping, the RPE suggestion, and tolerant reading of Strava data
// (Strava is parked for now; the import runs over COROS, see ./coros.js).
import { RIDE_SPORTS, RUN_SPORTS } from './plan.js';

export const SPORT_LABEL = {
  Run: 'Lauf', TrailRun: 'Trailrun', Ride: 'Rad', GravelRide: 'Gravel', MountainBikeRide: 'MTB', VirtualRide: 'Rolle',
  // names as the COROS connector prints them, for sports that stay "Sonstiges"
  Hike: 'Wandern', Walk: 'Gehen', Strength: 'Kraft (Uhr)', 'Gym Cardio': 'Cardio', 'E-Bike': 'E-Bike',
};
export const MANUAL_SPORTS = [...RUN_SPORTS, ...RIDE_SPORTS, 'Sonstiges'];

export function moduleForSport(sport) {
  const s = String(sport ?? '').replace(/\s+/g, '');
  if (RUN_SPORTS.includes(s)) return 'run';
  if (RIDE_SPORTS.includes(s)) return 'ride';
  return 'other';
}

const pick = (obj, keys) => {
  for (const k of keys) if (obj?.[k] != null && obj[k] !== '') return obj[k];
  return null;
};
const numOrNull = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * Find the list of activities in whatever a connector returned: an array, or an
 * object that carries one array of objects.
 */
export function findActivityList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const k of ['activities', 'data', 'items', 'results']) if (Array.isArray(payload[k])) return payload[k];
    const arr = Object.values(payload).find(v => Array.isArray(v) && v.every(x => x && typeof x === 'object'));
    if (arr) return arr;
  }
  return null;
}

/**
 * Map one Strava activity (field names as in the Strava API, with common
 * variants) to an endurance document. Returns null without an id or a date.
 */
export function normalizeStravaActivity(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const stravaId = pick(raw, ['id', 'activity_id', 'activityId']);
  const start = pick(raw, ['start_date_local', 'start_date', 'startDateLocal', 'startDate', 'date', 'start_time']);
  const date = typeof start === 'string' ? start.slice(0, 10) : null;
  if (stravaId == null || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const sport = String(pick(raw, ['sport_type', 'sportType', 'type', 'sport']) ?? 'Sonstiges').replace(/\s+/g, '');

  let durationMin = numOrNull(pick(raw, ['moving_time_min', 'duration_min']));
  if (durationMin == null) {
    const secs = numOrNull(pick(raw, ['moving_time', 'moving_time_s', 'moving_time_seconds', 'movingTime', 'elapsed_time', 'elapsedTime', 'duration']));
    durationMin = secs == null ? null : Math.round(secs / 60);
  }
  let distanceKm = numOrNull(pick(raw, ['distance_km', 'distanceKm']));
  if (distanceKm == null) {
    const m = numOrNull(pick(raw, ['distance', 'distance_m', 'distance_meters']));
    distanceKm = m == null ? null : Math.round(m / 10) / 100;
  }
  const loadRaw = {};
  for (const k of ['suffer_score', 'relative_effort', 'training_load', 'kilojoules', 'average_watts', 'weighted_average_watts', 'calories']) {
    if (raw[k] != null) loadRaw[k] = raw[k];
  }
  return {
    id: `strava-${stravaId}`,
    source: 'strava',
    stravaId: String(stravaId),
    date,
    startTime: typeof start === 'string' && start.length > 10 ? start : null,
    sport,
    module: moduleForSport(sport),
    name: String(pick(raw, ['name', 'title']) ?? sport),
    duration_min: durationMin,
    distance_km: distanceKm,
    elevation_m: numOrNull(pick(raw, ['total_elevation_gain', 'elevation_gain', 'elevation_gain_m', 'totalElevationGain'])),
    avg_hr: numOrNull(pick(raw, ['average_heartrate', 'avg_heartrate', 'average_hr', 'avg_hr', 'averageHeartrate'])),
    max_hr: numOrNull(pick(raw, ['max_heartrate', 'max_hr', 'maxHeartrate'])),
    loadRaw: Object.keys(loadRaw).length ? loadRaw : null,
  };
}

/** Read heart-rate zones from `get_athlete_zones` → [{ min, max }] (max may be -1 / null for open end). */
export function parseHrZones(payload) {
  const candidates = [payload?.heart_rate?.zones, payload?.heartRate?.zones, payload?.heart_rate, payload?.zones, payload];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length >= 3 && c.every(z => z && typeof z === 'object' && 'min' in z)) {
      return c.map(z => ({ min: Number(z.min), max: z.max == null || Number(z.max) <= 0 ? null : Number(z.max) }));
    }
  }
  return null;
}

/** Seconds per heart-rate zone from an activity detail payload, if it carries any. */
export function parseZoneTimes(payload) {
  const lists = [];
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 4) return;
    if (Array.isArray(v)) {
      if (v.length >= 3 && v.every(z => z && typeof z === 'object' && ('time' in z || 'seconds' in z || 'time_s' in z))) lists.push(v);
      v.forEach(x => walk(x, depth + 1));
      return;
    }
    if (v.type === 'heartrate' && Array.isArray(v.distribution_buckets)) lists.unshift(v.distribution_buckets);
    Object.values(v).forEach(x => walk(x, depth + 1));
  };
  walk(payload, 0);
  if (!lists.length) return null;
  const times = lists[0].map(z => Number(z.time ?? z.seconds ?? z.time_s) || 0);
  return times.some(t => t > 0) ? times : null;
}

const ZONE_RPE = [2.5, 4, 6, 7.5, 9.5];
const clampRpe = v => Math.min(10, Math.max(1, Math.round(v)));

/**
 * Intensity from the COROS training load per hour. The load is heart-rate based
 * (TRIMP-like) and grows with duration, so only the rate says how hard it was.
 * The steps are an estimate: about 55/h is an easy base ride, about 125/h a tempo run.
 */
const LOAD_RATE_RPE = [[45, 2.5], [70, 4], [95, 5], [130, 6], [170, 7.5], [Infinity, 9]];

/**
 * Suggest an RPE (1–10) for an activity.
 * Preference: time in zones → COROS training load per hour → average heart rate
 * against the zones → % of HRmax.
 * Long efforts get a small surcharge. Returns { rpe, basis } or { rpe: null, basis: 'none' }.
 */
export function suggestRpe({ avg_hr, max_hr, duration_min, zones, zoneTimes, hrMax, trainingLoad } = {}) {
  const longBonus = duration_min >= 180 ? 1 : duration_min >= 105 ? 0.5 : 0;
  if (zoneTimes?.length) {
    const total = zoneTimes.reduce((a, b) => a + b, 0);
    if (total > 0) {
      const score = zoneTimes.reduce((a, t, i) => a + t * (ZONE_RPE[Math.min(i, ZONE_RPE.length - 1)]), 0) / total;
      return { rpe: clampRpe(score + longBonus), basis: 'zones' };
    }
  }
  if (trainingLoad > 0 && duration_min > 0) {
    const rate = trainingLoad / (duration_min / 60);
    const base = LOAD_RATE_RPE.find(([limit]) => rate < limit)[1];
    return { rpe: clampRpe(base + longBonus), basis: 'load' };
  }
  if (avg_hr && zones?.length) {
    let idx = zones.findIndex(z => avg_hr >= z.min && (z.max == null || avg_hr < z.max));
    if (idx < 0) idx = avg_hr < zones[0].min ? 0 : zones.length - 1;
    const z = zones[idx];
    const span = z.max != null ? z.max - z.min : 15;
    const within = span > 0 ? Math.min(1, Math.max(0, (avg_hr - z.min) / span)) : 0.5;
    const base = ZONE_RPE[Math.min(idx, ZONE_RPE.length - 1)];
    return { rpe: clampRpe(base - 0.75 + within * 1.5 + longBonus), basis: 'avg_hr_zones' };
  }
  const maxRef = hrMax || null;
  if (avg_hr && maxRef) {
    const p = avg_hr / maxRef;
    const base = p < 0.6 ? 2 : p < 0.7 ? 3.5 : p < 0.8 ? 5 : p < 0.87 ? 6.5 : p < 0.93 ? 8 : 9.5;
    return { rpe: clampRpe(base + longBonus), basis: 'hrmax' };
  }
  return { rpe: null, basis: 'none' };
}

export const RPE_BASIS_LABEL = {
  zones: 'aus Zeit in den HF-Zonen',
  load: 'aus Coros-Trainingsbelastung pro Stunde',
  avg_hr_zones: 'aus Ø-HF und Zonen',
  hrmax: 'aus Ø-HF in % der HFmax',
  none: 'keine Belastungsdaten – bitte selbst einschätzen',
};

export function pace(durationMin, distanceKm) {
  if (!(durationMin > 0) || !(distanceKm > 0)) return null;
  const p = durationMin / distanceKm;
  const m = Math.floor(p), s = Math.round((p - m) * 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}
export const speed = (durationMin, distanceKm) => (durationMin > 0 && distanceKm > 0 ? distanceKm / (durationMin / 60) : null);
