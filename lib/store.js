import fs from 'node:fs';
import path from 'node:path';
import { GoogleSheets } from './sheets.js';
import { LocalStore } from './local-store.js';

function readCredentials() {
  const env = process.env;

  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
      if (parsed.client_email && parsed.private_key) {
        return { clientEmail: parsed.client_email, privateKey: parsed.private_key };
      }
    } catch {
      console.warn('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON; ignoring it.');
    }
  }

  const credentialFile =
    env.GOOGLE_APPLICATION_CREDENTIALS ||
    (fs.existsSync(path.join(process.cwd(), 'credentials.json'))
      ? path.join(process.cwd(), 'credentials.json')
      : null);

  if (credentialFile && fs.existsSync(credentialFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
      if (parsed.client_email && parsed.private_key) {
        return { clientEmail: parsed.client_email, privateKey: parsed.private_key };
      }
    } catch {
      console.warn(`Could not parse credentials file at ${credentialFile}.`);
    }
  }

  if (env.GOOGLE_SA_EMAIL && env.GOOGLE_PRIVATE_KEY) {
    return { clientEmail: env.GOOGLE_SA_EMAIL, privateKey: env.GOOGLE_PRIVATE_KEY };
  }

  return null;
}

/**
 * Returns { store, mode, warning } where mode is 'sheets' or 'local'.
 * If Sheets is configured but init fails, we keep the app usable by
 * falling back to local storage and surfacing a warning in the UI.
 */
export async function createStore() {
  const dataDir = path.join(process.cwd(), 'data');
  const sheetId = (process.env.SHEET_ID || process.env.GOOGLE_SHEET_ID || '').trim();
  const credentials = readCredentials();
  const forceLocal = process.env.FORCE_LOCAL === '1' || process.env.FORCE_LOCAL === 'true';

  const local = new LocalStore(dataDir);
  await local.init();

  if (forceLocal || !sheetId || !credentials) {
    return {
      store: local,
      mode: 'local',
      warning: null,
      reason: !sheetId || !credentials ? 'Google Sheets is not configured yet.' : null,
    };
  }

  const sheets = new GoogleSheets({
    spreadsheetId: sheetId,
    clientEmail: credentials.clientEmail,
    privateKey: credentials.privateKey,
    entriesTab: process.env.SHEET_TAB_ENTRIES || 'Entries',
    profilesTab: process.env.SHEET_TAB_PROFILES || 'Profiles',
  });

  try {
    await sheets.ensureTabs();
    console.log(`Google Sheets connected: ${sheets.sheetUrl()}`);
    return { store: sheets, mode: 'sheets', warning: null };
  } catch (error) {
    console.error(`Google Sheets unavailable: ${error.message}`);
    return {
      store: local,
      mode: 'local',
      warning: `Google Sheets is unavailable, so changes are saving locally. ${error.message}`,
    };
  }
}
