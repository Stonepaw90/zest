/* Hand-rolled SVG charts — no chart library needed. */
import { compact, escapeHtml, fmt, fullDate, MACROS, macroGrams, MEALS, MEAL_COLORS, shortDate } from './util.js';

export function barChartMarkup(days, goal) {
  const W = 760;
  const H = 252;
  const padL = 42;
  const padR = 12;
  const padT = 18;
  const padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const maxTotal = Math.max(goal, ...days.map((d) => d.total), 1);
  const axisMax = Math.max(250, Math.ceil((maxTotal * 1.14) / 250) * 250);
  const slot = innerW / days.length;
  const barW = Math.min(28, slot * 0.58);
  const yFor = (value) => padT + innerH * (1 - value / axisMax);
  const empty = days.every((d) => d.total === 0);

  const parts = [];
  parts.push(
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily calories for the last ${days.length} days">`,
    `<defs>
      <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#fdba74"/>
        <stop offset="55%" stop-color="#fb923c"/>
        <stop offset="100%" stop-color="#f97316"/>
      </linearGradient>
    </defs>`,
  );

  // Focus band behind the selected (last) day.
  parts.push(
    `<rect x="${(padL + slot * (days.length - 1)).toFixed(1)}" y="${padT - 6}" width="${slot.toFixed(1)}" height="${innerH + 10}" rx="10" fill="#f97316" opacity="0.055"/>`,
  );

  // Grid lines + y labels.
  for (const fraction of [0, 0.5, 1]) {
    const value = axisMax * fraction;
    const y = yFor(value).toFixed(1);
    parts.push(
      `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#f4e4d5" stroke-width="1" ${fraction === 0 ? '' : 'stroke-dasharray="3 5"'}/>`,
      `<text x="${padL - 9}" y="${Number(y) + 3.5}" text-anchor="end" font-size="9.5" font-weight="600" fill="#b09a88">${compact(value)}</text>`,
    );
  }

  // Bars.
  days.forEach((day, index) => {
    const x = padL + slot * index + (slot - barW) / 2;
    const total = Number(day.total) || 0;
    const over = total > goal;
    const height = total > 0 ? Math.max(5, (total / axisMax) * innerH) : 3;
    const y = padT + innerH - height;
    const fill = total === 0 ? '#ffead7' : over ? '#ef4444' : 'url(#barGrad)';
    const title = `${fullDate(day.date)} — ${fmt(total)} cal${over ? ' (over goal)' : ''}`;
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${height.toFixed(1)}" rx="${Math.min(7, barW / 2).toFixed(1)}" fill="${fill}" ${total > 0 ? '' : 'opacity="0.75"'}>
        <title>${title}</title>
      </rect>`,
    );
    if (over) {
      parts.push(
        `<circle cx="${(x + barW / 2).toFixed(1)}" cy="${(y - 7).toFixed(1)}" r="2.6" fill="#ef4444"/>`,
      );
    }
    const showLabel = index % 2 === 0 || index === days.length - 1;
    if (showLabel) {
      parts.push(
        `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 13}" text-anchor="middle" font-size="9.5" font-weight="600" fill="#a8917f">${shortDate(day.date)}</text>`,
      );
    }
  });

  // Goal line.
  const goalY = yFor(goal).toFixed(1);
  parts.push(
    `<line x1="${padL}" x2="${W - padR}" y1="${goalY}" y2="${goalY}" stroke="#ea580c" stroke-width="1.5" stroke-dasharray="5 5" opacity="0.55"/>`,
    `<rect x="${W - padR - 82}" y="${(Number(goalY) - 17).toFixed(1)}" width="82" height="16" rx="8" fill="#fff5eb"/>`,
    `<text x="${W - padR - 6}" y="${(Number(goalY) - 6).toFixed(1)}" text-anchor="end" font-size="9.5" font-weight="800" fill="#c2410c">goal ${fmt(goal)}</text>`,
  );

  if (empty) {
    parts.push(
      `<text x="${W / 2}" y="${padT + innerH * 0.42}" text-anchor="middle" font-size="14" font-weight="700" fill="#8c7b6d">No calories logged in this window</text>`,
      `<text x="${W / 2}" y="${padT + innerH * 0.42 + 20}" text-anchor="middle" font-size="11" font-weight="500" fill="#b09a88">Tap a bubble above or add your first bite.</text>`,
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

export function macroChartMarkup(days) {
  const W = 760;
  const H = 240;
  const padL = 42;
  const padR = 12;
  const padT = 18;
  const padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const totals = days.map((day) => day.macros
    ? MACROS.reduce((sum, macro) => sum + (Number(day.macros[macro.key]) || 0), 0)
    : 0);
  const maxTotal = Math.max(...totals, 1);
  const halfStep = maxTotal <= 40 ? 10 : maxTotal <= 120 ? 20 : maxTotal <= 300 ? 50 : 100;
  const axisMax = Math.max(
    halfStep * 2,
    Math.ceil((maxTotal * 1.15) / (halfStep * 2)) * (halfStep * 2),
  );
  const slot = innerW / days.length;
  const barW = Math.min(28, slot * 0.58);
  const yFor = (value) => padT + innerH * (1 - value / axisMax);
  const empty = totals.every((value) => value === 0);
  const parts = [];

  parts.push(
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Protein, fat and carbohydrate grams for the last ${days.length} days">`,
  );

  parts.push(
    `<rect x="${(padL + slot * (days.length - 1)).toFixed(1)}" y="${padT - 6}" width="${slot.toFixed(1)}" height="${innerH + 10}" rx="10" fill="#f97316" opacity="0.055"/>`,
  );

  for (const fraction of [0, 0.5, 1]) {
    const value = axisMax * fraction;
    const y = yFor(value).toFixed(1);
    parts.push(
      `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#f4e4d5" stroke-width="1" ${fraction === 0 ? '' : 'stroke-dasharray="3 5"'}/>`,
      `<text x="${padL - 9}" y="${Number(y) + 3.5}" text-anchor="end" font-size="9.5" font-weight="600" fill="#b09a88">${Math.round(value)}g</text>`,
    );
  }

  days.forEach((day, index) => {
    const x = padL + slot * index + (slot - barW) / 2;
    let stack = 0;
    const segments = [];
    for (const macro of MACROS) {
      const grams = Number(day.macros?.[macro.key]) || 0;
      if (grams <= 0) continue;
      const height = (grams / axisMax) * innerH;
      const y = padT + innerH - stack - height;
      segments.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${height.toFixed(1)}" fill="${macro.color}">
          <title>${fullDate(day.date)} — ${macro.label} ${macroGrams(grams)} g</title>
        </rect>`,
      );
      stack += height;
    }
    if (!segments.length) {
      segments.push(
        `<rect x="${x.toFixed(1)}" y="${(padT + innerH - 3).toFixed(1)}" width="${barW.toFixed(1)}" height="3" rx="1.5" fill="#ffead7"/>`,
      );
    }
    parts.push(segments.join(''));
    if (index % 2 === 0 || index === days.length - 1) {
      parts.push(
        `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 13}" text-anchor="middle" font-size="9.5" font-weight="600" fill="#a8917f">${shortDate(day.date)}</text>`,
      );
    }
  });

  if (empty) {
    parts.push(
      `<text x="${W / 2}" y="${padT + innerH * 0.42}" text-anchor="middle" font-size="14" font-weight="700" fill="#8c7b6d">No macros logged in this window</text>`,
      `<text x="${W / 2}" y="${padT + innerH * 0.42 + 20}" text-anchor="middle" font-size="11" font-weight="500" fill="#b09a88">Pick a food from search and protein, fat and carbs come along.</text>`,
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

export function donutMarkup(meals, total) {
  const size = 190;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 66;
  const stroke = 23;
  const circumference = 2 * Math.PI * radius;
  const gap = 3;
  let offset = 0;
  const arcs = [];

  arcs.push(
    `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#fff1e2" stroke-width="${stroke}"/>`,
  );

  if (total > 0) {
    const active = MEALS.filter((meal) => (meals[meal] || 0) > 0);
    active.forEach((meal, index) => {
      const value = meals[meal] || 0;
      const share = value / total;
      const length = share * circumference;
      const visible = Math.max(1.5, length - (active.length > 1 ? gap : 0));
      const dash = `${visible.toFixed(2)} ${(circumference - visible).toFixed(2)}`;
      arcs.push(
        `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${MEAL_COLORS[meal]}" stroke-width="${stroke}" stroke-dasharray="${dash}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="round">
          <title>${meal}: ${fmt(value)} cal (${Math.round(share * 100)}%)</title>
        </circle>`,
      );
      offset += length;
    });
  }

  const svg = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Calories by meal">${arcs.join('')}</svg>`;
  const center = `<div class="donut-center"><strong>${fmt(total)}</strong><span>food kcal</span></div>`;

  const legend = total > 0
    ? MEALS.map((meal) => {
        const value = meals[meal] || 0;
        const pct = Math.round((value / total) * 100);
        return `<div class="legend-row">
          <i style="background:${MEAL_COLORS[meal]}"></i>
          <span class="l-name">${escapeHtml(meal)}</span>
          <span class="l-cal">${fmt(value)}</span>
          <span class="l-pct">${pct}%</span>
        </div>`;
      }).join('')
    : '<p class="donut-empty">No meals logged in this 7-day window.<br />Your first snack will show up here.</p>';

  return { svg, center, legend };
}
