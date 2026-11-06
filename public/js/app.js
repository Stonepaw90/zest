/* Boot, user session, event wiring, API actions. */
import { api, isConfigured } from './api.js';
import { hasFoodData, searchFoods } from './foods.js';
import { state, applyDay, recomputeDay, resetForUser, minDate } from './state.js';
import {
  renderAll,
  renderAnalytics,
  renderFood,
  renderHeader,
  renderMealButtons,
  renderMeter,
  renderQuickChips,
  renderSide,
  renderStorage,
} from './render.js';
import { closeAllModals, closeModal, confettiBurst, openModal, setBusy, toast } from './ui.js';
import {
  addDays,
  DAY_NAV_LIMIT,
  escapeHtml,
  fmt,
  guessMeal,
  historyFrom,
  LAST_USER_KEY,
  MACROS,
  macroSummary,
  macroValue,
  QUICK_FOODS,
  relativeLabel,
  todayStr,
} from './util.js';

const $ = (selector, root = document) => root.querySelector(selector);
const enc = encodeURIComponent;
const MACRO_HINT = 'Auto-fills from food search';
const MACRO_IDS = { add: 'food', edit: 'edit' };

let loadSeq = 0;
let addBusy = false;
let storageWarned = false;
let suggestTimer = null;
let suggestSeq = 0;
let suggestFoods = [];
let suggestIndex = -1;

/* ============================================================
   BOOT
   ============================================================ */

async function boot() {
  wireGate();
  wireApp();
  renderQuickChips();
  renderStorage();
  loadHealth();
  loadRecentUsers();
}

async function loadHealth() {
  if (!isConfigured()) {
    state.health = { storage: 'none', warning: null, sheetUrl: null };
    showSetupWarning(true);
    renderStorage();
    return;
  }
  try {
    state.health = await api('/api/health');
  } catch {
    state.health = null;
  }
  showSetupWarning(false);
  renderStorage();
}

function showSetupWarning(show) {
  const node = $('#setup-warning');
  if (!node) return;
  node.classList.toggle('is-hidden', !show);
}

async function loadRecentUsers() {
  try {
    const data = await api('/api/users');
    renderRecentUsers(data.users || []);
  } catch {
    renderRecentUsers([]);
  }
}

function renderRecentUsers(users) {
  const host = $('#gate-recents');
  if (!host) return;
  const unique = [];
  const seen = new Set();
  for (const user of users) {
    const key = String(user.username || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(user);
  }
  if (!unique.length) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML =
    '<span class="recent-label">Recent diaries</span>' +
    unique.slice(0, 6).map((user) => {
      const initials = String(user.username).trim().charAt(0).toUpperCase();
      return `<button type="button" class="user-pill" data-user="${escapeHtml(user.username)}">
        <span class="mini-avatar">${escapeHtml(initials)}</span>${escapeHtml(user.username)}
      </button>`;
    }).join('');
}

/* ============================================================
   GATE / SESSION
   ============================================================ */

function wireGate() {
  const form = $('#gate-form');
  const input = $('#gate-username');
  const avatar = $('#gate-avatar');

  input.addEventListener('input', () => {
    const value = input.value.trim();
    avatar.textContent = value ? value.charAt(0).toUpperCase() : '?';
    setGateError('');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.dataset.busy === 'true') return;
    const username = input.value.trim();
    if (username.length < 2) {
      setGateError('Usernames need at least 2 characters.');
      input.focus();
      return;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$/.test(username)) {
      setGateError('Use letters, numbers, spaces, dots, dashes or underscores.');
      input.focus();
      return;
    }
    await login(username);
  });

  $('#gate-recents').addEventListener('click', (event) => {
    const button = event.target.closest('[data-user]');
    if (!button) return;
    input.value = button.dataset.user;
    avatar.textContent = button.dataset.user.charAt(0).toUpperCase();
    form.requestSubmit();
  });
}

function setGateError(message) {
  const node = $('#gate-error');
  if (node) node.textContent = message;
}

