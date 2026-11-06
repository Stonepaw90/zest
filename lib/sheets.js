import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

export class GoogleSheets {
  constructor({ spreadsheetId, clientEmail, privateKey, entriesTab = 'Entries', profilesTab = 'Profiles' }) {
    this.spreadsheetId = spreadsheetId;
    this.clientEmail = clientEmail;
    this.privateKey = privateKey;
    this.entriesTab = entriesTab;
    this.profilesTab = profilesTab;
    this.token = null;
    this.tokenExpiry = 0;
    this.meta = null;
    this.entriesCache = null;
    this.entriesCacheAt = 0;
    this.profilesCache = null;
    this.profilesCacheAt = 0;
    this.cacheMs = 8000;
  }

  sheetUrl() {
    return `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}/edit`;
  }

  async getAccessToken() {
    if (this.token && Date.now() < this.tokenExpiry - 60_000) return this.token;
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: this.clientEmail,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      }),
    );
    const unsigned = `${header}.${claims}`;
    let signature;
    try {
      signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(this.privateKey, 'base64url');
    } catch {
      throw new Error('The Google service account private key could not be read. Check GOOGLE_PRIVATE_KEY.');
    }
    const assertion = `${unsigned}.${signature}`;
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        data.error_description || data.error || `Google authentication failed (${res.status}).`,
      );
    }
    this.token = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    return this.token;
  }

  async api(pathname, { method = 'GET', body } = {}) {
    const token = await this.getAccessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data?.error?.message || `Google Sheets request failed (${res.status}).`;
      if (/permission|not found/i.test(detail)) {
        throw new Error(
          `${detail} Share the spreadsheet with ${this.clientEmail} as an Editor, and double-check SHEET_ID.`,
        );
      }
      throw new Error(detail);
    }
    return data;
  }

  async getMeta(force = false) {
    if (this.meta && !force) return this.meta;
    this.meta = await this.api('?fields=sheets(properties(sheetId,title))');
    return this.meta;
  }

  sheetIdFor(title) {
    const sheet = (this.meta?.sheets || []).find((s) => s.properties?.title === title);
    return sheet?.properties?.sheetId ?? null;
  }

  async ensureTabs() {
    await this.getMeta(true);
    const titles = (this.meta.sheets || []).map((s) => s.properties?.title);
    const missing = [];
    if (!titles.includes(this.entriesTab)) missing.push(this.entriesTab);
    if (!titles.includes(this.profilesTab)) missing.push(this.profilesTab);
    if (missing.length) {
      await this.api(':batchUpdate', {
        method: 'POST',
        body: {
          requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
        },
      });
      await this.getMeta(true);
    }
    await this.ensureHeaders(
      this.entriesTab,
      ['id', 'user', 'date', 'meal', 'name', 'calories', 'source', 'created_at', 'protein', 'fat', 'carbs'],
    );
    await this.ensureHeaders(
      this.profilesTab,
      [
        'key',
        'username',
        'age',
        'sex',
        'height_in',
        'start_weight',
        'current_weight',
        'goal_weight',
        'daily_goal',
        'run_min_week',
        'target_date',
        'updated_at',
        'created_at',
      ],
    );
  }

  async ensureHeaders(tab, headers) {
    const range = `'${tab}'!A1:${columnLetter(headers.length)}1`;
    const current = await this.api(`/values/${encodeURIComponent(range)}`);
    const row = current?.values?.[0] || [];
    if (row.length === 0) {
      await this.api(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
        method: 'PUT',
        body: { values: [headers] },
      });
      return;
    }
    // Existing sheets keep their header names; fill in any new trailing
    // columns (for example the macro columns added after the first release).
    const next = headers.map((header, index) => String(row[index] || header));
    const changed = next.some((value, index) => value !== String(row[index] ?? ''));
    if (changed) {
      await this.api(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
        method: 'PUT',
        body: { values: [next] },
      });
    }
  }

  async getValues(tab, range) {
    const data = await this.api(`/values/${encodeURIComponent(`'${tab}'!${range}`)}`);
    return data?.values || [];
  }

  async append(tab, row) {
    await this.api(
      `/values/${encodeURIComponent(`'${tab}'!A2`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: { values: [row] } },
    );
  }

  async updateRow(tab, rowNumber, row) {
    const range = `'${tab}'!A${rowNumber}:${columnLetter(row.length)}${rowNumber}`;
    await this.api(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: { values: [row] },
    });
  }

  async deleteRow(tab, rowNumber) {
    const sheetId = this.sheetIdFor(tab);
    if (sheetId === null) throw new Error(`Sheet tab ${tab} was not found.`);
    await this.api(':batchUpdate', {
      method: 'POST',
      body: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: rowNumber - 1,
                endIndex: rowNumber,
              },
            },
          },
        ],
      },
    });
  }

  /** ---------- Entries ---------- */

  async readEntries(force = false) {
    if (!force && this.entriesCache && Date.now() - this.entriesCacheAt < this.cacheMs) {
      return this.entriesCache;
    }
    const rows = await this.getValues(this.entriesTab, 'A2:K');
    const entries = rows
      .map((row, index) => {
        if (!row?.[0]) return null;
        return {
          id: String(row[0]),
          user: String(row[1] || '').toLowerCase(),
          date: String(row[2] || ''),
          meal: String(row[3] || 'Snacks'),
          name: String(row[4] || ''),
          calories: Number(row[5]) || 0,
          source: row[6] === 'bubble' ? 'bubble' : 'food',
          createdAt: String(row[7] || ''),
          protein: macroCell(row[8]),
          fat: macroCell(row[9]),
          carbs: macroCell(row[10]),
          rowNumber: index + 2,
        };
      })
      .filter(Boolean)
      .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
    this.entriesCache = entries;
    this.entriesCacheAt = Date.now();
    return entries;
  }

  invalidateEntries() {
    this.entriesCache = null;
    this.entriesCacheAt = 0;
  }

  async listEntries({ user, from, to }) {
    const all = await this.readEntries();
    return all
      .filter((e) => e.user === user && (!from || e.date >= from) && (!to || e.date <= to))
      .map(stripRowNumber)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }

  async addEntry(entry) {
    await this.append(this.entriesTab, [
      entry.id,
      entry.user,
      entry.date,
      entry.meal,
      entry.name,
      entry.calories,
      entry.source,
      entry.createdAt,
      entry.protein ?? '',
      entry.fat ?? '',
      entry.carbs ?? '',
    ]);
    this.invalidateEntries();
    return entry;
  }

  async updateEntry(id, user, patch) {
    const all = await this.readEntries(true);
    const found = all.find((e) => e.id === id && e.user === user);
    if (!found) return null;
    const merged = { ...found, ...patch, id: found.id, user: found.user };
    await this.updateRow(this.entriesTab, found.rowNumber, [
      merged.id,
      merged.user,
      merged.date,
      merged.meal,
      merged.name,
      merged.calories,
      merged.source,
      merged.createdAt,
      merged.protein ?? '',
      merged.fat ?? '',
      merged.carbs ?? '',
    ]);
    this.invalidateEntries();
    return stripRowNumber(merged);
  }

  async deleteEntry(id, user) {
    const all = await this.readEntries(true);
    const found = all.find((e) => e.id === id && e.user === user);
    if (!found) return false;
    await this.deleteRow(this.entriesTab, found.rowNumber);
    this.invalidateEntries();
    return true;
  }

  /** ---------- Profiles ---------- */

  async readProfiles(force = false) {
    if (!force && this.profilesCache && Date.now() - this.profilesCacheAt < this.cacheMs) {
      return this.profilesCache;
    }
    const rows = await this.getValues(this.profilesTab, 'A2:M');
    const profiles = rows
      .map((row, index) => {
        if (!row?.[0]) return null;
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
          targetDate: String(row[10] || ''),
          updatedAt: String(row[11] || ''),
          createdAt: String(row[12] || ''),
          rowNumber: index + 2,
        };
      })
      .filter(Boolean);
    this.profilesCache = profiles;
    this.profilesCacheAt = Date.now();
    return profiles;
  }

  invalidateProfiles() {
    this.profilesCache = null;
    this.profilesCacheAt = 0;
  }

  async listProfiles() {
    const all = await this.readProfiles();
    return all.map(({ rowNumber, ...p }) => p);
  }

  async getProfile(key) {
    const all = await this.readProfiles();
    const found = all.find((p) => p.key === key);
    if (!found) return null;
    const { rowNumber, ...profile } = found;
    return profile;
  }

  async saveProfile(profile) {
    const all = await this.readProfiles(true);
    const found = all.find((p) => p.key === profile.key);
    const row = [
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
    if (found) {
      await this.updateRow(this.profilesTab, found.rowNumber, row);
    } else {
      await this.append(this.profilesTab, row);
    }
    this.invalidateProfiles();
    return profile;
  }
}

function macroCell(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const grams = Number(value);
  return Number.isFinite(grams) && grams >= 0 ? grams : null;
}

function stripRowNumber(entry) {
  const { rowNumber, ...rest } = entry;
  return rest;
}

function columnLetter(count) {
  let n = count;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || 'A';
}
