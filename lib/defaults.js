import { addDays, todayString } from './utils.js';

export const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
export const BUBBLE_NAME = '⚡ Bubble top-up';

/**
 * Defaults are seeded from the brief: 210 lb, 5'11" man, 2,000 kcal/day,
 * aiming to drop 10 lb over roughly two months, running 2 h/week.
 * Everything is editable per user in Settings.
 */
export function defaultProfile(username, key) {
  const today = todayString();
  return {
    username,
    key,
    age: 30,
    sex: 'male',
    heightIn: 71,
    startWeight: 210,
    currentWeight: 210,
    goalWeight: 200,
    dailyGoal: 2000,
    runMinWeek: 120,
    targetDate: addDays(today, 60),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function sanitizeProfile(input, existing) {
  const base = existing || defaultProfile(input.username || 'friend', input.key || 'friend');
  const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const heightIn = Math.min(96, Math.max(48, num(input.heightIn, base.heightIn)));
  const startWeight = Math.min(500, Math.max(70, num(input.startWeight, base.startWeight)));
  const goalWeight = Math.min(500, Math.max(70, num(input.goalWeight, base.goalWeight)));
  return {
    ...base,
    age: Math.min(100, Math.max(13, Math.round(num(input.age, base.age)))),
    sex: input.sex === 'female' ? 'female' : 'male',
    heightIn: Math.round(heightIn * 2) / 2,
    startWeight: Math.round(startWeight * 10) / 10,
    currentWeight: Math.min(
      500,
      Math.max(70, Math.round(num(input.currentWeight, base.currentWeight) * 10) / 10),
    ),
    goalWeight: Math.round(goalWeight * 10) / 10,
    dailyGoal: Math.min(6000, Math.max(800, Math.round(num(input.dailyGoal, base.dailyGoal) / 50) * 50)),
    runMinWeek: Math.min(1500, Math.max(0, Math.round(num(input.runMinWeek, base.runMinWeek)))),
    targetDate: /^\d{4}-\d{2}-\d{2}$/.test(input.targetDate || '')
      ? input.targetDate
      : base.targetDate,
    updatedAt: new Date().toISOString(),
  };
}
