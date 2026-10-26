// Event mode: a device-local "I am at this event right now" marker so hallway
// capture defaults met-at without retyping it for every contact. localStorage
// is deliberate here (a per-device capture convenience, not account state),
// and the marker self-expires so last week's conference never silently stamps
// this week's contacts.

const KEY = 'node.currentEvent';
const MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;

export interface CurrentEvent {
  name: string;
  setAt: string;
}

export function getCurrentEvent(): CurrentEvent | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CurrentEvent;
    if (!parsed?.name || !parsed?.setAt) return null;
    if (Date.now() - new Date(parsed.setAt).getTime() > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setCurrentEvent(name: string): CurrentEvent | null {
  const trimmed = name.trim().slice(0, 120);
  if (!trimmed) return null;
  const event: CurrentEvent = { name: trimmed, setAt: new Date().toISOString() };
  try {
    localStorage.setItem(KEY, JSON.stringify(event));
  } catch {
    // Storage unavailable (private mode): event mode still works via state
    // for this page view, it just will not survive a reload.
  }
  return event;
}

export function clearCurrentEvent(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
