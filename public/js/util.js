/* Shared constants, date/format helpers, and calorie math. */

export const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
export const MEAL_EMOJI = { Breakfast: '🥣', Lunch: '🥗', Dinner: '🍽️', Snacks: '🍊' };
export const MEAL_COLORS = { Breakfast: '#fcd34d', Lunch: '#fb923c', Dinner: '#ea580c', Snacks: '#b45309' };
export const BUBBLE_CAL = 50;
export const LAST_USER_KEY = 'zest.lastUser';
export const DAY_NAV_LIMIT = 365;

export const MACROS = [
  { key: 'protein', label: 'Protein', short: 'P', color: '#ea580c', kcalPerGram: 4 },
  { key: 'fat', label: 'Fat', short: 'F', color: '#f59e0b', kcalPerGram: 9 },
  { key: 'carbs', label: 'Carbs', short: 'C', color: '#0ea5e9', kcalPerGram: 4 },
];

export const QUICK_FOODS = [
  { name: 'Banana', calories: 105, emoji: '🍌' },
  { name: '2 eggs', calories: 140, emoji: '🥚' },
  { name: 'Greek yogurt', calories: 120, emoji: '🥛' },
  { name: 'Chicken breast', calories: 280, emoji: '🍗' },
  { name: 'Coffee + milk', calories: 40, emoji: '☕' },
  { name: 'Apple', calories: 95, emoji: '🍎' },
  { name: 'Avocado toast', calories: 320, emoji: '🥑' },
  { name: 'Protein shake', calories: 160, emoji: '🥤' },
  { name: 'Rice bowl', calories: 420, emoji: '🍚' },
  { name: 'Pizza slice', calories: 285, emoji: '🍕' },
  { name: 'Big salad', calories: 180, emoji: '🥗' },
  { name: 'Oatmeal', calories: 190, emoji: '🥣' },
];

const numberFormat = new Intl.NumberFormat('en-US');

export const fmt = (value) => numberFormat.format(Math.round(Number(value) || 0));
export const fmt1 = (value) => (Math.round((Number(value) || 0) * 10) / 10).toFixed(1);
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Macro grams, or null when the food's macros are unknown. */
export function macroValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function hasMacroData(entry) {
  return MACROS.some((macro) => macroValue(entry?.[macro.key]) !== null);
}

export function macroGrams(value) {
  const n = Math.max(0, Number(value) || 0);
  if (n === 0) return '0';
  return n < 10 ? String(Math.round(n * 10) / 10) : fmt(n);
}

/** Sums the macro grams and macro-derived calories of a list of entries. */
export function macroTotals(entries = []) {
  const totals = { protein: 0, fat: 0, carbs: 0 };
  const macroCounts = { protein: 0, fat: 0, carbs: 0 };
  let macroTracked = 0;
  for (const entry of entries) {
    let tracked = false;
    for (const macro of MACROS) {
      const value = macroValue(entry?.[macro.key]);
      if (value === null) continue;
      totals[macro.key] += value;
      macroCounts[macro.key] += 1;
      tracked = true;
    }
    if (tracked) macroTracked += 1;
  }
  for (const key of Object.keys(totals)) totals[key] = Math.round(totals[key] * 10) / 10;
  const macroCalories = Math.round(
    totals.protein * 4 + totals.fat * 9 + totals.carbs * 4,
  );
  return { ...totals, macroTracked, macroCounts, macroCalories };
}

