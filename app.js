/*
 * Vacation Balance Planner — app.js (refactored, no holiday logic)
 *
 * This script powers an interactive vacation balance planner.
 * It supports bi‑weekly accruals, calculating balances on demand,
 * managing planned time off in date ranges, adding extra credits,
 * and visualising the next year’s balance in a line chart.
 *
 * The code is organized into logical sections: helper functions
 * for dates and pay schedule calculations, state management,
 * core calculations for balances, rendering functions for the UI,
 * event wiring, and chart drawing helpers. Holiday logic has
 * intentionally been omitted – weekends are skipped but holidays
 * must be added manually as PTO ranges or credits.
 */

/* =========================
 * Helpers & date utilities
 * ========================= */

const MS_PER_DAY = 86400000;

// Format a number of hours to a string with two decimals and an "h" suffix
function fmt(hours) {
  return `${(Math.round(hours * 100) / 100).toFixed(2)} h`;
}

// Convert a Date object to a YYYY-MM-DD string in UTC.  This helper was
// referenced throughout the code but was previously undefined, causing the
// script to break.  It returns a simple date string without time and is
// used for keys, labels, and comparisons.
function ymd(date) {
  return date.toISOString().slice(0, 10);
}

// Normalize a Date (or date string) to a UTC date (00:00:00Z)
function toDateOnlyUTC(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  // assume Date instance
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

// Clamp a date to just the date part (UTC)
const clampDate = (d) => toDateOnlyUTC(toDateOnlyUTC(d));

// Add n days to a date
function addDays(date, n) {
  return new Date(date.getTime() + n * MS_PER_DAY);
}

// Count days between two dates (inclusive) and return an integer
function daysBetween(a, b) {
  return Math.floor((clampDate(b) - clampDate(a)) / MS_PER_DAY);
}

// Determine if a date is a weekday (Mon–Fri)
function isWeekday(date) {
  const day = clampDate(date).getUTCDay();
  return day !== 0 && day !== 6;
}

// Count weekdays (Mon–Fri) between two dates inclusive
function weekdaysBetweenInclusive(fromDate, toDate) {
  let from = clampDate(fromDate);
  let to = clampDate(toDate);
  if (to < from) return 0;
  let count = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (isWeekday(d)) count++;
  }
  return count;
}

/* =========================
 * Pay schedule helpers
 * ========================= */

// Return the number of paydays that have occurred from the first payday up to targetDate
function countPaydays(firstPayday, targetDate, frequencyDays) {
  const start = clampDate(firstPayday);
  const end = clampDate(targetDate);
  if (end < start) return 0;
  const diffDays = daysBetween(start, end);
  return Math.floor(diffDays / frequencyDays) + 1;
}

// Get the next payday on or after a given date
function nextPaydayOnOrAfter(date, firstPayday, frequencyDays) {
  const d = clampDate(date);
  const first = clampDate(firstPayday);
  if (d <= first) return first;
  const diff = daysBetween(first, d);
  const steps = Math.ceil(diff / frequencyDays);
  return addDays(first, steps * frequencyDays);
}

// Generate an array of payday dates between a start and end date (inclusive)
function getPaydaysBetween(startDate, endDate, firstPayday, frequencyDays) {
  const result = [];
  const start = clampDate(startDate);
  const end = clampDate(endDate);
  let next = nextPaydayOnOrAfter(start, firstPayday, frequencyDays);
  while (next <= end) {
    result.push(next);
    next = addDays(next, frequencyDays);
  }
  return result;
}

/* =========================
 * Application state
 * ========================= */

// Default settings and data structures
const DEFAULTS = {
  startDate: '2026-01-01',
  startBalance: -15.78,
  accrualPerPeriod: 4.61,
  firstPayday: '2026-01-08',
  payFrequencyDays: 14,
  ptoRanges: [],
  credits: [],
};

let state = loadState();

