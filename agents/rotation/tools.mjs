import { randomUUID } from 'node:crypto';
import { locationPages } from '../../constants/locationPages.mjs';
import { calculateRotationIntervals, createSchedule } from '../../services/schedule/rotationService.mjs';

const fields = {
  date: { type: 'string', description: 'Confirmed calendar date YYYY-MM-DD.' },
  locationId: { type: 'string' }, shiftId: { type: 'string' },
  names: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 8 },
  duration: { type: 'integer', enum: [15, 20, 30] },
  primaryOnly: { type: 'boolean' },
  availableWholeShift: { type: 'boolean', description: 'True only when the roster is confirmed available for the entire shift.' },
};
const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const toolDefinitions = [
  { type: 'function', name: 'get_rotation_context', description: 'Read supported locations, shifts, timezones and scheduling limits.', parameters: schema({}) },
  { type: 'function', name: 'draft_rotation', description: 'Generate a local draft using the existing scheduler. Requires whole-shift availability. Does not publish.', parameters: schema(fields) },
  { type: 'function', name: 'validate_rotation', description: 'Independently validate a generated draft and report workload counts and warnings.', parameters: schema({ draftId: { type: 'string' } }) },
];
export function getContext() {
  return {
    locations: locationPages.map(p => ({ id: p.id, title: p.title, timezone: p.weatherLocation.timezone, shifts: p.shifts })),
    durations: [15, 20, 30], minimumVolunteers: 2,
    limits: 'One same-day shift; all volunteers available throughout; no qualifications, breaks, fixed pairs, or cross-shift checks. Below six volunteers, only Primary and Informal roles are used.',
  };
}
export function checkRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Request must be an object.');
  if (Object.keys(input).some(k => !Object.hasOwn(fields, k))) throw new Error('Unsupported input fields or constraints.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0, 10) !== input.date) throw new Error('Use a valid date YYYY-MM-DD.');
  const location = locationPages.find(p => p.id === input.locationId);
  const shift = location?.shifts.find(s => s.id === input.shiftId);
  if (!shift) throw new Error('Unknown location or shift; use get_rotation_context.');
  if (![15, 20, 30].includes(input.duration)) throw new Error('Duration must be 15, 20, or 30 minutes.');
  if (typeof input.primaryOnly !== 'boolean') throw new Error('Specify primaryOnly as a boolean.');
  if (input.availableWholeShift !== true) throw new Error('Confirm whole-shift availability before drafting.');
  if (!Array.isArray(input.names) || input.names.length < 2 || input.names.length > shift.slots) throw new Error(`Supply 2–${shift.slots} volunteers.`);
  const names = input.names.map(n => {
    if (typeof n !== 'string' || !n.trim() || n.trim().length > 100 || /[\r\n\x00-\x1f]/.test(n)) throw new Error('Names must be nonempty single-line strings, at most 100 characters.');
    return n.trim();
  });
  if (new Set(names.map(n => n.normalize('NFKC').toLowerCase())).size !== names.length) throw new Error('Duplicate names; use distinct full names or identifiers.');
  return { location, shift, names };
}
export function validateDraft(draft) {
  const { shift, names } = checkRequest(draft.request);
  const periods = calculateRotationIntervals(shift.start, shift.end, draft.request.duration);
  const primaryOnly = draft.request.primaryOnly || names.length < 6;
  const roles = primaryOnly ? ['primary', 'informal'] : ['primary', 'secondary', 'informal'];
  const errors = [], warnings = [];
  const workload = Object.fromEntries(names.map(n => [n, { primary: 0, secondary: 0, informal: 0 }]));
  if (!Array.isArray(draft.rows) || draft.rows.length !== periods.length) errors.push('Incorrect interval count.');
  (Array.isArray(draft.rows) ? draft.rows : []).forEach((row, i) => {
    if (row?.time !== periods[i]) errors.push(`Interval ${i + 1}: incorrect time or order.`);
    const a = row?.assignments ?? {};
    if (Object.keys(a).sort().join() !== [...roles].sort().join() || roles.some(r => !Array.isArray(a[r]))) {
      errors.push(`Interval ${i + 1}: invalid roles.`); return;
    }
    const assigned = roles.flatMap(r => a[r]);
    if (assigned.length !== names.length || new Set(assigned).size !== assigned.length || assigned.some(n => !names.includes(n))) errors.push(`Interval ${i + 1}: missing, duplicate, or unknown volunteer.`);
    if (a.primary.length !== 2 || (!primaryOnly && a.secondary.length !== 2)) errors.push(`Interval ${i + 1}: incomplete pair coverage.`);
    for (const role of roles) for (const name of a[role]) if (Object.hasOwn(workload, name)) workload[name][role]++;
  });
  const counts = Object.values(workload).map(w => w.primary);
  if (Math.max(...counts) - Math.min(...counts) > 1) warnings.push('Primary assignment counts differ by more than one; review fairness.');
  if (names.length < 6 && !draft.request.primaryOnly) warnings.push('Fewer than six volunteers: Secondary is omitted by the existing scheduler.');
  return { valid: errors.length === 0, errors, warnings, workload };
}
export function createToolbox({ savedDrafts = [] } = {}) {
  const drafts = new Map(savedDrafts.map(d => [d.id, structuredClone(d)]));
  const calls = [];
  return {
    drafts, calls,
    execute(name, args = {}) {
      calls.push(name);
      if (name === 'get_rotation_context') return getContext();
      if (name === 'draft_rotation') {
        const { location, shift, names } = checkRequest(args);
        const draft = { id: randomUUID(), status: 'draft', request: { ...args, names }, location: location.title, timezone: location.weatherLocation.timezone,
          rows: createSchedule(names, shift, args.duration, { primaryOnly: args.primaryOnly }) };
        drafts.set(draft.id, structuredClone(draft));
        return draft;
      }
      if (name === 'validate_rotation') {
        const draft = drafts.get(args.draftId);
        if (!draft) throw new Error('Unknown draft ID in this run.');
        const validation = validateDraft(draft);
        draft.validation = validation;
        return { draftId: draft.id, ...validation };
      }
      throw new Error('Unknown scheduling tool.');
    },
  };
}
