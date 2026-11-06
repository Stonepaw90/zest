/**
 * Zest backend for Google Apps Script.
 *
 * This script turns a Google Sheet into the shared database for the static
 * GitHub Pages frontend. It implements the same routes as the local Node API,
 * but answers through JSONP so browsers never need CORS or an authenticated
 * Google session.
 *
 * Setup
 * -----
 * 1. Create a Google Sheet at https://sheets.new
 * 2. Extensions > Apps Script, paste this file (and appsscript.json).
 * 3. Project Settings > Script Properties:
 *      SHEET_ID = the ID from the Sheet URL
 *    Optional:
 *      SHEET_TAB_ENTRIES  (default "Entries")
 *      SHEET_TAB_PROFILES (default "Profiles")
 * 4. Deploy > New deployment > Web app
 *      Execute as: Me
 *      Who has access: Anyone
 * 5. Copy the /exec URL into public/config.js as window.ZEST_API_URL.
 *
 * The script runs as the sheet owner, so visitors never authenticate. The
 * first health call creates the Entries and Profiles tabs and their headers.
 */

var VERSION = '1.0.0';
var ENTRY_HEADERS = [
  'id', 'user', 'date', 'meal', 'name', 'calories', 'source', 'created_at',
  'protein', 'fat', 'carbs',
];
var PROFILE_HEADERS = [
  'key', 'username', 'age', 'sex', 'height_in', 'start_weight',
  'current_weight', 'goal_weight', 'daily_goal', 'run_min_week',
  'target_date', 'updated_at', 'created_at',
];
var MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
var BUBBLE_NAME = '⚡ Bubble top-up';
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ============================================================
   WEB APP ENTRY POINTS
   ============================================================ */

function doGet(e) {
  return respond((e && e.parameter) || {});
}

function doPost(e) {
  var params = (e && e.parameter) || {};
  if (e && e.postData && e.postData.contents) {
    params.body = e.postData.contents;
  }
  if (!params.method) params.method = 'POST';
  return respond(params);
}

function respond(params) {
  var payload;
  try {
    payload = { ok: true, data: withLock(function () { return handleRequest(params); }) };
  } catch (error) {
    payload = { ok: false, error: errorPayload(error) };
  }
  return writeOutput(payload, params);
}

