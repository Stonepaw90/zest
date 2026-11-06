/* All DOM rendering. Rebuilt from state after each change. */
import { barChartMarkup, donutMarkup, macroChartMarkup } from './charts.js';
import { state } from './state.js';
import {
  addDays,
  BUBBLE_CAL,
  clamp,
  diffDays,
  energyFor,
  escapeHtml,
  fmt,
  fmt1,
  formatTime,
  fullDate,
  greetingForHour,
  MACROS,
  macroGrams,
  macroSummary,
  macroTotals,
  MEALS,
  MEAL_COLORS,
  MEAL_EMOJI,
  projectionFor,
  QUICK_FOODS,
  shortDate,
  todayStr,
  topFood,
  totalsByDate,
  weekday,
  weekdayShort,
} from './util.js';

const $ = (selector, root = document) => root.querySelector(selector);

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function setHtml(selector, value) {
  const node = $(selector);
  if (node) node.innerHTML = value;
}

export function renderAll() {
  renderHeader();
  renderMeter();
  renderSide();
  renderFood();
  renderAnalytics();
  renderStorage();
  renderMealButtons();
}

export function renderHeader() {
  const profile = state.profile;
  if (!profile) return;
  const today = todayStr();
  const isToday = state.date === today;
  const isYesterday = state.date === addDays(today, -1);
  const initials = (profile.username || '?').trim().charAt(0).toUpperCase() || '?';

  setText('#user-name', profile.username);
  setText('#user-avatar', initials);
  setText('#menu-name', profile.username);
  setText('#menu-avatar', initials);
  setText('#settings-username', profile.username);
  setText('#settings-avatar', initials);

  setText(
    '#date-label',
    isToday ? 'Today' : isYesterday ? 'Yesterday' : `${weekdayShort(state.date)}, ${shortDate(state.date)}`,
  );
  setText(
    '#date-sub',
    isToday || isYesterday ? `${weekday(state.date)}, ${shortDate(state.date)}` : fullDate(state.date).split(',').pop().trim(),
  );

  const nextButton = $('#next-day');
  if (nextButton) nextButton.disabled = state.date >= today;
  const todayButton = $('#today-btn');
  if (todayButton) todayButton.classList.toggle('is-hidden', isToday);

  const dateInput = $('#date-input');
  if (dateInput) {
    dateInput.value = state.date;
    dateInput.max = today;
    dateInput.min = addDays(today, -365);
  }

  const greeting = isToday ? `${greetingForHour()}, ${profile.username}` : `Editing ${weekday(state.date)}`;
  setText('#day-greeting', greeting);
  setText(
    '#meter-title',
    isToday ? "Today's fuel" : isYesterday ? "Yesterday's fuel" : `${weekday(state.date)}'s fuel`,
  );

  const total = state.dayData?.total || 0;
  document.title = `${fmt(total)} kcal · Zest`;
}