async function login(username) {
  const form = $('#gate-form');
  const button = $('#gate-submit');
  if (form.dataset.busy === 'true') return;
  form.dataset.busy = 'true';
  setBusy(button, true);
  setGateError('');
  try {
    const { profile } = await api(`/api/profile?user=${enc(username)}`);
    resetForUser();
    state.profile = profile;
    state.user = profile.username;
    state.key = profile.key;
    localStorage.setItem(LAST_USER_KEY, profile.username);
    showApp();
    await refresh();
    if (state.health?.warning && !storageWarned) {
      storageWarned = true;
      toast(state.health.warning, { kind: 'error', emoji: '🔌', timeout: 8000 });
    }
    if (state.health?.storage === 'local' && !state.health?.warning) {
      toast('Local mode: your log is saving to data/db.json. Add Google Sheets credentials in .env to sync.', {
        kind: 'info',
        emoji: '🗂️',
        timeout: 6500,
      });
    }
  } catch (error) {
    setGateError(error.message);
  } finally {
    form.dataset.busy = 'false';
    setBusy(button, false);
  }
}

function showApp() {
  $('#gate').classList.add('is-hidden');
  $('#app').classList.remove('is-hidden');
  $('#user-menu').classList.add('is-hidden');
  state.date = todayStr();
  state.meal = guessMeal();
  renderHeader();
  renderMealButtons();
  renderStorage();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function logout() {
  closeAllModals();
  closeUserMenu();
  resetForUser();
  $('#app').classList.add('is-hidden');
  $('#gate').classList.remove('is-hidden');
  $('#gate-username').value = '';
  $('#gate-avatar').textContent = '?';
  setGateError('');
  loadRecentUsers();
  window.scrollTo({ top: 0 });
  setTimeout(() => $('#gate-username').focus({ preventScroll: true }), 120);
}

async function refresh() {
  if (!state.profile) return;
  const seq = ++loadSeq;
  const from = historyFrom(state.date);
  const to = todayStr();
  const page = $('.page');
  page?.classList.add('is-loading');
  try {
    const [day, history] = await Promise.all([
      api(`/api/day?user=${enc(state.user)}&date=${state.date}`),
      api(`/api/history?user=${enc(state.user)}&from=${from}&to=${to}`),
    ]);
    if (seq !== loadSeq) return;
    state.dayData = day;
    state.entries = day.entries || [];
    state.history = history.entries || [];
    renderAll();
  } catch (error) {
    if (seq !== loadSeq) return;
    toast(error.message || 'Could not load that day.', { kind: 'error', emoji: '📡' });
  } finally {
    if (seq === loadSeq) page?.classList.remove('is-loading');
  }
}

async function setDate(nextDate) {
  const today = todayStr();
  const floor = addDays(today, -DAY_NAV_LIMIT);
  let next = nextDate;
  if (!next) return;
  if (next > today) next = today;
  if (next < floor) next = floor;
  if (next === state.date) return;

  state.date = next;
  state.entries = [];
  state.dayData = null;
  renderHeader();
  renderMeter();
  renderSide();
  renderFood();
  await refresh();
}

/* ============================================================
   APP EVENTS
   ============================================================ */

function wireApp() {
  wireFoodSuggest();
  $('#prev-day').addEventListener('click', () => setDate(addDays(state.date, -1)));
  $('#next-day').addEventListener('click', () => {
    if (state.date < todayStr()) setDate(addDays(state.date, 1));
  });
  $('#today-btn').addEventListener('click', () => setDate(todayStr()));
  $('#date-pill').addEventListener('click', () => {
    const input = $('#date-input');
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
        return;
      } catch {
        /* fall through */
      }
    }
    input.focus();
    input.click();
  });
  $('#date-input').addEventListener('change', (event) => {
    if (event.target.value) setDate(event.target.value);
  });

  $('#user-chip').addEventListener('click', (event) => {
    event.stopPropagation();
    toggleUserMenu();
  });
  $('#menu-switch').addEventListener('click', logout);
  $('#menu-settings').addEventListener('click', () => {
    closeUserMenu();
    openSettings();
  });
  $('#menu-sheet').addEventListener('click', () => {
    const url = $('#menu-sheet').dataset.url;
    if (url) window.open(url, '_blank', 'noopener');
  });
  $('#settings-btn').addEventListener('click', openSettings);
  $('#switch-user-btn').addEventListener('click', logout);

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.top-actions')) closeUserMenu();
  });

  $('#bubble-meter').addEventListener('click', handleBubbleClick);
  $('#meal-snapshot').addEventListener('click', (event) => {
    const button = event.target.closest('[data-snap-meal]');
    if (!button) return;
    state.meal = button.dataset.snapMeal;
    renderMealButtons();
    $('#add-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => $('#food-name').focus({ preventScroll: true }), 350);
  });

  $('#meal-seg').addEventListener('click', (event) => {
    const button = event.target.closest('[data-meal]');
    if (!button) return;
    state.meal = button.dataset.meal;
    renderMealButtons();
    $('#food-name').focus();
  });

  $('#add-form').addEventListener('submit', submitFood);
  $('#quick-chips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-quick]');
    if (!chip) return;
    const food = QUICK_FOODS[Number(chip.dataset.quick)];
    if (food) quickAdd(food);
  });

  $('#food-list').addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit]');
    if (edit) {
      openEdit(edit.dataset.edit);
      return;
    }
    const del = event.target.closest('[data-delete]');
    if (del) deleteEntry(del.dataset.delete);
  });

  $('#edit-form').addEventListener('submit', saveEdit);
  $('#edit-delete').addEventListener('click', () => {
    if (state.editId) {
      const id = state.editId;
      closeModal('edit-modal');
      deleteEntry(id, { fromModal: true });
    }
  });

  $('#settings-form').addEventListener('submit', saveSettings);

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.dataset.close));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllModals();
      closeUserMenu();
      return;
    }
    if ($('#app').classList.contains('is-hidden')) return;
    if (document.querySelector('.modal.is-open')) return;
    const tag = document.activeElement?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setDate(addDays(state.date, -1));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (state.date < todayStr()) setDate(addDays(state.date, 1));
    } else if (event.key.toLowerCase() === 't') {
      setDate(todayStr());
    }
  });
}

