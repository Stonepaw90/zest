import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.js';
import { createStore } from './lib/store.js';
import { searchFoods } from './lib/foods.js';
import { defaultProfile, sanitizeProfile, BUBBLE_NAME, MEALS } from './lib/defaults.js';
import {
  addDays,
  clampInt,
  isValidDate,
  normalizeUser,
  todayString,
  uid,
} from './lib/utils.js';

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 256 * 1024;

const { store, mode, warning } = await createStore();

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'That request is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function userFrom(raw) {
  try {
    return normalizeUser(raw);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}

async function getOrCreateProfile(rawUser) {
  const { key } = userFrom(rawUser);
  const existing = await store.getProfile(key);
  if (existing) return existing;
  const created = defaultProfile(userFrom(rawUser).display, key);
  await store.saveProfile(created);
  return created;
}

function requireDate(value, label = 'date') {
  if (!isValidDate(value)) throw new HttpError(400, `Please provide a valid ${label} (YYYY-MM-DD).`);
  return value;
}

function requirePastOrToday(date) {
  const tomorrow = addDays(todayString(), 1);
  if (date > tomorrow) throw new HttpError(400, 'Future days cannot be edited yet.');
  return date;
}

function cleanMacro(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const grams = Number(value);
  if (!Number.isFinite(grams) || grams < 0) {
    throw new HttpError(400, `${label} needs to be zero or more grams.`);
  }
  return Math.round(grams * 10) / 10;
}

function cleanEntryFields(input, { partial = false } = {}) {
  const out = {};
  if (!partial || input.name !== undefined) {
    const name = String(input.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!name) throw new HttpError(400, 'Give your food a name.');
    out.name = name;
  }
  if (!partial || input.calories !== undefined) {
    const calories = Number(input.calories);
    if (!Number.isFinite(calories) || calories < 0) {
      throw new HttpError(400, 'Calories need to be a positive number.');
    }
    out.calories = Math.min(20000, Math.round(calories));
  }
  if (!partial || input.meal !== undefined) {
    const meal = String(input.meal ?? '');
    if (!MEALS.includes(meal)) throw new HttpError(400, 'Pick a meal: Breakfast, Lunch, Dinner or Snacks.');
    out.meal = meal;
  }
  for (const [field, label] of [['protein', 'Protein'], ['fat', 'Fat'], ['carbs', 'Carbs']]) {
    if (input[field] !== undefined) out[field] = cleanMacro(input[field], label);
  }
  if (input.date !== undefined) out.date = requirePastOrToday(requireDate(input.date));
  return out;
}

function dayTotals(entries) {
  const total = entries.reduce((sum, entry) => sum + (Number(entry.calories) || 0), 0);
  const bubble = entries.find((entry) => entry.source === 'bubble');
  const macros = { protein: 0, fat: 0, carbs: 0 };
  let macroTracked = 0;
  for (const entry of entries) {
    let tracked = false;
    for (const field of ['protein', 'fat', 'carbs']) {
      if (entry[field] === null || entry[field] === undefined || entry[field] === '') continue;
      const value = Number(entry[field]);
      if (!Number.isFinite(value)) continue;
      macros[field] += value;
      tracked = true;
    }
    if (tracked) macroTracked += 1;
  }
  macros.protein = Math.round(macros.protein * 10) / 10;
  macros.fat = Math.round(macros.fat * 10) / 10;
  macros.carbs = Math.round(macros.carbs * 10) / 10;
  return {
    total,
    foodTotal: total - (bubble ? Number(bubble.calories) || 0 : 0),
    bubbleEntry: bubble || null,
    protein: macros.protein,
    fat: macros.fat,
    carbs: macros.carbs,
    macros,
    macroTracked,
    macroCalories: Math.round(macros.protein * 4 + macros.fat * 9 + macros.carbs * 4),
  };
}

async function getDay(userKey, date) {
  const entries = await store.listEntries({ user: userKey, from: date, to: date });
  return { date, entries, ...dayTotals(entries) };
}

