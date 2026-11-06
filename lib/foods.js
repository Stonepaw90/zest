import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '..', 'food.csv');

let foods = null;

/* Minimal RFC-4180 CSV reader: handles quoted commas, escaped quotes and CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const ABBREVIATIONS = new Map(Object.entries({
  applsauc: 'applesauce',
  bld: 'boiled',
  brstd: 'braised',
  chix: 'chicken',
  choc: 'chocolate',
  chs: 'cheese',
  ckd: 'cooked',
  crl: 'cereal',
  dehyd: 'dehydrated',
  frz: 'frozen',
  grld: 'grilled',
  hmk: 'homemade',
  jr: 'junior',
  lofat: 'low-fat',
  lt: 'light',
  mxd: 'mixed',
  nonfat: 'non-fat',
  pdr: 'powder',
  pln: 'plain',
  prep: 'prepared',
  prot: 'protein',
  reg: 'regular',
  rstd: 'roasted',
  rte: 'ready-to-eat',
  skn: 'skin',
  stewd: 'stewed',
  stk: 'stick',
  swt: 'sweet',
  unckd: 'uncooked',
  veg: 'vegetable',
}));

function titleCase(value) {
  const small = new Set(['and', 'or', 'with', 'without', 'of', 'in', 'the', 'a', 'an']);
  let text = ` ${value.toLowerCase()} `
    .replace(/\bw\/lo\b/g, ' with low ')
    .replace(/\bw\/o\b/g, ' without ')
    .replace(/\bw\//g, ' with ')
    .replace(/&/g, ' & ')
    .replace(/,/g, ', ');
  text = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word, index) => {
      const bare = word.replace(/[^a-z0-9-]/g, '');
      const expanded = ABBREVIATIONS.get(bare);
      const next = expanded || word;
      if (index > 0 && small.has(bare)) return next;
      return next.replace(/^([^a-z0-9]*)([a-z])/, (match, prefix, letter) => prefix + letter.toUpperCase());
    })
    .join(' ');
  return text;
}

function loadFoods() {
  if (foods) return foods;
  let text;
  try {
    text = fs.readFileSync(CSV_PATH, 'utf8');
  } catch {
    foods = [];
    return foods;
  }

  const rows = parseCsv(text);
  if (rows.length < 2) {
    foods = [];
    return foods;
  }
  const header = rows[0];
  const column = (name) => header.indexOf(name);
  const descAt = column('Description');
  const categoryAt = column('Category');
  const kcalAt = column('Data.Kilocalories');
  const proteinAt = column('Data.Protein');
  const fatAt = column('Data.Fat.Total Lipid');
  const carbsAt = column('Data.Carbohydrate');
  const gramsAt = column('Data.Household Weights.1st Household Weight');
  const unitAt = column('Data.Household Weights.1st Household Weight Description');

  const seen = new Set();
  const list = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const description = String(row[descAt] || '').trim();
    const kcal100 = Number(row[kcalAt]);
    if (!description || !Number.isFinite(kcal100) || kcal100 <= 0) continue;

    let grams = Number(row[gramsAt]);
    let portionLabel = String(row[unitAt] || '').replace(/\s+/g, ' ').trim();
    if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) {
      grams = 100;
      portionLabel = '100 g';
    }
    if (!portionLabel) portionLabel = `${Math.round(grams)} g`;

    const calories = Math.round((kcal100 * grams) / 100);
    if (!Number.isFinite(calories) || calories <= 0 || calories > 6000) continue;

    const portionNutrient = (value) => {
      const nutrient = Number(value);
      if (!Number.isFinite(nutrient) || nutrient < 0) return 0;
      return Math.round((nutrient * grams) / 10) / 10;
    };
    const protein = portionNutrient(row[proteinAt]);
    const fat = portionNutrient(row[fatAt]);
    const carbs = portionNutrient(row[carbsAt]);

    const name = titleCase(description);
    const key = `${name}|${grams}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const rawCategory = String(row[categoryAt] || '').trim();
    const category = !rawCategory || rawCategory.toLowerCase() === 'no category' ? 'Food' : titleCase(rawCategory);

    list.push({
      name: name.slice(0, 110),
      category,
      calories,
      protein,
      fat,
      carbs,
      grams: Math.round(grams * 10) / 10,
      portionLabel,
      search: `${description} ${row[categoryAt] || ''}`.toLowerCase(),
    });
  }
  foods = list;
  return foods;
}

export function searchFoods(query, limit = 8) {
  const q = String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (q.length < 2) return [];
  const tokens = q.split(' ');
  const cappedLimit = Math.max(1, Math.min(12, Number(limit) || 8));
  const matches = [];

  for (const food of loadFoods()) {
    let matched = true;
    for (const token of tokens) {
      if (!food.search.includes(token)) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;

    let score = 2;
    if (food.search.startsWith(q)) score = 0;
    else if (food.search.includes(` ${q}`)) score = 1;
    const position = food.search.indexOf(q);
    matches.push({ food, score, position, length: food.name.length });
  }

  matches.sort((a, b) => a.score - b.score || a.position - b.position || a.length - b.length || a.food.name.localeCompare(b.food.name));
  return matches.slice(0, cappedLimit).map(({ food }) => ({
    name: food.name,
    category: food.category,
    calories: food.calories,
    protein: food.protein,
    fat: food.fat,
    carbs: food.carbs,
    grams: food.grams,
    portionLabel: food.portionLabel,
  }));
}
