// Opening the right editor for a recorded session or for a new one of a module.
import store from '../store/index.js';
import * as climbing from './climbing.js';
import * as hangboard from './hangboard.js';
import * as strength from './strength.js';
import * as endurance from './endurance.js';
import * as tests from './tests.js';

/** Open the editor of an "actual" from the plan reconciliation ({ col, id }). */
export function openActual(a) {
  if (a.col === 'climb_sessions') return climbing.openById(a.id);
  if (a.col === 'hangboard_sessions') return hangboard.openById(a.id);
  if (a.col === 'strength_sessions') return strength.openById(a.id);
  if (a.col === 'endurance_activities') { const doc = store.get(a.col, a.id); if (doc) return endurance.openEditor(doc); }
  return null;
}

/** Start a new entry for a plan module, pre-filled with `preset` (date, type, duration …). */
export function openNewFor(module, preset = {}) {
  switch (module) {
    case 'climbing': return climbing.openNew(preset);
    case 'hangboard': return hangboard.openNew(preset);
    case 'strength':
    case 'mobility': return strength.openNew(preset);
    case 'run': return endurance.openNew({ ...preset, sport: 'Run' });
    case 'ride': return endurance.openNew({ ...preset, sport: 'Ride' });
    case 'tick': return climbing.openTickEditor(null, preset);
    case 'test': return tests.openNew(preset);
    case 'weight': return tests.openWeightEditor();
    default: return null;
  }
}

/** Choices of the global "+ Einheit" button. */
export const QUICK_ADD = [
  { id: 'climbing', label: 'Klettersession', sub: 'mit Ticks und Projektversuchen', module: 'climbing' },
  { id: 'hangboard', label: 'Hangboard', sub: 'Maximalkraft, Repeater, Klimmzüge', module: 'hangboard' },
  { id: 'strength', label: 'Kraft & Prävention', sub: 'Eigentraining oder Physio', module: 'strength' },
  { id: 'run', label: 'Lauf', sub: 'manuell – sonst über Coros', module: 'run' },
  { id: 'ride', label: 'Radfahrt', sub: 'manuell – sonst über Coros', module: 'ride' },
  { id: 'tick', label: 'Einzelner Tick', sub: 'ohne Session', module: 'climbing' },
  { id: 'test', label: 'Test', sub: 'Max Hang, Max Pull-up …', module: 'hangboard' },
  { id: 'weight', label: 'Körpergewicht', sub: 'für die %-Werte', module: 'other' },
];