export function renderMeter() {
  const profile = state.profile;
  if (!profile) return;
  const goal = Math.max(BUBBLE_CAL, Math.round((Number(profile.dailyGoal) || 2000) / BUBBLE_CAL) * BUBBLE_CAL);
  const total = state.dayData?.total || 0;
  const goalDots = Math.max(1, Math.round(goal / BUBBLE_CAL));
  const over = total > goal;
  const remaining = goal - total;
  const percent = goal > 0 ? (total / goal) * 100 : 0;

  const card = $('#meter-card');
  if (card) card.classList.toggle('over', over);

  setText('#consumed', fmt(total));
  setText('#goal-num', fmt(goal));
  setText(
    '#bubble-count',
    `${Math.min(goalDots, Math.floor(total / BUBBLE_CAL))} of ${goalDots} bubbles`,
  );

  const statusPill = $('#status-pill');
  if (statusPill) {
    let className = 'pill';
    let label = 'On track';
    if (over) {
      className += ' over';
      label = 'Over budget';
    } else if (total === 0) {
      className += ' empty';
      label = 'Fresh start';
    } else if (total >= goal * 0.9) {
      className += ' good';
      label = total >= goal ? 'Right on target' : 'Nearly there';
    } else {
      className += ' good';
      label = 'On track';
    }
    statusPill.className = className;
    setText('#status-text', label);
  }

  // Three rows of bubbles.
  const rows = [];
  const perRow = Math.ceil(goalDots / 3);
  for (let row = 0; row < 3; row += 1) {
    const start = row * perRow;
    const end = Math.min(goalDots, start + perRow);
    if (start >= end) continue;
    const dots = [];
    for (let index = start; index < end; index += 1) {
      const target = (index + 1) * BUBBLE_CAL;
      const fill = clamp(((total - index * BUBBLE_CAL) / BUBBLE_CAL) * 100, 0, 100);
      const filled = fill >= 100;
      const partial = fill > 0 && fill < 100;
      dots.push(
        `<button type="button" class="bubble${filled ? ' is-full' : ''}${partial ? ' partial' : ''}" data-cal="${target}" style="--fill:${fill.toFixed(2)}%" aria-label="Set ${fmt(target)} calories" aria-pressed="${filled}" title="${fmt(target)} cal">
          <span class="dot-fill"></span>
        </button>`,
      );
    }
    rows.push(`<div class="bubble-row">${dots.join('')}</div>`);
  }
  setHtml('#bubble-meter', rows.join(''));

  const overChip = $('#over-chip');
  if (overChip) {
    overChip.classList.toggle('is-hidden', !over);
    if (over) overChip.textContent = `+${fmt(total - goal)} over`;
  }

  const overflow = $('#overflow-row');
  if (overflow) {
    overflow.classList.toggle('is-hidden', !over);
    if (over) {
      const overflowCount = Math.ceil((total - goal) / BUBBLE_CAL);
      const dots = Array.from({ length: Math.min(14, overflowCount) }, () => '<i></i>').join('');
      setHtml('#overflow-dots', dots);
      setText(
        '#overflow-text',
        `${fmt(total - goal)} cal past your ${fmt(goal)} goal${overflowCount > 14 ? ` · +${overflowCount - 14} more` : ''}`,
      );
    }
  }

  // Plate breakdown — meals plus a separate line for quick bubble taps.
  const mealTotals = { Breakfast: 0, Lunch: 0, Dinner: 0, Snacks: 0 };
  let quickTotal = 0;
  for (const entry of state.entries) {
    const calories = Number(entry.calories) || 0;
    if (entry.source === 'bubble') quickTotal += calories;
    else if (mealTotals[entry.meal] !== undefined) mealTotals[entry.meal] += calories;
  }
  const shareOf = (value) => (total > 0 ? (value / total) * 100 : 0);
  const quickRow = quickTotal > 0
    ? `<div class="plate-row is-quick" title="Calories logged by tapping bubbles">
        <span class="plate-name">⚡ Quick taps</span>
        <span class="plate-track"><i style="width:${shareOf(quickTotal).toFixed(1)}%;background:#0ea5e9"></i></span>
        <strong>${fmt(quickTotal)}</strong>
      </div>`
    : '';
  setHtml(
    '#meal-snapshot',
    `<div class="plate-head"><span>${state.date === todayStr() ? "Today's plate" : 'That day\u2019s plate'}</span><span>${fmt(total)} kcal</span></div>
    ${MEALS.map((meal) => {
      const value = mealTotals[meal] || 0;
      return `<button type="button" class="plate-row${value ? '' : ' is-empty'}" data-snap-meal="${meal}" title="Add to ${meal}">
        <span class="plate-name">${MEAL_EMOJI[meal]} ${meal}</span>
        <span class="plate-track"><i style="width:${shareOf(value).toFixed(1)}%;background:${MEAL_COLORS[meal]}"></i></span>
        <strong>${fmt(value)}</strong>
      </button>`;
    }).join('')}${quickRow}`,
  );

  let message;
  if (total === 0) {
    message = "Tap the bubble for the calories you've eaten so far — or log a meal below.";
  } else if (over) {
    message = `${fmt(total - goal)} over. No drama — a walk and a lighter tomorrow fix most things.`;
  } else if (total === goal) {
    message = 'Perfect landing — right on target. 🎯';
  } else if (remaining <= 200) {
    message = `${fmt(remaining)} cal left. Tight finish — make it count.`;
  } else if (remaining <= goal * 0.35) {
    message = `${fmt(remaining)} cal left. Choose your next bite wisely.`;
  } else {
    message = `${fmt(remaining)} cal left. Plenty of room for something good.`;
  }
  setText('#meter-message', message);

  // Little pulse on the newly filled bubbles.
  if (over && card) {
    card.dataset.over = 'true';
  } else if (card) {
    delete card.dataset.over;
  }

  setText('#food-total', fmt(total));
  document.title = `${fmt(total)} kcal · Zest`;
}

