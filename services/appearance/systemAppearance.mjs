// Appearance updates only change surfaces. They must never render app content:
// password fields, note drafts, selection, and timers belong to their own flows.
export function watchSystemAppearance(onChange, { window, document }) {
  const preference = window.matchMedia('(prefers-color-scheme: dark)');
  const refresh = () => onChange();
  const resume = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  preference.addEventListener('change', refresh);
  document.addEventListener('visibilitychange', resume);
  refresh();
  return () => {
    preference.removeEventListener('change', refresh);
    document.removeEventListener('visibilitychange', resume);
  };
}