/* ============================================================
   FOOD SEARCH
   ============================================================ */

function wireFoodSuggest() {
  const input = $('#food-name');
  const host = $('#food-suggest');
  if (!input || !host) return;

  input.addEventListener('input', () => {
    const query = input.value.trim();
    clearTimeout(suggestTimer);
    if (query.length < 2) {
      hideSuggest();
      return;
    }
    const seq = ++suggestSeq;
    suggestTimer = setTimeout(async () => {
      try {
        if (!hasFoodData()) paintSuggestNote('Loading the food database…');
        const foods = await searchFoods(query, 8);
        if (seq !== suggestSeq) return;
        suggestFoods = Array.isArray(foods) ? foods : [];
        suggestIndex = suggestFoods.length ? 0 : -1;
        paintSuggestions(query);
      } catch (error) {
        if (seq !== suggestSeq) return;
        suggestFoods = [];
        suggestIndex = -1;
        paintSuggestNote(error.message || 'Food search is unavailable right now.');
      }
    }, 160);
  });

  input.addEventListener('keydown', (event) => {
    if (host.classList.contains('is-hidden')) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!suggestFoods.length) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      suggestIndex = (suggestIndex + delta + suggestFoods.length) % suggestFoods.length;
      paintSuggestions(input.value.trim());
      return;
    }
    if (event.key === 'Enter' && suggestIndex >= 0) {
      event.preventDefault();
      chooseSuggestion(suggestIndex);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      hideSuggest();
    }
  });

  host.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-suggest]');
    if (!button) return;
    chooseSuggestion(Number(button.dataset.suggest));
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.name-field')) hideSuggest();
  });
}

function paintSuggestNote(text) {
  const host = $('#food-suggest');
  const input = $('#food-name');
  if (!host || !input) return;
  host.innerHTML = `<div class="suggest-empty">${escapeHtml(text)}</div>`;
  host.classList.remove('is-hidden');
  input.setAttribute('aria-expanded', 'true');
}

function paintSuggestions(query) {
  const host = $('#food-suggest');
  const input = $('#food-name');
  if (!host || !input) return;
  if (!suggestFoods.length) {
    host.innerHTML = `<div class="suggest-empty">No match for “${escapeHtml(query)}”. Log it manually — you know the vibes.</div>`;
    host.classList.remove('is-hidden');
    input.setAttribute('aria-expanded', 'true');
    return;
  }
  host.innerHTML = suggestFoods.map((food, index) => {
    const macros = macroSummary(food);
    return `
    <button type="button" class="food-suggest-item${index === suggestIndex ? ' is-active' : ''}"
      data-suggest="${index}" role="option" aria-selected="${index === suggestIndex}">
      <span class="suggest-main">
        <strong>${escapeHtml(food.name)}</strong>
        <span>${escapeHtml(food.category)} · ${escapeHtml(food.portionLabel)}</span>
        ${macros ? `<span class="suggest-macros">${escapeHtml(macros)}</span>` : ''}
      </span>
      <span class="suggest-cal">${fmt(food.calories)}<small>cal</small></span>
    </button>
  `;
  }).join('');
  host.classList.remove('is-hidden');
  input.setAttribute('aria-expanded', 'true');
  host.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
}

