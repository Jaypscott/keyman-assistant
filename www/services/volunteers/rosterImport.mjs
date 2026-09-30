import { parseRosterObservations, normalizePhoneNumber, createVolunteerContact } from './rosterService.mjs';
export const MAX_ROSTER = 8;
export function validateReviewedRoster(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_ROSTER) throw new Error('Select between 1 and 8 volunteers.');
  const seen = new Set();
  return raw.map(c => {
    if (!c || typeof c.name !== 'string' || !c.name.trim() || c.name.trim().length > 100 || /\d{3}/.test(c.name)) throw new Error('Give every selected volunteer a valid name without a phone number.');
    const name = c.name.trim(); const key = name.toLocaleLowerCase();
    if (seen.has(key)) throw new Error('Each volunteer needs a unique name. Edit duplicate names before continuing.');
    seen.add(key);
    if (typeof c.phone !== 'string' || c.phone.length > 40 || (c.phone.trim() && !normalizePhoneNumber(c.phone))) throw new Error('Correct the phone number or leave it blank.');
    return createVolunteerContact({ name, phone: c.phone });
  });
}
export async function scanRosterImage(file, { plugin, signal, FileReaderClass = globalThis.FileReader, readTimeout = 20000, scanTimeout = 45000 } = {}) {
  if (!plugin?.recognizeRosterImage) throw new Error('Roster image import is available in the installed iPhone app.');
  if (!file || (file.type && !file.type.startsWith('image/'))) throw new Error('Choose an image file to import a roster.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.');
  const cancelled = () => new Error('Roster image import cancelled.');
  const bounded = (promise, ms, message) => new Promise((resolve,reject) => {
    const finish = (fn,value) => { clearTimeout(timer); signal?.removeEventListener('abort',abort); fn(value); };
    const abort = () => finish(reject,cancelled());
    const timer = setTimeout(() => finish(reject,new Error(message)), ms);
    signal?.addEventListener('abort', abort, { once:true });
    if (signal?.aborted) abort();
    promise.then(value=>finish(resolve,value),error=>finish(reject,error));
  });
  let reader, started = false;
  try {
    if (signal?.aborted) throw cancelled();
    const dataUrl = await bounded(new Promise((resolve,reject) => {
      reader = new FileReaderClass();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('The selected image could not be read.'));
      reader.onabort = () => reject(cancelled()); reader.readAsDataURL(file);
    }), readTimeout, 'The selected image took too long to open. Please choose it again.');
    if (signal?.aborted) throw cancelled();
    started = true;
    const result = await bounded(plugin.recognizeRosterImage({ dataUrl }), scanTimeout, 'Text recognition took too long. Please try the image again.');
    if (result?.cancelled || signal?.aborted) throw cancelled();
    const contacts = parseRosterObservations(result?.observations || []);
    if (!contacts.length) throw new Error('No volunteer names or phone numbers were recognized. Try a clearer image.');
    return contacts;
  } catch (error) {
    if (reader?.readyState === 1) reader.abort();
    if (started) { try { await plugin.cancelRosterImport?.(); } catch {} }
    throw error;
  }
}
