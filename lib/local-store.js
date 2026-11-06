import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * File-backed store used when Google Sheets credentials are absent
 * (or temporarily unreachable). Mirrors the GoogleSheets API surface.
 */
export class LocalStore {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    this.db = { version: 1, profiles: {}, entries: [] };
    this.queue = Promise.resolve();
  }

  sheetUrl() {
    return null;
  }

  async init() {
    await fsp.mkdir(this.dir, { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        const raw = await fsp.readFile(this.file, 'utf8');
        const parsed = JSON.parse(raw);
        this.db = {
          version: 1,
          profiles: parsed.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : {},
          entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        };
      } catch (error) {
        const backup = `${this.file}.corrupt-${Date.now()}`;
        await fsp.rename(this.file, backup).catch(() => {});
        console.warn(`Local data file was unreadable; moved to ${backup}`);
      }
    }
    await this.persist();
  }

  persist() {
    const snapshot = JSON.stringify(this.db, null, 2);
    this.queue = this.queue.then(async () => {
      const tmp = `${this.file}.tmp`;
      await fsp.writeFile(tmp, snapshot, 'utf8');
      await fsp.rename(tmp, this.file);
    });
    return this.queue;
  }

  async listProfiles() {
    return Object.values(this.db.profiles).sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
    );
  }

  async getProfile(key) {
    return this.db.profiles[key] || null;
  }

  async saveProfile(profile) {
    this.db.profiles[profile.key] = profile;
    await this.persist();
    return profile;
  }

  async listEntries({ user, from, to }) {
    return this.db.entries
      .filter((e) => e.user === user && (!from || e.date >= from) && (!to || e.date <= to))
      .map((e) => ({ ...e }))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async addEntry(entry) {
    this.db.entries.push(entry);
    await this.persist();
    return entry;
  }

  async updateEntry(id, user, patch) {
    const entry = this.db.entries.find((e) => e.id === id && e.user === user);
    if (!entry) return null;
    Object.assign(entry, patch, { id: entry.id, user: entry.user });
    await this.persist();
    return { ...entry };
  }

  async deleteEntry(id, user) {
    const index = this.db.entries.findIndex((e) => e.id === id && e.user === user);
    if (index === -1) return false;
    this.db.entries.splice(index, 1);
    await this.persist();
    return true;
  }
}
