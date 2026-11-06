/* Shared app state + mutation helpers. */
import { addDays, dayFromEntries, todayStr, guessMeal, DAY_NAV_LIMIT } from './util.js';

export const state = {
  health: null,
  user: '',
  key: '',
  profile: null,
  date: todayStr(),
  entries: [],
  dayData: null,
  history: [],
  meal: guessMeal(),
  editId: null,
  busy: false,
  meterBusy: false,
};

export function minDate() {
  return addDays(todayStr(), -DAY_NAV_LIMIT);
}

/** Replaces the selected day's data and mirrors it into history immediately. */
export function applyDay(day, { sync = true } = {}) {
  state.dayData = day;
  state.entries = day.entries || [];
  state.date = day.date || state.date;
  if (sync) {
    state.history = state.history.filter((entry) => entry.date !== state.date).concat(state.entries);
  }
}

export function recomputeDay() {
  const day = dayFromEntries(state.date, state.entries);
  state.dayData = day;
  state.history = state.history.filter((entry) => entry.date !== state.date).concat(state.entries);
  return day;
}

export function resetForUser() {
  state.user = '';
  state.key = '';
  state.profile = null;
  state.entries = [];
  state.dayData = null;
  state.history = [];
  state.date = todayStr();
  state.meal = guessMeal();
}