export function renderSide() {
  const profile = state.profile;
  if (!profile) return;
  const goal = Math.max(50, Number(profile.dailyGoal) || 2000);
  const total = state.dayData?.total || 0;
  const remaining = goal - total;
  const over = total > goal;
  const percent = clamp((total / goal) * 100, 0, 100);
  const energy = energyFor(profile);

  setText('#tank-percent', `${Math.round((total / goal) * 100)}% used`);
  const tankNumber = $('#tank-number');
  if (tankNumber) {
    tankNumber.textContent = over ? `+${fmt(total - goal)}` : fmt(remaining);
    tankNumber.classList.toggle('over', over);
  }
  setText('#tank-sub', over ? 'over your daily goal' : 'calories to play with');
  const tankFill = $('#tank-fill');
  if (tankFill) {
    tankFill.style.width = `${percent.toFixed(1)}%`;
    tankFill.classList.toggle('over', over);
  }
  setText('#tdee', fmt(energy.tdee));

  const net = total - energy.tdee;
  const netNode = $('#net');
  if (netNode) {
    netNode.textContent = net < 0 ? `−${fmt(Math.abs(net))}` : `+${fmt(net)}`;
    netNode.className = net < 0 ? 'deficit' : 'surplus';
  }

  // Journey
  const projection = projectionFor(profile, state.history);
  const start = Number(profile.startWeight) || 210;
  const current = Number(profile.currentWeight) || 210;
  const goalWeight = Number(profile.goalWeight) || 200;
  const toGo = Math.max(0, current - goalWeight);
  const progress = start > goalWeight ? clamp(((start - current) / (start - goalWeight)) * 100, 0, 100) : (current <= goalWeight ? 100 : 0);
  const daysLeft = Math.max(0, diffDays(todayStr(), profile.targetDate || todayStr()));

  setText('#journey-goal', fmt(goalWeight));
  setText('#weight-now', fmt1(current));
  setText('#weight-goal', `${fmt(goalWeight)} lb`);
  setText('#weight-to-go', toGo <= 0.05 ? 'Goal reached 🎉' : `${fmt1(toGo)} lb to go`);
  setText('#days-left', daysLeft === 0 ? 'target date passed' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`);
  const journeyFill = $('#journey-fill');
  if (journeyFill) journeyFill.style.width = `${progress.toFixed(1)}%`;
  setText(
    '#pace-note',
    projection.perWeek === 0
      ? 'at goal pace'
      : `${fmt1(Math.abs(projection.perWeek))} lb/wk ${projection.perWeek > 0 ? 'down' : 'up'}`,
  );

  renderMacroCard();
}

export function renderMacroCard() {
  const totals = macroTotals(state.entries);
  const hasData = totals.macroTracked > 0;
  const foodEntries = state.entries.filter((entry) => entry.source !== 'bubble').length;
  const dayTotal = Number(state.dayData?.total) || 0;
  const macroShare = dayTotal > 0
    ? Math.min(100, Math.round((totals.macroCalories / dayTotal) * 100))
    : 0;
  const maxGrams = Math.max(totals.protein, totals.fat, totals.carbs, 1);

  setHtml(
    '#macro-rows',
    MACROS.map((macro) => {
      const grams = totals[macro.key];
      const tracked = (totals.macroCounts?.[macro.key] || 0) > 0;
      const width = tracked ? (grams / maxGrams) * 100 : 0;
      return `<div class="macro-row">
        <span class="macro-dot" style="background:${macro.color}"></span>
        <span class="macro-name">${macro.label}</span>
        <span class="macro-bar"><i style="width:${width.toFixed(1)}%;background:${macro.color}"></i></span>
        <span class="macro-grams">${tracked ? `${macroGrams(grams)}<small>g</small>` : '—'}</span>
      </div>`;
    }).join(''),
  );

  setText(
    '#macro-sub',
    hasData
      ? `${totals.macroTracked} of ${foodEntries || totals.macroTracked} food${foodEntries === 1 ? '' : 's'} tracked`
      : 'Not tracked yet',
  );
  setText(
    '#macro-foot',
    hasData
      ? `${fmt(totals.macroCalories)} kcal from macros${dayTotal > 0 ? ` · ${macroShare}% of logged calories` : ''}`
      : 'Pick a food from search to auto-fill protein, fat and carbs.',
  );
}

export function renderFood() {
  const total = state.dayData?.total || 0;
  setText('#food-total', fmt(total));
  const entries = state.entries || [];
  const list = $('#food-list');
  if (!list) return;

  if (!entries.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-dots"><i></i><i></i><i></i><i></i><i></i></div>
      <strong>Clean plate. Let's fix that.</strong>
      <span>Log a bite above, tap a quick food, or tap a bubble on the meter.</span>
    </div>`;
    return;
  }

  const groups = MEALS.map((meal) => ({
    meal,
    label: `${MEAL_EMOJI[meal]} ${meal}`,
    items: entries.filter((entry) => entry.meal === meal && entry.source !== 'bubble'),
  }));
  const quickItems = entries.filter((entry) => entry.source === 'bubble');
  if (quickItems.length) {
    groups.push({ meal: 'Quick', label: '⚡ Quick taps', items: quickItems });
  }

  list.innerHTML = groups.filter((group) => group.items.length).map((group) => {
    const subtotal = group.items.reduce((sum, entry) => sum + (Number(entry.calories) || 0), 0);
    const items = group.items.map((entry) => {
      const isBubble = entry.source === 'bubble';
      const name = isBubble ? entry.name.replace(/^⚡\s*/, '') : entry.name;
      const icon = isBubble
        ? '<span class="food-icon bubble-icon"><svg><use href="#i-bolt"></use></svg></span>'
        : `<span class="food-icon">${MEAL_EMOJI[entry.meal] || '🍽️'}</span>`;
      const sourceTag = isBubble
        ? '<span class="source-tag"><svg><use href="#i-bolt"></use></svg>tap</span>'
        : '';
      const macros = isBubble ? '' : macroSummary(entry);
      const macroLine = macros
        ? `<span class="food-macros">${escapeHtml(macros)}</span>`
        : '';
      return `<div class="food-item" data-id="${escapeHtml(entry.id)}">
        ${icon}
        <div class="food-main">
          <div class="food-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="food-meta"><span>${formatTime(entry.createdAt)}</span>${macroLine}${sourceTag}</div>
        </div>
        <div class="food-cal">${fmt(entry.calories)}<small>cal</small></div>
        <div class="food-actions">
          <button type="button" class="icon-btn" data-edit="${escapeHtml(entry.id)}" aria-label="Edit ${escapeHtml(name)}"><svg><use href="#i-pencil"></use></svg></button>
          <button type="button" class="icon-btn del" data-delete="${escapeHtml(entry.id)}" aria-label="Delete ${escapeHtml(name)}"><svg><use href="#i-trash"></use></svg></button>
        </div>
      </div>`;
    }).join('');
    return `<div class="meal-group">
      <div class="meal-group-head">
        <h4>${group.label}</h4>
        <span class="meal-total">${fmt(subtotal)} cal</span>
      </div>
      ${items}
    </div>`;
  }).join('');
}