async function handleApi(req, res, url) {
  const route = url.pathname.replace(/\/+$/, '') || '/api';
  const method = req.method || 'GET';
  const userParam = url.searchParams.get('user');

  if (route === '/api/health' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      storage: mode,
      warning,
      sheetUrl: mode === 'sheets' ? store.sheetUrl() : null,
      today: todayString(),
      version: '1.0.0',
    });
  }

  if (route === '/api/users' && method === 'GET') {
    const profiles = await store.listProfiles();
    return sendJson(res, 200, {
      users: profiles
        .slice(0, 24)
        .map((p) => ({ username: p.username, updatedAt: p.updatedAt || '' })),
    });
  }

  if (route === '/api/foods' && method === 'GET') {
    const query = String(url.searchParams.get('q') || '').slice(0, 60);
    return sendJson(res, 200, { query, foods: searchFoods(query, 8) });
  }

  if (route === '/api/profile' && method === 'GET') {
    const profile = await getOrCreateProfile(userParam);
    return sendJson(res, 200, { profile });
  }

  if (route === '/api/profile' && (method === 'PUT' || method === 'POST')) {
    const body = await readBody(req);
    const { key, display } = userFrom(userParam || body.username);
    const existing = await store.getProfile(key);
    const base = existing || defaultProfile(display, key);
    const profile = sanitizeProfile({ ...body, username: base.username }, base);
    await store.saveProfile(profile);
    return sendJson(res, 200, { profile });
  }

  if (route === '/api/day' && method === 'GET') {
    const { key } = userFrom(userParam);
    const date = requireDate(url.searchParams.get('date'));
    await getOrCreateProfile(userParam);
    return sendJson(res, 200, await getDay(key, date));
  }

  if (route === '/api/history' && method === 'GET') {
    const { key } = userFrom(userParam);
    const from = requireDate(url.searchParams.get('from'), 'start date');
    const to = requireDate(url.searchParams.get('to'), 'end date');
    if (from > to) throw new HttpError(400, 'The start date must come before the end date.');
    if (from < addDays(to, -500)) throw new HttpError(400, 'Pick a range under 500 days.');
    const entries = await store.listEntries({ user: key, from, to });
    return sendJson(res, 200, { from, to, entries });
  }

  if (route === '/api/entries' && method === 'POST') {
    const body = await readBody(req);
    const { key } = userFrom(body.user || userParam);
    const date = requirePastOrToday(requireDate(body.date));
    await getOrCreateProfile(body.user || userParam);
    const fields = cleanEntryFields(body);
    const entry = {
      id: uid(),
      user: key,
      date,
      meal: fields.meal,
      name: fields.name,
      calories: fields.calories,
      protein: fields.protein ?? null,
      fat: fields.fat ?? null,
      carbs: fields.carbs ?? null,
      source: 'food',
      createdAt: new Date().toISOString(),
    };
    await store.addEntry(entry);
    return sendJson(res, 201, { entry, day: await getDay(key, date) });
  }

  const entryMatch = route.match(/^\/api\/entries\/([^/]+)$/);
  if (entryMatch) {
    const id = decodeURIComponent(entryMatch[1]);
    const { key } = userFrom(userParam);
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readBody(req);
      const fields = cleanEntryFields(body, { partial: true });
      if (fields.date) requirePastOrToday(fields.date);
      const entry = await store.updateEntry(id, key, fields);
      if (!entry) throw new HttpError(404, 'That entry no longer exists.');
      return sendJson(res, 200, { entry, day: await getDay(key, entry.date) });
    }
    if (method === 'DELETE') {
      const removed = await store.deleteEntry(id, key);
      if (!removed) throw new HttpError(404, 'That entry no longer exists.');
      return sendJson(res, 200, { ok: true });
    }
  }

  if (route === '/api/day/topup' && method === 'PUT') {
    const body = await readBody(req);
    const { key } = userFrom(body.user || userParam);
    const date = requirePastOrToday(requireDate(body.date));
    const target = clampInt(body.target, 0, 20000, -1);
    if (target < 0) throw new HttpError(400, 'Choose a calorie amount.');
    await getOrCreateProfile(body.user || userParam);

    const day = await getDay(key, date);
    if (target < day.foodTotal) {
      throw new HttpError(
        409,
        `You've already logged ${day.foodTotal.toLocaleString()} cal of food. Remove an item to go lower.`,
        { code: 'below-food', foodTotal: day.foodTotal, entries: day.entries },
      );
    }

    const diff = target - day.foodTotal;
    const existing = day.bubbleEntry;

    if (diff === 0) {
      if (existing) await store.deleteEntry(existing.id, key);
    } else if (existing) {
      await store.updateEntry(existing.id, key, { calories: diff, date });
    } else {
      await store.addEntry({
        id: uid(),
        user: key,
        date,
        meal: 'Snacks',
        name: BUBBLE_NAME,
        calories: diff,
        protein: null,
        fat: null,
        carbs: null,
        source: 'bubble',
        createdAt: new Date().toISOString(),
      });
    }

    return sendJson(res, 200, { ...(await getDay(key, date)), target });
  }

  throw new HttpError(404, 'That API route does not exist.');
}

function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(PUBLIC_DIR, `.${pathname}`);
  const root = path.resolve(PUBLIC_DIR) + path.sep;
  if (!filePath.startsWith(root) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      // Friendly SPA fallback for extensionless paths.
      if (!path.extname(pathname)) {
        return fs.createReadStream(path.join(PUBLIC_DIR, 'index.html')).pipe(
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          }),
        );
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      if (res.headersSent) return;
      if (error instanceof HttpError) {
        return sendJson(res, error.status, { error: error.message, ...error.extra });
      }
      console.error('API error:', error);
      const message =
        mode === 'sheets'
          ? `Storage error: ${error.message}`
          : error.message || 'Something went wrong on the server.';
      sendJson(res, 500, { error: message });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end('Method not allowed');
  }
  serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  const label = mode === 'sheets' ? 'Google Sheets' : 'local file (data/db.json)';
  console.log(`\n  🍊 Zest is running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Storage: ${label}`);
  if (warning) console.log(`  ⚠ ${warning}`);
  if (mode === 'local' && !warning) {
    console.log('  Add Google Sheets credentials to .env to sync there (see README.md).');
  }
  console.log('');
});