function writeOutput(payload, params) {
  var json = JSON.stringify(payload);
  var callback = String(params.callback || '');
  var rid = String(params.rid || '');
  if (/^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(rid) + ',' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function errorPayload(error) {
  var detail = {
    message: error && error.message ? error.message : 'Something went wrong.',
    status: error && error.status ? error.status : 500,
  };
  if (error && error.code) detail.code = error.code;
  if (error && error.extra) {
    Object.keys(error.extra).forEach(function (key) {
      detail[key] = error.extra[key];
    });
  }
  return detail;
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (error) {
    fail(503, 'Zest is busy right now. Please try again in a moment.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
   ROUTES
   ============================================================ */

function handleRequest(params) {
  var action = String(params.action || '');
  var method = String(params.method || 'GET').toUpperCase();
  var body = parseBody(params.body);

  // Opening the Web App URL directly is a quick setup check: it returns
  // health JSON and provisions the tabs/headers on first use.
  if (!action && method === 'GET') return health();
  if (action === 'health' && method === 'GET') return health();
  if (action === 'users' && method === 'GET') return users();
  if (action === 'profile') {
    if (method === 'GET') return { profile: getOrCreateProfile(params.user) };
    if (method === 'PUT' || method === 'POST') {
      return saveProfileRequest(params.user || body.username, body);
    }
  }
  if (action === 'day' && method === 'GET') {
    var dayUser = userFrom(params.user);
    var dayDate = requireDate(params.date, 'date');
    getOrCreateProfile(dayUser.display);
    return getDay(dayUser.key, dayDate);
  }
  if (action === 'history' && method === 'GET') return history(params);
  if (action === 'entries' && method === 'POST') {
    return addEntryRequest(body, params.user);
  }
  if (action === 'entry') {
    if (method === 'PATCH' || method === 'PUT') {
      return updateEntryRequest(params.id, params.user, body);
    }
    if (method === 'DELETE') return deleteEntryRequest(params.id, params.user);
  }
  if (action === 'topup' && method === 'PUT') return topupRequest(body, params.user);

  fail(404, 'That API route does not exist.');
}

function health() {
  var sheet = getSpreadsheet();
  ensureSheet(entriesTabName(), ENTRY_HEADERS);
  ensureSheet(profilesTabName(), PROFILE_HEADERS);
  return {
    ok: true,
    storage: 'sheets',
    warning: null,
    sheetUrl: sheet.getUrl(),
    today: todayString(),
    version: VERSION,
  };
}

function users() {
  var profiles = readProfiles()
    .sort(function (a, b) {
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    })
    .slice(0, 24)
    .map(function (profile) {
      return { username: profile.username, updatedAt: profile.updatedAt || '' };
    });
  return { users: profiles };
}

function history(params) {
  var user = userFrom(params.user);
  var from = requireDate(params.from, 'start date');
  var to = requireDate(params.to, 'end date');
  if (from > to) fail(400, 'The start date must come before the end date.');
  if (daysBetween(from, to) > 500) fail(400, 'Pick a range under 500 days.');
  return {
    from: from,
    to: to,
    entries: listEntries(user.key, from, to).map(stripRowNumber),
  };
}

function saveProfileRequest(rawUser, body) {
  var user = userFrom(rawUser || body.username);
  var existing = getProfile(user.key);
  var base = existing || defaultProfile(user.display, user.key);
  var merged = Object.assign({}, body, { username: base.username });
  var profile = sanitizeProfile(merged, base);
  saveProfileRow(profile);
  return { profile: profile };
}

function addEntryRequest(body, userParam) {
  var user = userFrom(body.user || userParam);
  var date = requirePastOrToday(requireDate(body.date));
  getOrCreateProfile(user.display);
  var fields = cleanEntryFields(body, false);
  var entry = {
    id: uid(),
    user: user.key,
    date: date,
    meal: fields.meal,
    name: fields.name,
    calories: fields.calories,
    protein: fields.protein === undefined ? null : fields.protein,
    fat: fields.fat === undefined ? null : fields.fat,
    carbs: fields.carbs === undefined ? null : fields.carbs,
    source: 'food',
    createdAt: nowIso(),
  };
  appendEntry(entry);
  return { entry: stripRowNumber(entry), day: getDay(user.key, date) };
}

function updateEntryRequest(id, rawUser, body) {
  var user = userFrom(rawUser);
  var existing = findEntry(id, user.key);
  if (!existing) fail(404, 'That entry no longer exists.');
  var fields = cleanEntryFields(body, true);
  if (fields.date) requirePastOrToday(fields.date);
  var merged = Object.assign({}, stripRowNumber(existing), fields);
  updateEntryRow(existing.rowNumber, merged);
  return { entry: stripRowNumber(merged), day: getDay(user.key, merged.date) };
}

function deleteEntryRequest(id, rawUser) {
  var user = userFrom(rawUser);
  var existing = findEntry(id, user.key);
  if (!existing) fail(404, 'That entry no longer exists.');
  deleteEntryRow(existing.rowNumber);
  return { ok: true };
}

function topupRequest(body, userParam) {
  var user = userFrom(body.user || userParam);
  var date = requirePastOrToday(requireDate(body.date));
  var target = clampInt(body.target, 0, 20000, -1);
  if (target < 0) fail(400, 'Choose a calorie amount.');
  getOrCreateProfile(user.display);

  var day = getDay(user.key, date);
  if (target < day.foodTotal) {
    fail(
      409,
      "You've already logged " + formatNumber(day.foodTotal) + ' cal of food. Remove an item to go lower.',
      { code: 'below-food', foodTotal: day.foodTotal, entries: day.entries },
    );
  }

  var diff = target - day.foodTotal;
  var existing = day.bubbleEntry;

  if (diff === 0) {
    if (existing) {
      var bubble = findEntry(existing.id, user.key);
      if (bubble) deleteEntryRow(bubble.rowNumber);
    }
  } else if (existing) {
    var current = findEntry(existing.id, user.key);
    if (current) updateEntryRow(current.rowNumber, Object.assign({}, stripRowNumber(current), {
      calories: diff,
      date: date,
    }));
  } else {
    appendEntry({
      id: uid(),
      user: user.key,
      date: date,
      meal: 'Snacks',
      name: BUBBLE_NAME,
      calories: diff,
      protein: null,
      fat: null,
      carbs: null,
      source: 'bubble',
      createdAt: nowIso(),
    });
  }

  var updated = getDay(user.key, date);
  updated.target = target;
  return updated;
}

/* ============================================================
   PROFILE HELPERS
   ============================================================ */

function getOrCreateProfile(rawUser) {
  var user = userFrom(rawUser);
  var existing = getProfile(user.key);
  if (existing) return existing;
  var created = defaultProfile(user.display, user.key);
  saveProfileRow(created);
  return created;
}

function defaultProfile(username, key) {
  var today = todayString();
  return {
    username: username,
    key: key,
    age: 30,
    sex: 'male',
    heightIn: 71,
    startWeight: 210,
    currentWeight: 210,
    goalWeight: 200,
    dailyGoal: 2000,
    runMinWeek: 120,
    targetDate: addDays(today, 60),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function sanitizeProfile(input, existing) {
  var base = existing || defaultProfile(input.username || 'friend', input.key || 'friend');
  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }
  var heightIn = Math.min(96, Math.max(48, num(input.heightIn, base.heightIn)));
  var startWeight = Math.min(500, Math.max(70, num(input.startWeight, base.startWeight)));
  var goalWeight = Math.min(500, Math.max(70, num(input.goalWeight, base.goalWeight)));
  return Object.assign({}, base, {
    age: Math.min(100, Math.max(13, Math.round(num(input.age, base.age)))),
    sex: input.sex === 'female' ? 'female' : 'male',
    heightIn: Math.round(heightIn * 2) / 2,
    startWeight: Math.round(startWeight * 10) / 10,
    currentWeight: Math.min(500, Math.max(70, Math.round(num(input.currentWeight, base.currentWeight) * 10) / 10)),
    goalWeight: Math.round(goalWeight * 10) / 10,
    dailyGoal: Math.min(6000, Math.max(800, Math.round(num(input.dailyGoal, base.dailyGoal) / 50) * 50)),
    runMinWeek: Math.min(1500, Math.max(0, Math.round(num(input.runMinWeek, base.runMinWeek)))),
    targetDate: DATE_RE.test(String(input.targetDate || '')) ? String(input.targetDate) : base.targetDate,
    updatedAt: nowIso(),
  });
}

/* ============================================================
   ENTRY CLEANING + DAY MATH
   ============================================================ */

function cleanEntryFields(input, partial) {
  var out = {};

  if (!partial || input.name !== undefined) {
    var name = String(input.name === undefined ? '' : input.name).trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!name) fail(400, 'Give your food a name.');
    out.name = name;
  }

  if (!partial || input.calories !== undefined) {
    var calories = Number(input.calories);
    if (!isFinite(calories) || calories < 0) fail(400, 'Calories need to be a positive number.');
    out.calories = Math.min(20000, Math.round(calories));
  }

  if (!partial || input.meal !== undefined) {
    var meal = String(input.meal === undefined ? '' : input.meal);
    if (MEALS.indexOf(meal) === -1) fail(400, 'Pick a meal: Breakfast, Lunch, Dinner or Snacks.');
    out.meal = meal;
  }

  [['protein', 'Protein'], ['fat', 'Fat'], ['carbs', 'Carbs']].forEach(function (pair) {
    if (input[pair[0]] !== undefined) out[pair[0]] = cleanMacro(input[pair[0]], pair[1]);
  });

  if (input.date !== undefined) out.date = requirePastOrToday(requireDate(input.date));
  return out;
}

function cleanMacro(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  var grams = Number(value);
  if (!isFinite(grams) || grams < 0) fail(400, label + ' needs to be zero or more grams.');
  return Math.round(grams * 10) / 10;
}

function getDay(userKey, date) {
  var entries = listEntries(userKey, date, date);
  var result = { date: date, entries: entries };
  return Object.assign(result, dayTotals(entries));
}

function dayTotals(entries) {
  var total = entries.reduce(function (sum, entry) {
    return sum + (Number(entry.calories) || 0);
  }, 0);
  var bubble = null;
  for (var i = 0; i < entries.length; i += 1) {
    if (entries[i].source === 'bubble') {
      bubble = entries[i];
      break;
    }
  }
  var macros = { protein: 0, fat: 0, carbs: 0 };
  var macroTracked = 0;
  entries.forEach(function (entry) {
    var tracked = false;
    ['protein', 'fat', 'carbs'].forEach(function (field) {
      if (entry[field] === null || entry[field] === undefined || entry[field] === '') return;
      var value = Number(entry[field]);
      if (!isFinite(value)) return;
      macros[field] += value;
      tracked = true;
    });
    if (tracked) macroTracked += 1;
  });
  macros.protein = Math.round(macros.protein * 10) / 10;
  macros.fat = Math.round(macros.fat * 10) / 10;
  macros.carbs = Math.round(macros.carbs * 10) / 10;
  return {
    total: total,
    foodTotal: total - (bubble ? Number(bubble.calories) || 0 : 0),
    bubbleEntry: bubble,
    protein: macros.protein,
    fat: macros.fat,
    carbs: macros.carbs,
    macros: macros,
    macroTracked: macroTracked,
    macroCalories: Math.round(macros.protein * 4 + macros.fat * 9 + macros.carbs * 4),
  };
}

/* ============================================================
   SPREADSHEET ACCESS
   ============================================================ */

function getSpreadsheet() {
  var id = prop('SHEET_ID', '');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (error) {
      fail(500, 'Could not open the Google Sheet. Check the SHEET_ID script property and that this account can edit it.');
    }
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    fail(500, 'No Google Sheet is connected. Set the SHEET_ID script property to your spreadsheet ID.');
  }
  return active;
}

function entriesTabName() {
  return prop('SHEET_TAB_ENTRIES', 'Entries');
}

function profilesTabName() {
  return prop('SHEET_TAB_PROFILES', 'Profiles');
}

function ensureSheet(name, headers) {
  var spreadsheet = getSpreadsheet();
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }

  var width = Math.max(headers.length, sheet.getLastColumn());
  var current = sheet.getRange(1, 1, 1, width).getValues()[0];
  var next = headers.map(function (header, index) {
    var existing = String(current[index] || '');
    return existing || header;
  });
  var changed = next.some(function (value, index) {
    return value !== String(current[index] || '');
  });
  if (changed) sheet.getRange(1, 1, 1, headers.length).setValues([next]);
  return sheet;
}

function readEntries() {
  var sheet = ensureSheet(entriesTabName(), ENTRY_HEADERS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, ENTRY_HEADERS.length).getValues();
  var entries = [];
  for (var i = 0; i < values.length; i += 1) {
    var entry = parseEntryRow(values[i], i + 2);
    if (entry) entries.push(entry);
  }
  return entries;
}

function parseEntryRow(row, rowNumber) {
  if (!row || !row[0]) return null;
  var date = dateCell(row[2]);
  if (!DATE_RE.test(date)) return null;
  return {
    id: String(row[0]),
    user: String(row[1] || '').toLowerCase(),
    date: date,
    meal: MEALS.indexOf(String(row[3])) >= 0 ? String(row[3]) : 'Snacks',
    name: String(row[4] || ''),
    calories: Number(row[5]) || 0,
    source: row[6] === 'bubble' ? 'bubble' : 'food',
    createdAt: isoCell(row[7]),
    protein: macroCell(row[8]),
    fat: macroCell(row[9]),
    carbs: macroCell(row[10]),
    rowNumber: rowNumber,
  };
}

function listEntries(user, from, to) {
  return readEntries()
    .filter(function (entry) {
      return entry.user === user
        && (!from || entry.date >= from)
        && (!to || entry.date <= to);
    })
    .map(stripRowNumber)
    .sort(function (a, b) {
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
}

function findEntry(id, user) {
  var entries = readEntries();
  for (var i = 0; i < entries.length; i += 1) {
    if (entries[i].id === id && entries[i].user === user) return entries[i];
  }
  return null;
}

function appendEntry(entry) {
  ensureSheet(entriesTabName(), ENTRY_HEADERS).appendRow(entryRow(entry));
}

function updateEntryRow(rowNumber, entry) {
  ensureSheet(entriesTabName(), ENTRY_HEADERS)
    .getRange(rowNumber, 1, 1, ENTRY_HEADERS.length)
    .setValues([entryRow(entry)]);
}

function deleteEntryRow(rowNumber) {
  ensureSheet(entriesTabName(), ENTRY_HEADERS).deleteRow(rowNumber);
}

function entryRow(entry) {
  return [
    entry.id,
    entry.user,
    entry.date,
    entry.meal,
    entry.name,
    entry.calories,
    entry.source,
    entry.createdAt,
    entry.protein === null || entry.protein === undefined ? '' : entry.protein,
    entry.fat === null || entry.fat === undefined ? '' : entry.fat,
    entry.carbs === null || entry.carbs === undefined ? '' : entry.carbs,
  ];
}

function readProfiles() {
  var sheet = ensureSheet(profilesTabName(), PROFILE_HEADERS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, PROFILE_HEADERS.length).getValues();
  var profiles = [];
  for (var i = 0; i < values.length; i += 1) {
    var profile = parseProfileRow(values[i], i + 2);
    if (profile) profiles.push(profile);
  }
  return profiles;
}

function parseProfileRow(row, rowNumber) {
  if (!row || !row[0]) return null;
  return {
    key: String(row[0]).toLowerCase(),
    username: String(row[1] || row[0]),
    age: Number(row[2]) || 30,
    sex: row[3] === 'female' ? 'female' : 'male',
    heightIn: Number(row[4]) || 71,
    startWeight: Number(row[5]) || 210,
    currentWeight: Number(row[6]) || 210,
    goalWeight: Number(row[7]) || 200,
    dailyGoal: Number(row[8]) || 2000,
    runMinWeek: Number(row[9]) || 0,
    targetDate: dateCell(row[10]),
    updatedAt: isoCell(row[11]),
    createdAt: isoCell(row[12]),
    rowNumber: rowNumber,
  };
}

function getProfile(key) {
  var profiles = readProfiles();
  for (var i = 0; i < profiles.length; i += 1) {
    if (profiles[i].key === key) return stripRowNumber(profiles[i]);
  }
  return null;
}

function saveProfileRow(profile) {
  var sheet = ensureSheet(profilesTabName(), PROFILE_HEADERS);
  var existing = null;
  var rows = readProfiles();
  for (var i = 0; i < rows.length; i += 1) {
    if (rows[i].key === profile.key) {
      existing = rows[i];
      break;
    }
  }
  var row = [
    profile.key,
    profile.username,
    profile.age,
    profile.sex,
    profile.heightIn,
    profile.startWeight,
    profile.currentWeight,
    profile.goalWeight,
    profile.dailyGoal,
    profile.runMinWeek,
    profile.targetDate,
    profile.updatedAt,
    profile.createdAt,
  ];
  if (existing) {
    sheet.getRange(existing.rowNumber, 1, 1, PROFILE_HEADERS.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
  return profile;
}

/* ============================================================
   SMALL HELPERS
   ============================================================ */

function HttpError(status, message, extra) {
  this.name = 'HttpError';
  this.status = status;
  this.message = message;
  this.extra = extra || {};
}
HttpError.prototype = Object.create(Error.prototype);
HttpError.prototype.constructor = HttpError;

function fail(status, message, extra) {
  throw new HttpError(status, message, extra);
}

function parseBody(raw) {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(400, 'Invalid JSON body.');
  }
}

function userFrom(raw) {
  if (typeof raw !== 'string') fail(400, 'Please choose a username.');
  var display = raw.trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!display) fail(400, 'Please choose a username.');
  if (display.length < 2) fail(400, 'Usernames need at least 2 characters.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$/.test(display)) {
    fail(400, 'Use letters, numbers, spaces, dots, dashes or underscores.');
  }
  return { key: display.toLowerCase(), display: display };
}

function requireDate(value, label) {
  if (!isValidDate(value)) fail(400, 'Please provide a valid ' + (label || 'date') + ' (YYYY-MM-DD).');
  return value;
}

function requirePastOrToday(date) {
  var tomorrow = addDays(todayString(), 1);
  if (date > tomorrow) fail(400, 'Future days cannot be edited yet.');
  return date;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  var date = new Date(value + 'T12:00:00');
  if (isNaN(date.getTime())) return false;
  return Utilities.formatDate(date, timeZone(), 'yyyy-MM-dd') === value;
}

function todayString() {
  return Utilities.formatDate(new Date(), timeZone(), 'yyyy-MM-dd');
}

function addDays(value, days) {
  var date = new Date(value + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return Utilities.formatDate(date, timeZone(), 'yyyy-MM-dd');
}

function daysBetween(from, to) {
  var a = new Date(from + 'T12:00:00').getTime();
  var b = new Date(to + 'T12:00:00').getTime();
  return Math.round((b - a) / 86400000);
}

function timeZone() {
  return Session.getScriptTimeZone() || 'America/New_York';
}

function clampInt(value, min, max, fallback) {
  var n = Number(value);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function uid() {
  return Utilities.getUuid();
}

function nowIso() {
  return new Date().toISOString();
}

function macroCell(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  var grams = Number(value);
  return isFinite(grams) && grams >= 0 ? grams : null;
}

function dateCell(value) {
  if (value instanceof Date) return Utilities.formatDate(value, timeZone(), 'yyyy-MM-dd');
  return String(value || '').slice(0, 10);
}

function isoCell(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value || '');
}

function stripRowNumber(row) {
  var copy = Object.assign({}, row);
  delete copy.rowNumber;
  return copy;
}

function formatNumber(value) {
  return String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function prop(name, fallback) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  return value === null || value === '' ? fallback : value;
}
