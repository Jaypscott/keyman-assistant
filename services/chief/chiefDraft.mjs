import { locationPages } from '../../constants/locationPages.mjs';
import { calculateRotationIntervals } from '../schedule/rotationService.mjs';
export function chiefDraftState(draft, contacts = []) {
  if (!draft?.validation?.valid) throw new Error('This draft has not passed validation.');
  const request = draft.request;
  if (Array.isArray(draft.volunteerContacts)) contacts = draft.volunteerContacts;
  const location = locationPages.find(l => l.id === request.locationId);
  const shift = location?.shifts.find(s => s.id === request.shiftId);
  if (!shift) throw new Error('This draft uses an unavailable shift.');
  validateChiefSchedule(draft.rows, request.names, shift, request.duration, request.primaryOnly);
  return { tab:'home', selectedLocation:location, selectedShift:shift, selectedDate:request.date,
    selectedRotationDuration:request.duration, primaryOnly:request.primaryOnly, rotationOrigin:'chief', rotationView:'review', scheduleEditing:false,
    volunteerContacts:request.names.map(name => ({ name, phone:contacts.find(c => c.name === name)?.phone || '' })),
    schedule:structuredClone(draft.rows), message:'' };
}
export function validateChiefSchedule(rows, names, shift, duration, primaryOnly) {
  const times = calculateRotationIntervals(shift.start, shift.end, duration);
  const roles = primaryOnly || names.length < 6 ? ['primary','informal'] : ['primary','secondary','informal'];
  if (!times.length || !Array.isArray(rows) || rows.length !== times.length) throw new Error('The schedule does not cover the full shift.');
  if (new Set(names).size !== names.length || names.length < 2 || names.length > shift.slots) throw new Error('Check the volunteer roster.');
  for (const [i,row] of rows.entries()) {
    const a = row.assignments;
    if (row.time !== times[i] || !a || Object.keys(a).sort().join() !== [...roles].sort().join() || roles.some(r => !Array.isArray(a[r]))) throw new Error('The schedule has an invalid interval.');
    const assigned = roles.flatMap(r => a[r]);
    if (assigned.length !== names.length || new Set(assigned).size !== assigned.length || assigned.some(n => !names.includes(n)) || a.primary.length !== 2 || (roles.includes('secondary') && a.secondary.length !== 2)) throw new Error('Each volunteer must have exactly one assignment per interval. Please correct the schedule.');
  }
}