// Load state from localStorage or fall back to defaults
function loadState() {
  try {
    const raw = localStorage.getItem('vacation_planner_state_v3');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULTS,
        ...parsed,
        ptoRanges: Array.isArray(parsed.ptoRanges) ? parsed.ptoRanges : [],
        credits: Array.isArray(parsed.credits) ? parsed.credits : [],
      };
    }
    return { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

// Persist state to localStorage
function saveState() {
  localStorage.setItem('vacation_planner_state_v3', JSON.stringify(state));
}

/* =========================
 * Core calculations
 * ========================= */

// Calculate PTO hours used up to and including a target date
function ptoHoursUpTo(targetDateStr) {
  const target = toDateOnlyUTC(targetDateStr);
  let hours = 0;
  for (const r of state.ptoRanges) {
    const from = toDateOnlyUTC(r.from);
    const to = toDateOnlyUTC(r.to);
    if (from > target) continue;
    const end = to <= target ? to : target;
    hours += weekdaysBetweenInclusive(from, end) * 8;
  }
  return hours;
}

// Calculate credit hours earned up to and including a target date
function creditHoursUpTo(targetDateStr) {
  const target = toDateOnlyUTC(targetDateStr);
  let hours = 0;
  for (const c of state.credits) {
    const d = toDateOnlyUTC(c.date);
    if (d <= target) hours += Math.max(0, Number(c.hours) || 0);
  }
  return hours;
}

// Get the balance on a specific date
function getBalanceOn(targetDateStr) {
  const target = toDateOnlyUTC(targetDateStr);
  const firstPayday = toDateOnlyUTC(state.firstPayday);
  const accrual = Number(state.accrualPerPeriod) || 0;
  const freq = Number(state.payFrequencyDays) || 14;
  let balance = Number(state.startBalance) || 0;
  if (target >= firstPayday) {
    const periods = countPaydays(firstPayday, target, freq);
    balance += periods * accrual;
  }
  balance -= ptoHoursUpTo(targetDateStr);
  balance += creditHoursUpTo(targetDateStr);
  return balance;
}

// Find the latest date of any PTO range (for dashboard)
function latestPTODate() {
  if (!state.ptoRanges.length) return null;
  return state.ptoRanges
    .map((r) => toDateOnlyUTC(r.to))
    .sort((a, b) => b - a)[0];
}

// Compute total planned PTO hours in the future from a given date
function totalFuturePTO(fromDateStr) {
  const from = toDateOnlyUTC(fromDateStr);
  let hours = 0;
  for (const r of state.ptoRanges) {
    const fromDate = toDateOnlyUTC(r.from);
    const toDate = toDateOnlyUTC(r.to);
    if (toDate < from) continue;
    const start = fromDate < from ? from : fromDate;
    hours += weekdaysBetweenInclusive(start, toDate) * 8;
  }
  return hours;
}

/* =========================
 * Rendering helpers
 * ========================= */

function renderSettings() {
  document.getElementById('startDate').value = state.startDate;
  document.getElementById('startBalance').value = state.startBalance;
  document.getElementById('accrualPerPeriod').value = state.accrualPerPeriod;
  document.getElementById('firstPayday').value = state.firstPayday;
  document.getElementById('payFrequencyDays').value = state.payFrequencyDays;
}

function renderDashboard() {
  const today = clampDate(new Date());
  document.getElementById('todayLabel').textContent = ymd(today);
  document.getElementById('balanceToday').textContent = fmt(getBalanceOn(ymd(today)));
  const latest = latestPTODate();
  document.getElementById('balanceAfterLatest').textContent = fmt(getBalanceOn(ymd(latest || today)));
  document.getElementById('totalFuturePTO').textContent = fmt(totalFuturePTO(ymd(today)));
  const next = nextPaydayOnOrAfter(today, toDateOnlyUTC(state.firstPayday), state.payFrequencyDays);
  document.getElementById('nextPayday').textContent = ymd(next);
}

function renderPTOTable() {
  const tbody = document.getElementById('ptoTable');
  tbody.innerHTML = '';
  state.ptoRanges
    .sort((a, b) => toDateOnlyUTC(a.from) - toDateOnlyUTC(b.from))
    .forEach((r, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'border-t';
      tr.innerHTML = `
        <td class="py-2">${r.from}</td>
        <td class="py-2">${r.to}</td>
        <td class="py-2">${fmt(Math.max(0, Number(r.hours) || 0))}</td>
        <td class="py-2">${r.note ? r.note.replace(/</g, '&lt;') : ''}</td>
        <td class="py-2">
          <button data-idx="${idx}" class="deletePTO text-red-600 hover:underline">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  [...tbody.querySelectorAll('.deletePTO')].forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      const i = Number(ev.currentTarget.getAttribute('data-idx'));
      state.ptoRanges.splice(i, 1);
      saveState();
      renderAll();
    });
  });
}

function renderCreditsTable() {
  const tbody = document.getElementById('creditTable');
  tbody.innerHTML = '';
  state.credits
    .sort((a, b) => toDateOnlyUTC(a.date) - toDateOnlyUTC(b.date))
    .forEach((c, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'border-t';
      tr.innerHTML = `
        <td class="py-2">${c.date}</td>
        <td class="py-2">${fmt(Math.max(0, Number(c.hours) || 0))}</td>
        <td class="py-2">${c.note ? c.note.replace(/</g, '&lt;') : ''}</td>
        <td class="py-2">
          <button data-idx="${idx}" class="deleteCredit text-red-600 hover:underline">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  [...tbody.querySelectorAll('.deleteCredit')].forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      const i = Number(ev.currentTarget.getAttribute('data-idx'));
      state.credits.splice(i, 1);
      saveState();
      renderAll();
    });
  });
}

