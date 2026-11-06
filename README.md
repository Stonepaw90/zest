# 🍊 Zest — a calorie counter with zest

A polished, zero-dependency calorie tracker built around a tactile bubble meter. Tap a bubble for every 50 calories, log real meals, browse a 7,400-food nutrition database, and watch your streaks, trend lines, macro balance and weight projection update in real time.

Each username gets its own diary, goals and history. Data lives in a local JSON file by default, or in a Google Sheet when credentials are configured.

![stack](https://img.shields.io/badge/Node.js-20%2B-3c873a) ![deps](https://img.shields.io/badge/dependencies-0-f97316)

---

## Quick start

```bash
# From this folder
node server.js
```

Open **http://127.0.0.1:4173**, type a username, and start counting.

- No `npm install` and no build step.
- Requires Node.js 20 or newer (uses the built-in `fetch` and `crypto`).
- `npm start` also works. `npm run dev` restarts on file changes.

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
- Type two or more letters in the food field to search the bundled nutrition database. Each suggestion shows the portion, calories and protein/fat/carbs; pick one to fill every field automatically.
- Macros are optional. Add or edit protein, fat and carbs in grams whenever the dataset does not cover a food.
- Edit or delete any entry, with an **Undo** action on delete.
- Every day is separate. Use the arrows, the date picker, “Back to today”, or ←/→/T keyboard shortcuts to edit previous days.
- Add food to a past date with the same form; toasts confirm which day changed.

### Macros
- Protein, fat and carbs are read from `food.csv` and scaled to each food's household portion.
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
- Local JSON storage by default, or Google Sheets with automatic tab/header provisioning.
- Existing Sheets are upgraded in place: the `Entries` tab gains `protein`, `fat` and `carbs` columns without touching old rows.
- Storage mode is shown in the footer and settings, with a warning toast if Sheets is configured but unreachable.

---

## Google Sheets setup (optional)

The app works immediately with local storage. To sync to a spreadsheet:

1. **Create a Google Sheet** at [sheets.new](https://sheets.new). Copy the ID from the URL:
   `https://docs.google.com/spreadsheets/d/`**`<SHEET_ID>`**`/edit`
2. **Enable the Google Sheets API** in a Google Cloud project:
   - Create a project at [console.cloud.google.com](https://console.cloud.google.com/).
   - APIs & Services → Library → Google Sheets API → Enable.
3. **Create a service account**:
   - APIs & Services → Credentials → Create credentials → Service account.
   - Open the account → Keys → Add key → Create new key → JSON.
   - Download the JSON file.
4. **Share the spreadsheet** with the service account's `client_email` (looks like `zest@your-project.iam.gserviceaccount.com`) and give it **Editor** access.
5. **Configure the app**:
   ```bash
   cp .env.example .env
   ```
   Then set `SHEET_ID` and either:
   - keep the downloaded key as `credentials.json` in this folder, or
   - put its full contents in `GOOGLE_SERVICE_ACCOUNT_JSON`, or
   - set `GOOGLE_SA_EMAIL` and `GOOGLE_PRIVATE_KEY` separately.
6. Restart the server. The `Entries` and `Profiles` tabs are created automatically with headers.

If Google Sheets is configured but cannot be reached, Zest falls back to `data/db.json` and shows a warning instead of losing the app.

> **Security note:** usernames are a convenience, not authentication. Anyone who can reach the app can open any username's diary. Keep it on localhost or a trusted private network, and don't expose it publicly without adding real auth.

---

## Environment variables

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
├── server.js              HTTP server, API routes, static file serving
├── food.csv               USDA-style nutrition dataset (7,400 foods)
├── lib
│   ├── defaults.js        Seed profile + validation/sanitisation
│   ├── env.js             Tiny .env loader
│   ├── foods.js           CSV parser, portion math, ranked food search
│   ├── local-store.js     JSON-file storage backend
│   ├── sheets.js          Google Sheets REST client + JWT auth
│   ├── store.js           Sheets/local mode selection + fallback
│   └── utils.js           Dates, user normalisation, small helpers
├── public
│   ├── index.html         App shell, welcome gate, modals
│   ├── styles.css         Orange-on-white design + responsive rules
│   └── js
│       ├── app.js         Boot, session, events, actions, food search
│       ├── state.js       Shared state + day helpers
│       ├── render.js      DOM rendering, plate, macros, insights
│       ├── charts.js      Hand-rolled SVG bar, donut and macro charts
│       ├── util.js        Dates, macros, TDEE/projection, constants
│       ├── ui.js          Toasts, modals, confetti
│       └── api.js         Fetch wrapper
└── data/db.json           Local store (created on first run)
```

### API sketch

All routes are JSON. User identity is passed as `?user=` or in the body.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Storage mode, warning, today's date |
| `GET` | `/api/users` | Recent profiles for the welcome screen |
| `GET` / `PUT` | `/api/profile?user=` | Read or update a profile |
| `GET` | `/api/day?user=&date=` | Entries and totals for one day |
| `GET` | `/api/history?user=&from=&to=` | Entries in a date range (max 500 days) |
| `POST` | `/api/entries` | Add a food entry (optional `protein`, `fat`, `carbs` grams) |
| `PATCH` / `DELETE` | `/api/entries/:id?user=` | Edit or remove an entry |
| `PUT` | `/api/day/topup` | Set a day's total via the bubble meter |
| `GET` | `/api/foods?q=` | Search the bundled nutrition dataset; results include per-portion macros |

---

## Notes & troubleshooting

- **Port already in use:** change `PORT` in `.env` or stop the other process.
- **Google Sheets permission error:** share the sheet with the service account email as Editor and double-check `SHEET_ID`.
- **Start fresh locally:** stop the server, delete `data/db.json`, start again.
- **Food search returns nothing:** confirm `food.csv` sits next to `server.js`. Searching needs at least two characters.
- **Calories look high for a portion:** the dataset reports calories for its first household measure (e.g. 1 cup). Pick the food and edit the calorie field to match what you actually ate.
- **Local time:** “today” is based on the server machine's local clock. The header date is the source of truth for the diary.

---

Built for the “count the bites, keep the zest” brief. 🍊