/** Short "P 12g · F 3g · C 20g" line, skipping nutrients a food did not report. */
export function macroSummary(entry) {
  return MACROS
    .map((macro) => {
      const value = macroValue(entry?.[macro.key]);
      return value === null ? null : `${macro.short} ${macroGrams(value)}g`;
    })
    .filter(Boolean)
    .join(' · ');
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

/* ---------- Dates (all local, keyed as YYYY-MM-DD) ---------- */

export function toDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const todayStr = () => toDateString(new Date());

export function strToDate(value) {
  const [y, m, d] = String(value).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function addDays(value, days) {
  const date = strToDate(value);
  date.setDate(date.getDate() + days);
  return toDateString(date);
}

/** Days from a to b (b − a). */
export function diffDays(a, b) {
  return Math.round((strToDate(b).getTime() - strToDate(a).getTime()) / 86_400_000);
}

export function shortDate(value) {
  return strToDate(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function weekday(value) {
  return strToDate(value).toLocaleDateString('en-US', { weekday: 'long' });
}

export function weekdayShort(value) {
  return strToDate(value).toLocaleDateString('en-US', { weekday: 'short' });
}

export function longDate(value) {
  return strToDate(value).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function fullDate(value) {
  return strToDate(value).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function relativeLabel(value) {
  const today = todayStr();
  if (value === today) return 'Today';
  if (value === addDays(today, -1)) return 'Yesterday';
  if (value === addDays(today, 1)) return 'Tomorrow';
  return weekdayShort(value) + ', ' + shortDate(value);
}

export function formatTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function greetingForHour(hour = new Date().getHours()) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function guessMeal(hour = new Date().getHours()) {
  if (hour < 10) return 'Breakfast';
  if (hour < 15) return 'Lunch';
  if (hour < 21) return 'Dinner';
  return 'Snacks';
}

/* ---------- Day math ---------- */

export function dayFromEntries(date, entries) {
  const sorted = [...entries].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const total = sorted.reduce((sum, entry) => sum + (Number(entry.calories) || 0), 0);
  const bubble = sorted.find((entry) => entry.source === 'bubble') || null;
  return {
    date,
    entries: sorted,
    total,
    foodTotal: total - (bubble ? Number(bubble.calories) || 0 : 0),
    bubbleEntry: bubble,
    ...macroTotals(sorted),
  };
}

export function totalsByDate(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (!map.has(entry.date)) {
      map.set(entry.date, {
        total: 0,
        count: 0,
        meals: { Breakfast: 0, Lunch: 0, Dinner: 0, Snacks: 0 },
        macros: { protein: 0, fat: 0, carbs: 0 },
        macroTracked: 0,
      });
    }
    const day = map.get(entry.date);
    const calories = Number(entry.calories) || 0;
    day.total += calories;
    day.count += 1;
    if (day.meals[entry.meal] !== undefined) day.meals[entry.meal] += calories;
    let tracked = false;
    for (const macro of MACROS) {
      const value = macroValue(entry?.[macro.key]);
      if (value === null) continue;
      day.macros[macro.key] += value;
      tracked = true;
    }
    if (tracked) day.macroTracked += 1;
  }
  for (const day of map.values()) {
    for (const key of Object.keys(day.macros)) {
      day.macros[key] = Math.round(day.macros[key] * 10) / 10;
    }
    day.macroCalories = Math.round(
      day.macros.protein * 4 + day.macros.fat * 9 + day.macros.carbs * 4,
    );
  }
  return map;
}

export function historyFrom(date) {
  const today = todayStr();
  const earliest = addDays(date, -34);
  const floor = addDays(today, -400);
  if (earliest < floor) return floor;
  return earliest;
}

/* ---------- Energy math ---------- */

/**
 * Mifflin–St Jeor BMR, sedentary base (1.2), plus running at MET 8.3.
 * Returns kcal/day estimates.
 */
export function energyFor(profile) {
  if (!profile) return { bmr: 0, tdee: 0, runPerDay: 0, runPerWeek: 0 };
  const kg = (Number(profile.currentWeight) || 210) * 0.45359237;
  const cm = (Number(profile.heightIn) || 71) * 2.54;
  const age = Number(profile.age) || 30;
  const sexAdjust = profile.sex === 'female' ? -161 : 5;
  const bmr = 10 * kg + 6.25 * cm - 5 * age + sexAdjust;
  const runPerWeek = ((Number(profile.runMinWeek) || 0) * 3.5 * 8.3 * kg) / 200;
  const tdee = bmr * 1.2 + runPerWeek / 7;
  return { bmr, tdee, runPerDay: runPerWeek / 7, runPerWeek };
}

/** Average intake over logged days in [from, to]. */
export function averageIntake(entries, from, to, { exclude = [] } = {}) {
  const totals = totalsByDate(entries);
  const values = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
    if (exclude.includes(cursor)) continue;
    const total = totals.get(cursor)?.total || 0;
    if (total > 0) values.push(total);
  }
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function projectionFor(profile, entries) {
  const energy = energyFor(profile);
  const today = todayStr();
  const goal = Number(profile?.dailyGoal) || 2000;
  // Only completed days count toward the projection; a half-logged today
  // should not estimate a 12 lb loss before lunch.
  const recent = averageIntake(entries, addDays(today, -7), addDays(today, -1));
  const intake = recent ?? goal;
  const daysLeft = Math.max(0, diffDays(today, profile?.targetDate || today));
  const dailyDeficit = energy.tdee - intake;
  const projectedLoss = (dailyDeficit * daysLeft) / 3500;
  const neededLoss = Math.max(0, (Number(profile?.currentWeight) || 0) - (Number(profile?.goalWeight) || 0));
  const requiredIntake = daysLeft > 0 ? energy.tdee - (neededLoss * 3500) / daysLeft : null;
  return {
    energy,
    intake,
    usingAverage: recent !== null,
    daysLeft,
    dailyDeficit,
    projectedLoss,
    neededLoss,
    requiredIntake,
    perWeek: (dailyDeficit * 7) / 3500,
  };
}

export function compact(value) {
  const n = Math.round(Number(value) || 0);
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(n);
}

export function topFood(entries, { since = null, limit = 30 } = {}) {
  const map = new Map();
  for (const entry of entries) {
    if (entry.source === 'bubble') continue;
    if (since && entry.date < since) continue;
    const key = entry.name.trim().toLowerCase();
    if (!key) continue;
    if (!map.has(key)) map.set(key, { name: entry.name.trim(), count: 0, calories: 0 });
    const item = map.get(key);
    item.count += 1;
    item.calories += Number(entry.calories) || 0;
  }
  const items = [...map.values()].sort((a, b) => b.count - a.count || b.calories - a.calories);
  return items.slice(0, limit);
}