function renderAll() {
  renderSettings();
  renderDashboard();
  renderPTOTable();
  renderCreditsTable();
  updatePTOPreview();
}

/* =========================
 * UI event handlers
 * ========================= */

// Update the PTO preview when date inputs change
function updatePTOPreview() {
  const fromVal = document.getElementById('ptoFrom').value;
  const toVal = document.getElementById('ptoTo').value;
  if (!fromVal || !toVal) {
    document.getElementById('ptoCalcHours').value = '';
    return;
    }
  const from = toDateOnlyUTC(fromVal);
  const to = toDateOnlyUTC(toVal);
  if (to < from) {
    document.getElementById('ptoCalcHours').value = '0';
    return;
  }
  const days = weekdaysBetweenInclusive(from, to);
  document.getElementById('ptoCalcHours').value = (days * 8).toFixed(2);
}

// Switch between Overview and Forecast tabs
function setTabButtonStyles(active) {
  const btnOverview = document.getElementById('tabOverview');
  const btnForecast = document.getElementById('tabForecast');
  const activeCls = ['bg-gray-900', 'text-white'];
  const inactiveCls = ['bg-white', 'border', 'text-gray-900'];
  [btnOverview, btnForecast].forEach((b) => b.classList.remove(...activeCls, ...inactiveCls));
  if (active === 'Overview') {
    btnOverview.classList.add(...activeCls);
    btnForecast.classList.add(...inactiveCls);
  } else {
    btnForecast.classList.add(...activeCls);
    btnOverview.classList.add(...inactiveCls);
  }
}

function switchTab(tab) {
  const overview = document.getElementById('tab-Overview');
  const forecast = document.getElementById('tab-Forecast');
  if (tab === 'Forecast') {
    overview.classList.add('hidden');
    forecast.classList.remove('hidden');
    setTabButtonStyles('Forecast');
    // Ensure dataset.mode exists before drawing
    if (!document.body.dataset.mode) document.body.dataset.mode = 'year';
    requestAnimationFrame(drawCurrentForecast);
  } else {
    forecast.classList.add('hidden');
    overview.classList.remove('hidden');
    setTabButtonStyles('Overview');
  }
}