function chooseSuggestion(index) {
  const food = suggestFoods[index];
  if (!food) return;
  const nameInput = $('#food-name');
  const calInput = $('#food-cal');
  nameInput.value = `${food.name} (${food.portionLabel})`.slice(0, 120);
  calInput.value = String(food.calories);
  fillMacros('add', food);
  setMacroHint(`Macros added for ${food.portionLabel}`);
  hideSuggest();
  nameInput.focus();
  calInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function hideSuggest() {
  suggestSeq += 1;
  clearTimeout(suggestTimer);
  suggestIndex = -1;
  suggestFoods = [];
  const host = $('#food-suggest');
  if (host) {
    host.classList.add('is-hidden');
    host.innerHTML = '';
  }
  $('#food-name')?.setAttribute('aria-expanded', 'false');
}

/* ============================================================
   MACROS
   ============================================================ */

const macroInput = (scope, key) => $(`#${MACRO_IDS[scope]}-${key}`);

function readMacros(scope) {
  const values = {};
  for (const macro of MACROS) {
    const raw = macroInput(scope, macro.key)?.value.trim() ?? '';
    if (!raw) {
      values[macro.key] = null;
      continue;
    }
    const value = macroValue(raw);
    if (value === null || value > 1000) {
      return { error: `${macro.label} needs to be between 0 and 1,000 grams.` };
    }
    values[macro.key] = Math.round(value * 10) / 10;
  }
  return { values };
}

function fillMacros(scope, item) {
  for (const macro of MACROS) {
    const input = macroInput(scope, macro.key);
    if (!input) continue;
    const value = macroValue(item?.[macro.key]);
    input.value = value === null ? '' : String(value);
  }
}

function clearMacros(scope) {
  fillMacros(scope, null);
}

function setMacroHint(text) {
  const node = $('#macro-hint');
  if (node) node.textContent = text;
}

function toggleUserMenu() {
  const menu = $('#user-menu');
  const chip = $('#user-chip');
  const hidden = menu.classList.toggle('is-hidden');
  chip.setAttribute('aria-expanded', hidden ? 'false' : 'true');
}

function closeUserMenu() {
  const menu = $('#user-menu');
  const chip = $('#user-chip');
  if (menu && !menu.classList.contains('is-hidden')) {
    menu.classList.add('is-hidden');
    chip?.setAttribute('aria-expanded', 'false');
  }
}

/* ============================================================
   ACTIONS
   ============================================================ */

async function handleBubbleClick(event) {
  const button = event.target.closest('.bubble');
  if (!button || state.meterBusy || !state.dayData) return;
  const target = Number(button.dataset.cal);
  if (!Number.isFinite(target)) return;
  const before = state.dayData;
  const goal = state.profile.dailyGoal;

  if (target < before.foodTotal) {
    toast(
      `You've already logged ${fmt(before.foodTotal)} cal of food. Remove an item if you need to go lower.`,
      { kind: 'error', emoji: '🍽️' },
    );
    shakeMeter();
    return;
  }

  state.meterBusy = true;
  try {
    const result = await api('/api/day/topup', {
      method: 'PUT',
      body: { user: state.user, date: state.date, target },
    });
    applyDay(result);
    renderMeter();
    renderSide();
    renderFood();
    renderAnalytics();

    if (target === goal && before.total < goal) {
      const rect = $('#meter-card').getBoundingClientRect();
      confettiBurst(rect.left + rect.width / 2, rect.top + rect.height * 0.45);
      toast('Perfect landing — right on 2,000. Show-off. 🎯', { kind: 'success', emoji: '🎉' });
    } else if (result.total > goal && before.total <= goal) {
      toast(`Over by ${fmt(result.total - goal)} cal. Logged, not judged.`, { kind: 'error', emoji: '🚨' });
    } else if (result.total <= goal && before.total > goal) {
      toast('Back under budget. Nice correction.', { kind: 'success', emoji: '🌤️' });
    }
  } catch (error) {
    toast(error.message, { kind: 'error', emoji: error.code === 'below-food' ? '🍽️' : '⚠️' });
    if (error.code === 'below-food') shakeMeter();
  } finally {
    state.meterBusy = false;
  }
}

function shakeMeter() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const card = $('#meter-card');
  card?.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-6px)' },
      { transform: 'translateX(5px)' },
      { transform: 'translateX(-3px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 280, easing: 'ease-out' },
  );
}

