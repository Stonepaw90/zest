import crypto from 'node:crypto';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  return toDateString(d) === value;
}

export function toDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(value, days) {
  const d = new Date(`${value}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

export function todayString() {
  return toDateString(new Date());
}

export function uid() {
  return crypto.randomUUID();
}

/**
 * Normalizes a typed username into a stable, case-insensitive key.
 * Returns { key, display } or throws Error with a friendly message.
 */
export function normalizeUser(raw) {
  if (typeof raw !== 'string') throw new Error('Please choose a username.');
  const display = raw.trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!display) throw new Error('Please choose a username.');
  if (display.length < 2) throw new Error('Usernames need at least 2 characters.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$/.test(display)) {
    throw new Error('Use letters, numbers, spaces, dots, dashes or underscores.');
  }
  return { key: display.toLowerCase(), display };
}

export function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