function wireUIEvents() {
  document.getElementById('saveSettings').addEventListener('click', () => {
    state.startDate = document.getElementById('startDate').value || state.startDate;
    state.startBalance = Number(document.getElementById('startBalance').value);
    state.accrualPerPeriod = Number(document.getElementById('accrualPerPeriod').value);
    state.firstPayday = document.getElementById('firstPayday').value || state.firstPayday;
    state.payFrequencyDays = Number(document.getElementById('payFrequencyDays').value);
    saveState();
    renderAll();
  });
  document.getElementById('recalc').addEventListener('click', renderAll);
  document.getElementById('computeProjection').addEventListener('click', () => {
    const date = document.getElementById('projectionDate').value;
    document.getElementById('projectionResult').textContent = date ? fmt(getBalanceOn(date)) : 'Pick a date';
  });
  document.getElementById('ptoFrom').addEventListener('change', updatePTOPreview);
  document.getElementById('ptoTo').addEventListener('change', updatePTOPreview);
  document.getElementById('addPTO').addEventListener('click', () => {
    const from = document.getElementById('ptoFrom').value;
    const to = document.getElementById('ptoTo').value;
    const note = document.getElementById('ptoNote').value.trim();
    if (!from || !to) return alert('Enter both from and to dates.');
    const f = toDateOnlyUTC(from);
    const t = toDateOnlyUTC(to);
    if (t < f) return alert('The "to" date must not be before the "from" date.');
    const hours = weekdaysBetweenInclusive(f, t) * 8;
    state.ptoRanges.push({ from, to, hours, note });
    saveState();
    document.getElementById('ptoFrom').value = '';
    document.getElementById('ptoTo').value = '';
    document.getElementById('ptoNote').value = '';
    document.getElementById('ptoCalcHours').value = '';
    renderAll();
  });
  document.getElementById('addCredit').addEventListener('click', () => {
    const date = document.getElementById('creditDate').value;
    const hours = Number(document.getElementById('creditHours').value);
    const note = document.getElementById('creditNote').value.trim();
    if (!date || !isFinite(hours) || hours <= 0) return alert('Enter a valid date and positive hours.');
    state.credits.push({ date, hours, note });
    saveState();
    document.getElementById('creditDate').value = '';
    document.getElementById('creditHours').value = '';
    document.getElementById('creditNote').value = '';
    renderAll();
  });
  document.getElementById('exportBtn').addEventListener('click', () => {
    const dataStr = JSON.stringify(state, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vacation_planner_state.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
  document.getElementById('importInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        state = { ...DEFAULTS, ...imported };
        state.ptoRanges = Array.isArray(imported.ptoRanges) ? imported.ptoRanges : [];
        state.credits = Array.isArray(imported.credits) ? imported.credits : [];
        saveState();
        renderAll();
      } catch {
        alert('Could not import the file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
  // Delegate tab switching and forecast controls
  document.addEventListener('click', (e) => {
    const forecastBtn = e.target.closest('button#tabForecast');
    const overviewBtn = e.target.closest('button#tabOverview');
    if (forecastBtn) {
      switchTab('Forecast');
      return;
    }
    if (overviewBtn) {
      switchTab('Overview');
      return;
    }
    if (e.target.id === 'regenForecast') {
      drawCurrentForecast();
    } else if (e.target.id === 'exportForecastCsv') {
      exportForecastCsv();
    } else if (e.target.id === 'modeYear') {
      document.body.dataset.mode = 'year';
      document.getElementById('forecastYearWrap').classList.remove('hidden');
      document.getElementById('forecastSplitWrap').classList.add('hidden');
      drawForecastYear();
    } else if (e.target.id === 'modeSplit') {
      document.body.dataset.mode = 'split';
      document.getElementById('forecastYearWrap').classList.add('hidden');
      document.getElementById('forecastSplitWrap').classList.remove('hidden');
      drawForecastSplit();
    }
  });
  window.addEventListener('resize', () => {
    const forecast = document.getElementById('tab-Forecast');
    if (!forecast.classList.contains('hidden')) drawCurrentForecast();
  });
}

/* =========================
 * Chart drawing helpers
 * ========================= */

function forecastSeries(startDate, days) {
  const series = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(startDate, i);
    series.push({ date: d, y: getBalanceOn(ymd(d)) });
  }
  return series;
}

function setupCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const widthCss = canvas.clientWidth || 600;
  const heightCss = canvas.clientHeight || 300;
  canvas.width = Math.floor(widthCss * ratio);
  canvas.height = Math.floor(heightCss * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, widthCss, heightCss);
  return { ctx, widthCss, heightCss };
}

function drawLineChart(canvas, series) {
  if (!canvas || !series.length) return;
  const { ctx, widthCss, heightCss } = setupCanvas(canvas);
  const pad = { l: 48, r: 12, t: 12, b: 28 };
  const W = Math.max(1, widthCss - pad.l - pad.r);
  const H = Math.max(1, heightCss - pad.t - pad.b);
  let yMin = Math.min(...series.map((p) => p.y));
  let yMax = Math.max(...series.map((p) => p.y));
  const padY = (yMax - yMin) * 0.05 || 1;
  yMin -= padY;
  yMax += padY;
  const xs = (i) => pad.l + (i / Math.max(1, series.length - 1)) * W;
  const ys = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * H;
  // Axes
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t + H);
  ctx.lineTo(pad.l + W, pad.t + H);
  ctx.stroke();
  // Y ticks and grid
  ctx.fillStyle = '#6b7280';
  ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const val = yMin + (i / ticks) * (yMax - yMin);
    const y = ys(val);
    ctx.strokeStyle = '#f3f4f6';
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + W, y);
    ctx.stroke();
    ctx.fillText(val.toFixed(1), 4, y + 4);
  }
  // Month separators and labels (display month/day and angle the text downward)
  for (let i = 0; i < series.length; i++) {
    const d = series[i].date;
    // Place tick at the first day of each month
    if (d.getUTCDate() === 1) {
      const x = xs(i);
      // draw vertical grid line
      ctx.strokeStyle = '#f3f4f6';
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + H);
      ctx.stroke();
      // format label as M/D without the year and rotate it slightly
      const month = d.getUTCMonth() + 1;
      const day = d.getUTCDate();
      const label = `${month}/${day}`;
      ctx.fillStyle = '#6b7280';
      ctx.save();
      // translate to the x position and below the chart, then rotate
      ctx.translate(x, pad.t + H + 22);
      ctx.rotate(-Math.PI / 4); // 45 degrees downward
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
  // Line path
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(xs(0), ys(series[0].y));
  for (let i = 1; i < series.length; i++) {
    ctx.lineTo(xs(i), ys(series[i].y));
  }
  ctx.stroke();
  // Save for hover interactions and payday labeling
  canvas._forecastData = { series, pad, W, H, yMin, yMax };
}

function labelPaydays(canvas, seriesStart, series) {
  if (!canvas || !canvas._forecastData) return;
  const { pad, W, H, yMin, yMax } = canvas._forecastData;
  const ctx = canvas.getContext('2d');
  const xs = (i) => pad.l + (i / Math.max(1, series.length - 1)) * W;
  const ys = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * H;
  const endDate = addDays(seriesStart, series.length - 1);
  const paydays = getPaydaysBetween(seriesStart, endDate, toDateOnlyUTC(state.firstPayday), state.payFrequencyDays);
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  for (const pay of paydays) {
    const idx = daysBetween(seriesStart, pay);
    if (idx < 0 || idx >= series.length) continue;
    const x = xs(idx);
    const y = ys(series[idx].y);
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Display whole hours rounded down (floor) for accrual labels
    const wholeHours = Math.floor(series[idx].y);
    ctx.fillText(String(wholeHours), x, y - 6);
  }
}

function handleHover(event, canvas, hoverId) {
  if (!canvas || !canvas._forecastData) return;
  const { series, pad, W } = canvas._forecastData;
  const rect = canvas.getBoundingClientRect();
  const xCss = event.clientX - rect.left;
  const idx = Math.round(((xCss - pad.l) / W) * (series.length - 1));
  const i = Math.max(0, Math.min(idx, series.length - 1));
  const p = series[i];
  const hoverEl = document.getElementById(hoverId);
  if (hoverEl) hoverEl.textContent = `${p.date.toISOString().slice(0, 10)} → ${p.y.toFixed(2)} h`;
}

function drawForecastYear() {
  const today = clampDate(new Date());
  const series = forecastSeries(today, 365);
  const canvas = document.getElementById('forecastCanvasYear');
  drawLineChart(canvas, series);
  labelPaydays(canvas, today, series);
  canvas.onmousemove = (ev) => handleHover(ev, canvas, 'forecastHoverYear');
}

function drawForecastSplit() {
  const today = clampDate(new Date());
  const mid = addDays(today, 182);
  const s1 = forecastSeries(today, 182);
  const s2 = forecastSeries(mid, 365 - 182);
  const c1 = document.getElementById('forecastCanvasH1');
  const c2 = document.getElementById('forecastCanvasH2');
  drawLineChart(c1, s1);
  labelPaydays(c1, today, s1);
  c1.onmousemove = (ev) => handleHover(ev, c1, 'forecastHoverH1');
  drawLineChart(c2, s2);
  labelPaydays(c2, mid, s2);
  c2.onmousemove = (ev) => handleHover(ev, c2, 'forecastHoverH2');
}

function drawCurrentForecast() {
  if (document.body.dataset.mode === 'split') drawForecastSplit();
  else drawForecastYear();
}

function exportForecastCsv() {
  const canvas = document.body.dataset.mode === 'split' ? document.getElementById('forecastCanvasH1') : document.getElementById('forecastCanvasYear');
  if (!canvas || !canvas._forecastData) return;
  const { series } = canvas._forecastData;
  const rows = ['date,hours', ...series.map((p) => `${p.date.toISOString().slice(0, 10)},${p.y.toFixed(2)}`)];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vacation_forecast.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* =========================
 * Initialization & testing
 * ========================= */

function runTests() {
  // Basic sanity tests for paydays and weekdays
  const assert = (name, cond) => {
    if (!cond) console.error('Test failed:', name);
    else console.log('Test passed:', name);
  };
  assert('Next payday after 2026-01-01 is 2026-01-08', ymd(nextPaydayOnOrAfter(new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 0, 8)), 14)) === '2026-01-08');
  assert('Count paydays between 2026-01-08 and 2026-01-22 is 2', countPaydays(new Date(Date.UTC(2026, 0, 8)), new Date(Date.UTC(2026, 0, 22)), 14) === 2);
  assert('Weekdays from 2026-01-05 to 2026-01-09 is 5', weekdaysBetweenInclusive(new Date(Date.UTC(2026, 0, 5)), new Date(Date.UTC(2026, 0, 9))) === 5);
  assert('Balance on 2026-01-05 equals initial balance', Math.abs(getBalanceOn('2026-01-05') - state.startBalance) < 1e-6);
}

function init() {
  // default mode to year if not set
  if (!document.body.dataset.mode) document.body.dataset.mode = 'year';
  renderAll();
  wireUIEvents();
  // Show forecast page on first load
  switchTab('Forecast');
  runTests();
}

document.addEventListener('DOMContentLoaded', init);