async function addFood({ name, calories, meal, protein = null, fat = null, carbs = null }) {
  if (addBusy) return false;
  addBusy = true;
  try {
    const result = await api('/api/entries', {
      method: 'POST',
      body: { user: state.user, date: state.date, meal, name, calories, protein, fat, carbs },
    });
    applyDay(result.day);
    renderAll();
    return true;
  } catch (error) {
    toast(error.message || 'Could not add that food.', { kind: 'error', emoji: '⚠️' });
    return false;
  } finally {
    addBusy = false;
  }
}

async function submitFood(event) {
  event.preventDefault();
  hideSuggest();
  const nameInput = $('#food-name');
  const calInput = $('#food-cal');
  const errorNode = $('#add-error');
  const name = nameInput.value.trim().replace(/\s+/g, ' ');
  const calories = Math.round(Number(calInput.value));

  errorNode.textContent = '';
  if (!name) {
    errorNode.textContent = 'Give your food a name first.';
    nameInput.focus();
    return;
  }
  if (!Number.isFinite(calories) || calories < 0 || calories > 20000) {
    errorNode.textContent = 'Calories need to be a number between 0 and 20,000.';
    calInput.focus();
    return;
  }
  const macros = readMacros('add');
  if (macros.error) {
    errorNode.textContent = macros.error;
    return;
  }

  const button = $('#add-btn');
  setBusy(button, true);
  const ok = await addFood({ name, calories, meal: state.meal, ...macros.values });
  setBusy(button, false);
  if (!ok) return;

  hideSuggest();
  nameInput.value = '';
  calInput.value = '';
  clearMacros('add');
  setMacroHint(MACRO_HINT);
  nameInput.focus();
  const dayNote = state.date === todayStr() ? '' : ` (${relativeLabel(state.date)})`;
  toast(`Logged ${name} · ${fmt(calories)} cal${dayNote}`, { kind: 'success', emoji: '🍽️' });
}

async function quickAdd(food) {
  if (addBusy) return;
  const ok = await addFood({ name: food.name, calories: food.calories, meal: state.meal });
  if (ok) {
    const dayNote = state.date === todayStr() ? '' : ` (${relativeLabel(state.date)})`;
    toast(`Added ${food.name} · ${fmt(food.calories)} cal${dayNote}`, { kind: 'success', emoji: food.emoji });
  }
}

function openEdit(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  state.editId = id;
  $('#edit-name').value = entry.name;
  $('#edit-cal').value = entry.calories;
  $('#edit-meal').value = entry.meal;
  fillMacros('edit', entry);
  $('#edit-error').textContent = '';
  openModal('edit-modal');
}

