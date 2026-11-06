# 🍊 Zest — a calorie counter with zest

A polished, zero-dependency calorie tracker built around a tactile bubble meter. Tap a bubble for every 50 calories, log real meals, browse a 7,400-food nutrition database, and watch your streaks, trend lines, macro balance and weight projection update in real time.

Each username gets its own diary, goals and history. The public app is a static site on **GitHub Pages**, and its data lives in **Google Sheets** through a **Google Apps Script** Web App. Visitors do not sign in to Google.

![stack](https://img.shields.io/badge/frontend-static-f97316) ![backend](https://img.shields.io/badge/backend-Apps%20Script-3c873a) ![deps](https://img.shields.io/badge/dependencies-0-f97316)

**Repository:** [github.com/Stonepaw90/zest](https://github.com/Stonepaw90/zest)  
**Public app:** [stonepaw90.github.io/zest](https://stonepaw90.github.io/zest/) (after the setup below)

---

## How it is put together

```
Browser (GitHub Pages)
   │  JSONP GET  (no CORS, no login)
   ▼
Google Apps Script Web App  ──runs as the sheet owner──▶  Google Sheet
```

- `public/` is the entire static frontend. GitHub Actions publishes it to Pages.
- `apps-script/Code.gs` is the backend. It creates the `Entries` and `Profiles` tabs automatically and exposes the same routes as the local dev server.
- The browser searches `public/food.csv` directly, so food suggestions do not need a backend.
- `server.js` and `lib/` remain for local development with the same frontend.

> **Security note:** this is a username-only app. Anyone who has the public Apps Script URL can read and write every username's diary. That is fine for a personal/friends app, but it is **not** real authentication. Don't store sensitive information in the Sheet.

---

## Quick start (local)

```bash
git clone https://github.com/Stonepaw90/zest.git
cd zest
node server.js
```

Open **http://127.0.0.1:4173**, type a username, and start counting.

- No `npm install` and no build step.
- Requires Node.js 20 or newer (uses the built-in `fetch` and `crypto`).
- `npm start` also works. `npm run dev` restarts on file changes.
- Leave `public/config.js` blank. On localhost the frontend automatically uses the Node API and `data/db.json`.

On first login a profile is seeded from the original brief: 210 lb, 5′11″, 2,000 kcal/day, two hours of running per week, aiming for 200 lb in 60 days. Everything is editable in **Profile & goals**.

---

## What's inside

### Bubble meter
- 40 bubbles at the default 2,000 kcal goal — each bubble is 50 calories.
- Tap any bubble to set the day's total; a single coalesced “⚡ Bubble top-up” entry keeps the diary tidy.
- Partial bubbles fill from the bottom, overflow appears as extra red dots, and the whole card shifts to a red over-budget state when you pass your goal.
- Landing exactly on your goal triggers confetti. Going over is allowed (and logged honestly).
- A meal plate breakdown shows where the day's calories came from.

### Diary
- Breakfast / Lunch / Dinner / Snacks, with quick-add chips for common foods.
- Type two or more letters in the food field to search the bundled nutrition database in the browser. Each suggestion shows the portion, calories and protein/fat/carbs; pick one to fill every field automatically.
- Macros are optional. Add or edit protein, fat and carbs in grams whenever the dataset does not cover a food.
- Edit or delete any entry, with an **Undo** action on delete.
- Every day is separate. Use the arrows, the date picker, “Back to today”, or ←/→/T keyboard shortcuts to edit previous days.
- Add food to a past date with the same form; toasts confirm which day changed.

### Macros
- Protein, fat and carbs are read from `public/food.csv` and scaled to each food's household portion.
- The **Macro balance** card totals the selected day's grams, draws relative bars, and estimates macro-derived calories (P×4, F×9, C×4).
- Diary rows show a compact `P · F · C` line for every tracked food.
- A seven-day **Macro rhythm** chart stacks daily protein, fat and carbs, so you can spot low-protein or carb-heavy stretches.
- Unknown macros stay `null` rather than becoming zero, so partial data does not pretend to be complete.

### Numbers that matter
- Seven-day average, on-target streak, days logged and hall-of-fame top food.
- 14-day calorie bar chart with the goal line and red over-budget bars.
- Seven-day meal-mix donut (bubble top-ups excluded so it reflects real food).
- Insight cards for logging consistency, pace toward the goal weight, and your most-eaten food.
- TDEE estimate, net balance, weight journey and projected lb/week based on recent intake.

### Users & storage
- Username-only sign-in — no passwords. Case-insensitive keys, display name preserved.
- Recent-user chips on the welcome screen.
- Public mode stores everything in Google Sheets through Apps Script.
- Existing Sheets are upgraded in place: the `Entries` tab gains `protein`, `fat` and `carbs` columns without touching old rows.
- Storage mode is shown in the footer and settings, with a warning if the backend is not configured.

---

## Deploy the public app

You need two things: a Google Apps Script Web App for the database, and GitHub Pages for the frontend.

### 1. Create the Google Sheet and Apps Script

1. Create a spreadsheet at [sheets.new](https://sheets.new). Copy the ID from its URL:
   `https://docs.google.com/spreadsheets/d/`**`<SHEET_ID>`**`/edit`
2. Open **Extensions → Apps Script**.
3. Replace the default `Code.gs` with the contents of [`apps-script/Code.gs`](apps-script/Code.gs).
4. Replace `appsscript.json` with [`apps-script/appsscript.json`](apps-script/appsscript.json). If the manifest is hidden, enable **Project Settings → Show “appsscript.json” manifest file**.
5. Open **Project Settings → Script Properties** and add:
   - `SHEET_ID` = your spreadsheet ID
   - Optional: `SHEET_TAB_ENTRIES` (default `Entries`) and `SHEET_TAB_PROFILES` (default `Profiles`)
6. Optional: change the timezone in `appsscript.json` if `America/New_York` is wrong for you.
7. Click **Deploy → New deployment → Web app**.
   - **Description:** Zest
   - **Execute as:** Me
   - **Who has access:** Anyone
8. Authorize the script. Copy the Web App URL that ends in `/exec`.
9. Open the URL once in a browser. You should see health JSON such as `{"ok":true,"data":{"storage":"sheets",...}}`. The `Entries` and `Profiles` tabs are created on that first request.

If you change `Code.gs` later, use **Deploy → Manage deployments → Edit → New version → Deploy**.

### 2. Connect the frontend

Edit [`public/config.js`](public/config.js) and paste the Web App URL:

```js
window.ZEST_API_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```

Commit and push that change. If this is blank on GitHub Pages, the welcome screen shows a **Backend not connected** warning and login cannot load data.

### 3. Turn on GitHub Pages

1. In the GitHub repository, open **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` (or run the **Deploy Zest to GitHub Pages** workflow manually).
4. The site appears at `https://<owner>.github.io/zest/`.

The workflow is [`.github/workflows/pages.yml`](.github/workflows/pages.yml). It publishes only `public/`, so `server.js`, `lib/`, `data/` and credentials never reach the public site.

---

## Optional: local Node + Google Sheets

The local server can still write to Google Sheets with a service account instead of `data/db.json`. This is only for development; the public Pages build never sees these credentials.

1. Enable the Google Sheets API in a Google Cloud project.
2. Create a service account and download a JSON key.
3. Share the spreadsheet with the service account's `client_email` as **Editor**.
4. Run:
   ```bash
   cp .env.example .env
   ```
   Set `SHEET_ID` and either keep the key as `credentials.json`, put it in `GOOGLE_SERVICE_ACCOUNT_JSON`, or set `GOOGLE_SA_EMAIL` + `GOOGLE_PRIVATE_KEY`.
5. Restart `node server.js`. The `Entries` and `Profiles` tabs are created automatically.

If Sheets is configured but unreachable, the local server falls back to `data/db.json` and shows a warning.

---

## Environment variables (local server)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4173` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` to expose on the LAN) |
| `SHEET_ID` | — | Spreadsheet ID; blank means local mode |
| `GOOGLE_APPLICATION_CREDENTIALS` | `credentials.json` if present | Service-account key file |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | — | Full service-account JSON as one string |
| `GOOGLE_SA_EMAIL` / `GOOGLE_PRIVATE_KEY` | — | Split service-account credentials |
| `SHEET_TAB_ENTRIES` | `Entries` | Diary tab name |
| `SHEET_TAB_PROFILES` | `Profiles` | Profiles tab name |
| `FORCE_LOCAL` | `0` | Set to `1` to ignore Sheets and use local storage |

`.env` is read automatically at startup. Existing environment variables take precedence.

---

## Project layout

```
.
├── .github/workflows
│   └── pages.yml          Build + deploy public/ to GitHub Pages
├── apps-script
│   ├── Code.gs            Google Sheets backend + JSONP routes
│   └── appsscript.json    Web App manifest (runs as owner, anyone can call)
├── server.js              Local HTTP server, API routes, static serving
├── lib                    Local Node backend
│   ├── defaults.js        Seed profile + validation/sanitisation
│   ├── env.js             Tiny .env loader
│   ├── foods.js           CSV parser, portion math, ranked food search
│   ├── local-store.js     JSON-file storage backend
│   ├── sheets.js          Google Sheets REST client + JWT auth
│   ├── store.js           Sheets/local mode selection + fallback
│   └── utils.js           Dates, user normalisation, small helpers
├── public                 Everything GitHub Pages publishes
│   ├── index.html         App shell, welcome gate, modals
│   ├── styles.css         Orange-on-white design + responsive rules
│   ├── config.js          window.ZEST_API_URL (Apps Script Web App)
│   ├── food.csv           Browser-side nutrition dataset
│   ├── .nojekyll
│   └── js
│       ├── app.js         Boot, session, events, actions
│       ├── api.js         JSONP (Apps Script) + localhost fetch adapter
│       ├── foods.js       Browser CSV parser + ranked food search
│       ├── state.js       Shared state + day helpers
│       ├── render.js      DOM rendering, plate, macros, insights
│       ├── charts.js      Hand-rolled SVG bar, donut and macro charts
│       ├── util.js        Dates, macros, TDEE/projection, constants
│       └── ui.js          Toasts, modals, confetti
└── data/db.json           Local dev store (created on first run)
```

### Frontend → backend mapping

The frontend still calls the same paths everywhere. `public/js/api.js` converts them to Apps Script actions:

| Frontend call | Apps Script action | Purpose |
| --- | --- | --- |
| `GET /api/health` | `health` | Storage mode, sheet URL, today's date |
| `GET /api/users` | `users` | Recent profiles for the welcome screen |
| `GET / PUT /api/profile?user=` | `profile` | Read or update a profile |
| `GET /api/day?user=&date=` | `day` | Entries and totals for one day |
| `GET /api/history?user=&from=&to=` | `history` | Entries in a date range (max 500 days) |
| `POST /api/entries` | `entries` | Add a food entry |
| `PATCH / DELETE /api/entries/:id?user=` | `entry` | Edit or remove an entry |
| `PUT /api/day/topup` | `topup` | Set a day's total via the bubble meter |

Apps Script always answers HTTP 200, so responses are wrapped as `{ ok, data }` or `{ ok: false, error }` and unwrapped in `api.js`.

---

## Troubleshooting

- **“Backend not connected” on the welcome screen:** `public/config.js` has no `ZEST_API_URL`. Paste the `/exec` Web App URL and redeploy Pages.
- **Login spins, then says the backend did not respond:** the Apps Script deployment is probably not public. Set **Who has access** to **Anyone**, create a new deployment version, and confirm the URL ends in `/exec`. Opening the URL directly should show JSON, not a Google login page.
- **“Could not open the Google Sheet”:** check the `SHEET_ID` script property and make sure the deploying Google account can edit the Sheet.
- **Food search returns nothing:** confirm `public/food.csv` is present and served over HTTP (not opened as a `file://` page). Searching needs at least two characters.
- **Port already in use locally:** change `PORT` in `.env` or stop the other process.
- **Local mode instead of Sheets:** on localhost the app deliberately uses the Node API. Open `http://127.0.0.1:4173/?remote` to force the public Apps Script backend while developing.
- **Start fresh locally:** stop the server, delete `data/db.json`, start again.
- **Calories look high for a portion:** the dataset reports calories for its first household measure (e.g. 1 cup). Pick the food and edit the calorie field to match what you actually ate.

---

Built for the “count the bites, keep the zest” brief. 🍊