export function renderAnalytics() {
  const profile = state.profile;
  if (!profile) return;
  const goal = Number(profile.dailyGoal) || 2000;
  const today = todayStr();
  const totals = totalsByDate(state.history);
  const selectedDate = state.date;

  const daysBack = (count) => Array.from({ length: count }, (_, index) => {
    const date = addDays(selectedDate, -(count - 1 - index));
    const day = totals.get(date);
    return {
      date,
      total: day?.total || 0,
      count: day?.count || 0,
      meals: day?.meals || {},
      macros: day?.macros || { protein: 0, fat: 0, carbs: 0 },
      macroTracked: day?.macroTracked || 0,
      macroCalories: day?.macroCalories || 0,
    };
  });

  const last14 = daysBack(14);
  const last7 = last14.slice(-7);
  const logged7 = last7.filter((day) => day.total > 0);
  const average = logged7.length
    ? logged7.reduce((sum, day) => sum + day.total, 0) / logged7.length
    : null;
  const onTarget7 = logged7.filter((day) => day.total <= goal).length;

  // Streak: consecutive logged days at/under goal, forgiving an empty today.
  let streak = 0;
  let cursor = selectedDate;
  if ((totals.get(cursor)?.total || 0) === 0) cursor = addDays(cursor, -1);
  for (let i = 0; i < 366; i += 1) {
    const day = totals.get(cursor);
    if (!day || day.total <= 0 || day.total > goal) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  const favourites = topFood(state.history, { since: addDays(today, -30) });
  const favourite = favourites[0] || null;

  const statGrid = $('#stat-grid');
  if (statGrid) {
    const diff = average === null ? null : average - goal;
    const miniDays = last7.map((day) => {
      const cls = day.total === 0 ? '' : day.total > goal ? 'over' : 'on';
      return `<i class="${cls}" title="${shortDate(day.date)} — ${fmt(day.total)} cal"></i>`;
    }).join('');

    statGrid.innerHTML = `
      <article class="stat-card" style="animation-delay:0ms">
        <div class="stat-top"><span class="stat-label">7-day average</span><span class="stat-emoji">📊</span></div>
        <div class="stat-value">${average === null ? '—' : fmt(average)}<small>${average === null ? '' : ' kcal'}</small></div>
        <div class="stat-foot">${average === null
          ? 'No logged days yet in this window.'
          : diff <= 0
            ? `<span class="down">${fmt(Math.abs(diff))} cal under</span> your daily goal`
            : `<span class="up">${fmt(diff)} cal over</span> your daily goal`}</div>
      </article>
      <article class="stat-card" style="animation-delay:40ms">
        <div class="stat-top"><span class="stat-label">On-target streak</span><span class="stat-emoji">🔥</span></div>
        <div class="stat-value">${streak}<small> day${streak === 1 ? '' : 's'}</small></div>
        <div class="stat-foot">${streak === 0 ? 'Log a day at or under goal to spark it.' : 'Consecutive days at or under goal.'}</div>
      </article>
      <article class="stat-card" style="animation-delay:80ms">
        <div class="stat-top"><span class="stat-label">Days logged</span><span class="stat-emoji">🗓️</span></div>
        <div class="stat-value">${logged7.length}<small> / 7</small></div>
        <div class="mini-days">${miniDays}</div>
      </article>
      <article class="stat-card" style="animation-delay:120ms">
        <div class="stat-top"><span class="stat-label">Hall of fame</span><span class="stat-emoji">🏆</span></div>
        <div class="stat-value text">${favourite ? escapeHtml(truncate(favourite.name, 18)) : '—'}</div>
        <div class="stat-foot">${favourite
          ? `Logged ${favourite.count} time${favourite.count === 1 ? '' : 's'} in 30 days. Reliable.`
          : 'Your most-logged food lands here.'}</div>
      </article>`;
  }

  setText('#analytics-range', `Last 14 days through ${shortDate(selectedDate)} · ${onTarget7}/${logged7.length} on target`);

  const barHost = $('#bar-chart');
  if (barHost) barHost.innerHTML = barChartMarkup(last14, goal);

  const chartSub = $('#chart-sub');
  if (chartSub) {
    chartSub.textContent = `${shortDate(last14[0].date)} – ${shortDate(last14[last14.length - 1].date)} · dashed line is your ${fmt(goal)} goal`;
  }

  const macroHost = $('#macro-chart');
  if (macroHost) macroHost.innerHTML = macroChartMarkup(last7);

  // Meal mix — logged food only, last 7 days ending on the selected date.
  // Bubble top-ups are generic calories, so they would lie about the meal split.
  const mealTotals = { Breakfast: 0, Lunch: 0, Dinner: 0, Snacks: 0 };
  const weekStart = addDays(selectedDate, -6);
  for (const entry of state.history) {
    if (entry.source === 'bubble') continue;
    if (entry.date < weekStart || entry.date > selectedDate) continue;
    if (mealTotals[entry.meal] !== undefined) mealTotals[entry.meal] += Number(entry.calories) || 0;
  }
  const weekTotal = Object.values(mealTotals).reduce((sum, value) => sum + value, 0);
  const donut = donutMarkup(mealTotals, weekTotal);
  setHtml('#donut', donut.svg + donut.center);
  setHtml('#donut-legend', donut.legend);

  renderInsights({ last7, logged7, average, onTarget7, streak, goal, favourite, energy: energyFor(profile) });
}

function renderInsights({ last7, logged7, average, onTarget7, streak, goal, favourite, energy }) {
  const host = $('#insight-grid');
  if (!host) return;
  const profile = state.profile;
  const today = todayStr();
  const projection = projectionFor(profile, state.history);

  let consistency;
  if (!logged7.length) {
    consistency = {
      tone: 'info',
      emoji: '🫧',
      title: 'Start with one bubble',
      body: 'Tap a bubble on the meter or log a meal. Each bubble is 50 calories — the whole day is 40 of them.',
    };
  } else {
    const good = logged7.length >= 5 && onTarget7 >= Math.max(3, logged7.length - 1);
    consistency = {
      tone: good ? 'good' : 'info',
      emoji: good ? '💪' : '📌',
      title: `${logged7.length} of 7 days logged`,
      body: `${onTarget7} stayed at or under your ${fmt(goal)} goal.${streak > 0 ? ` Current streak: ${streak} day${streak === 1 ? '' : 's'}.` : ''}`,
    };
  }

  let pace;
  if (!projection.daysLeft) {
    pace = {
      tone: 'warn',
      emoji: '🗓️',
      title: 'Target date passed',
      body: 'Set a fresh finish line in Profile & goals to keep the projection honest.',
    };
  } else if (projection.projectedLoss >= 0) {
    const enough = projection.projectedLoss >= projection.neededLoss * 0.9;
    const required = projection.requiredIntake;
    const finishWeight = (Number(profile.currentWeight) || 0) - projection.projectedLoss;
    const goalDate = shortDate(profile.targetDate);
    let targetText = '';
    if (required && required > 800 && required < 6000) {
      targetText = Math.abs(required - goal) <= 75
        ? ' Your calorie goal is basically spot on.'
        : ` To land exactly on ${fmt(profile.goalWeight)} lb, aim for ~${fmt(required)} cal/day.`;
    }
    pace = {
      tone: enough ? 'good' : 'warn',
      emoji: enough ? '🎯' : '⚖️',
      title: `On pace for ${fmt1(projection.projectedLoss)} lb down`,
      body: `At ${fmt(projection.intake)} kcal/day${projection.usingAverage ? ' (your recent average)' : ' (your goal)'}, you're tracking toward ${fmt1(finishWeight)} lb by ${goalDate}.${targetText}`,
    };
  } else {
    pace = {
      tone: 'warn',
      emoji: '⚠️',
      title: 'Trending the other way',
      body: `At ${fmt(projection.intake)} kcal/day you're running a surplus of about ${fmt(Math.abs(projection.dailyDeficit))} cal — that's a gain of ${fmt1(Math.abs(projection.projectedLoss))} lb by your target date.`,
    };
  }

  // Weekend pattern (last 30 days) or favourite food.
  let pattern = null;
  const weekendTotals = [];
  const weekdayTotals = [];
  const recentTotals = totalsByDate(state.history);
  for (let i = 0; i < 30; i += 1) {
    const date = addDays(today, -i);
    const total = recentTotals.get(date)?.total || 0;
    if (!total) continue;
    const dow = new Date(`${date}T12:00:00`).getDay();
    if (dow === 0 || dow === 6) weekendTotals.push(total);
    else weekdayTotals.push(total);
  }
  if (weekendTotals.length >= 2 && weekdayTotals.length >= 2) {
    const weekendAvg = weekendTotals.reduce((a, b) => a + b, 0) / weekendTotals.length;
    const weekdayAvg = weekdayTotals.reduce((a, b) => a + b, 0) / weekdayTotals.length;
    const pct = Math.round((weekendAvg / weekdayAvg - 1) * 100);
    if (Math.abs(pct) >= 10) {
      pattern = {
        tone: pct > 0 ? 'warn' : 'good',
        emoji: pct > 0 ? '🍕' : '🥗',
        title: pct > 0 ? 'Weekends run hotter' : 'Weekends are dialled in',
        body: `Weekend days average ${fmt(weekendAvg)} cal — ${Math.abs(pct)}% ${pct > 0 ? 'above' : 'below'} your weekdays (${fmt(weekdayAvg)}).`,
      };
    }
  }
  if (!pattern) {
    pattern = favourite
      ? {
          tone: 'info',
          emoji: '🏆',
          title: `Hall of fame: ${favourite.name}`,
          body: `${favourite.count} log${favourite.count === 1 ? '' : 's'} in the last 30 days · ${fmt(favourite.calories)} cal total. A dependable favourite.`,
        }
      : {
          tone: 'info',
          emoji: '📉',
          title: 'Small deficit, big payoff',
          body: `A 500 cal daily deficit is about 1 lb a week. Your ${fmt(goal)} goal is a steady, sustainable place to live.`,
        };
  }

  host.innerHTML = [consistency, pace, pattern].map((insight) => `
    <article class="insight tone-${insight.tone}">
      <span class="insight-emoji">${insight.emoji}</span>
      <h4>${escapeHtml(insight.title)}</h4>
      <p>${escapeHtml(insight.body)}</p>
    </article>`).join('');
}

export function renderStorage() {
  const health = state.health;
  const sheets = health?.storage === 'sheets';
  const label = sheets ? 'Google Sheets · synced' : 'Local mode · data/db.json';
  const gateLabel = sheets ? 'Google Sheets connected' : 'Local mode — Google Sheets not set up';

  const gateDot = $('#gate-storage .storage-dot');
  if (gateDot) gateDot.className = `storage-dot ${sheets ? 'online' : 'local'}`;
  const gateText = $('#gate-storage span:last-child');
  if (gateText) gateText.textContent = gateLabel;

  const footDot = $('#storage-badge .storage-dot');
  if (footDot) footDot.className = `storage-dot ${sheets ? 'online' : 'local'}`;
  setText('#storage-text', label);
  const badge = $('#storage-badge');
  if (badge) badge.title = health?.warning || (sheets ? `Synced to ${health.sheetUrl}` : 'Add Google Sheets credentials in .env to sync there.');

  const settingsDot = $('#settings-storage .storage-dot');
  if (settingsDot) settingsDot.className = `storage-dot ${sheets ? 'online' : 'local'}`;
  const settingsText = $('#settings-storage span:last-child');
  if (settingsText) settingsText.textContent = label;

  const link = $('#settings-sheet-link');
  if (link) {
    link.classList.toggle('is-hidden', !sheets);
    if (sheets) link.href = health.sheetUrl;
  }
  const menuSheet = $('#menu-sheet');
  if (menuSheet) {
    menuSheet.classList.toggle('is-hidden', !sheets);
    if (sheets) menuSheet.dataset.url = health.sheetUrl;
  }
}

export function renderMealButtons() {
  const host = $('#meal-seg');
  if (!host) return;
  host.querySelectorAll('[data-meal]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.meal === state.meal);
  });
}

export function renderQuickChips() {
  const host = $('#quick-chips');
  if (!host) return;
  host.innerHTML = QUICK_FOODS.map((food, index) => `
    <button type="button" class="chip" data-quick="${index}" title="Log ${escapeHtml(food.name)}">
      <span class="chip-emoji">${food.emoji}</span>
      <span>${escapeHtml(food.name)}</span>
      <span class="chip-cal">${fmt(food.calories)}</span>
    </button>`).join('');
}

function truncate(value, length) {
  const text = String(value || '');
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