async function saveEdit(event) {
  event.preventDefault();
  if (!state.editId) return;
  const name = $('#edit-name').value.trim();
  const calories = Math.round(Number($('#edit-cal').value));
  const meal = $('#edit-meal').value;
  const errorNode = $('#edit-error');
  if (!name) {
    errorNode.textContent = 'Give it a name.';
    return;
  }
  if (!Number.isFinite(calories) || calories < 0 || calories > 20000) {
    errorNode.textContent = 'Enter calories between 0 and 20,000.';
    return;
  }
  const macros = readMacros('edit');
  if (macros.error) {
    errorNode.textContent = macros.error;
    return;
  }
  const button = $('#edit-save');
  setBusy(button, true);
  try {
    const result = await api(`/api/entries/${enc(state.editId)}?user=${enc(state.user)}`, {
      method: 'PATCH',
      body: { name, calories, meal, ...macros.values },
    });
    applyDay(result.day);
    renderAll();
    closeModal('edit-modal');
    toast('Entry updated.', { kind: 'success', emoji: '✏️' });
  } catch (error) {
    errorNode.textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function deleteEntry(id, { fromModal = false } = {}) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  const targetBefore = state.dayData?.total || 0;
  const entryDate = entry.date;
  const label = entry.source === 'bubble' ? 'bubble top-up' : entry.name;

  try {
    await api(`/api/entries/${enc(id)}?user=${enc(state.user)}`, { method: 'DELETE' });
    state.entries = state.entries.filter((item) => item.id !== id);
    recomputeDay();
    renderAll();
    if (fromModal) closeModal('edit-modal');
    toast(`Removed ${label}.`, {
      kind: 'info',
      emoji: '🗑️',
      action: 'Undo',
      onAction: () => undoDelete(entry, targetBefore),
    });
  } catch (error) {
    toast(error.message, { kind: 'error', emoji: '⚠️' });
  }
}

async function undoDelete(entry, targetBefore) {
  if (state.date !== entry.date) {
    await setDate(entry.date);
  }
  if (entry.source === 'bubble') {
    const result = await api('/api/day/topup', {
      method: 'PUT',
      body: { user: state.user, date: entry.date, target: targetBefore },
    });
    applyDay(result);
    renderAll();
  } else {
    const result = await api('/api/entries', {
      method: 'POST',
      body: {
        user: state.user,
        date: entry.date,
        meal: entry.meal,
        name: entry.name,
        calories: entry.calories,
        protein: entry.protein ?? null,
        fat: entry.fat ?? null,
        carbs: entry.carbs ?? null,
      },
    });
    applyDay(result.day);
    renderAll();
  }
  toast('Restored.', { kind: 'success', emoji: '↩️' });
}

/* ============================================================
   SETTINGS
   ============================================================ */

function openSettings() {
  const profile = state.profile;
  if (!profile) return;
  $('#set-goal').value = profile.dailyGoal;
  $('#set-run').value = Math.round((profile.runMinWeek / 60) * 100) / 100;
  $('#set-age').value = profile.age;
  $('#set-sex').value = profile.sex;
  const feet = Math.floor(profile.heightIn / 12);
  $('#set-ft').value = feet;
  $('#set-in').value = Math.round((profile.heightIn - feet * 12) * 10) / 10;
  $('#set-current').value = profile.currentWeight;
  $('#set-goal-weight').value = profile.goalWeight;
  $('#set-start').value = profile.startWeight;
  $('#set-target').value = profile.targetDate;
  $('#settings-error').textContent = '';
  renderStorage();
  openModal('settings-modal');
}

async function saveSettings(event) {
  event.preventDefault();
  const errorNode = $('#settings-error');
  errorNode.textContent = '';
  const feet = Number($('#set-ft').value);
  const inches = Number($('#set-in').value);
  const goal = Number($('#set-goal').value);
  const targetDate = $('#set-target').value;

  if (!Number.isFinite(feet) || !Number.isFinite(inches) || feet < 4 || feet > 7 || inches < 0 || inches > 11.5) {
    errorNode.textContent = 'That height does not look right.';
    return;
  }
  if (!Number.isFinite(goal) || goal < 800 || goal > 6000) {
    errorNode.textContent = 'Daily goal needs to be between 800 and 6,000 cal.';
    return;
  }
  if (!targetDate) {
    errorNode.textContent = 'Pick a target date.';
    return;
  }

  const payload = {
    age: Number($('#set-age').value),
    sex: $('#set-sex').value,
    heightIn: feet * 12 + inches,
    currentWeight: Number($('#set-current').value),
    goalWeight: Number($('#set-goal-weight').value),
    startWeight: Number($('#set-start').value),
    dailyGoal: goal,
    runMinWeek: Math.round(Number($('#set-run').value) * 60),
    targetDate,
  };

  const button = $('#settings-save');
  setBusy(button, true);
  try {
    const { profile } = await api(`/api/profile?user=${enc(state.user)}`, {
      method: 'PUT',
      body: payload,
    });
    state.profile = profile;
    state.user = profile.username;
    closeModal('settings-modal');
    renderAll();
    toast('Profile saved. The bubbles have your back.', { kind: 'success', emoji: '🍊' });
  } catch (error) {
    errorNode.textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

/* ---------- Go ---------- */
boot();
