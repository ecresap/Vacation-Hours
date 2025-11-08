/* Vacation Balance Planner — app.js (no holiday logic, cleaner flow) */

/* =========================
   Helpers & Date Utilities
   ========================= */
const MS_PER_DAY = 86400000;
const fmt = (h) => `${(Math.round(h * 100) / 100).toFixed(2)} h`;
const ymd = (d) => d.toISOString().slice(0, 10);

function toDateOnlyUTC(v) {
  if (!v) return null;
  if (typeof v === "string") {
    const [y, m, dd] = v.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, dd));
  }
  return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
}
const clampDate = (d) => toDateOnlyUTC(ymd(toDateOnlyUTC(d)));
const addDays = (d, n) => new Date(d.getTime() + n * MS_PER_DAY);
function daysBetween(a, b) {
  const ms = clampDate(b) - clampDate(a);
  return Math.floor(ms / MS_PER_DAY);
}
function isWeekday(date) {
  const wd = clampDate(date).getUTCDay();
  return wd !== 0 && wd !== 6; // Mon–Fri
}
function weekdaysBetweenInclusive(fromDate, toDate) {
  let from = clampDate(fromDate);
  let to = clampDate(toDate);
  if (to < from) return 0;
  let days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWeekday(d)) days++;
  return days;
}

/* =========================
   Pay Schedules
   ========================= */
function countPaydays(firstPayday, targetDate, freqDays) {
  const start = clampDate(firstPayday);
  const end = clampDate(targetDate);
  if (end < start) return 0;
  const diffDays = daysBetween(start, end);
  return Math.floor(diffDays / freqDays) + 1; // include first if on/before end
}
function nextPaydayOnOrAfter(date, firstPayday, freqDays) {
  const d = clampDate(date);
  const first = clampDate(firstPayday);
  if (d <= first) return first;
  const steps = Math.ceil(daysBetween(first, d) / freqDays);
  return addDays(first, steps * freqDays);
}
function getPaydaysBetween(startDate, endDate, firstPayday, freqDays) {
  const out = [];
  const start = clampDate(startDate);
  const end = clampDate(endDate);
  let pay = nextPaydayOnOrAfter(start, firstPayday, freqDays);
  while (pay <= end) { out.push(pay); pay = addDays(pay, freqDays); }
  return out;
}

/* =========================
   State
   ========================= */
const DEFAULTS = {
  startDate: "2026-01-01",
  startBalance: -15.78,
  accrualPerPeriod: 4.61,
  firstPayday: "2026-01-08", // Biweekly Thursday
  payFrequencyDays: 14,
  ptoRanges: [], // [{from, to, hours, note}]
  credits: [],   // [{date, hours, note}]
};
let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem("vacation_planner_state_v3");
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...structuredClone(DEFAULTS),
        ...parsed,
        ptoRanges: Array.isArray(parsed.ptoRanges) ? parsed.ptoRanges : [],
        credits: Array.isArray(parsed.credits) ? parsed.credits : [],
      };
    }
    // migrate old keys if present
    const v2 = localStorage.getItem("vacation_planner_state_v2");
    if (v2) {
      const old = JSON.parse(v2);
      return {
        ...structuredClone(DEFAULTS),
        ...old,
        ptoRanges: Array.isArray(old.ptoRanges) ? old.ptoRanges : [],
        credits: Array.isArray(old.credits) ? old.credits : [],
      };
    }
    return structuredClone(DEFAULTS);
  } catch {
    return structuredClone(DEFAULTS);
  }
}
function saveState() {
  localStorage.setItem("vacation_planner_state_v3", JSON.stringify(state));
}

/* =========================
   Core Calculations
   ========================= */
function ptoHoursUpTo(targetDateStr) {
  const target = toDateOnlyUTC(targetDateStr);
  let hours = 0;
  for (const r of state.ptoRanges) {
    const from = toDateOnlyUTC(r.from);
    const to = toDateOnlyUTC(r.to);
    if (from > target) continue;
    const cappedTo = to <= target ? to : target;
    hours += weekdaysBetweenInclusive(from, cappedTo) * 8;
  }
  return hours;
}
function creditHoursUpTo(targetDateStr) {
  const target = toDateOnlyUTC(targetDateStr);
  let hours = 0;
  for (const c of state.credits) {
    const d = toDateOnlyUTC(c.date);
    if (d <= target) hours += Math.max(0, Number(c.hours) || 0);
  }
  return hours;
}
function getBalanceOn(targetDateStr) {
  const target = toDateOnlyUTC(targetDateStr);
  const firstPayday = toDateOnlyUTC(state.firstPayday);
  const accrual = Number(state.accrualPerPeriod) || 0;
  const freq = Number(state.payFrequencyDays) || 14;
  let bal = Number(state.startBalance) || 0;

  if (target >= firstPayday) {
    const periods = countPaydays(firstPayday, target, freq);
    bal += periods * accrual;
  }
  bal -= ptoHoursUpTo(targetDateStr);
  bal += creditHoursUpTo(targetDateStr);
  return bal;
}
function latestPTODate() {
  if (!state.ptoRanges.length) return null;
  return [...state.ptoRanges]
    .map((r) => toDateOnlyUTC(r.to))
    .sort((a, b) => b - a)[0];
}
function totalFuturePTO(fromDateStr) {
  const from = toDateOnlyUTC(fromDateStr);
  let hours = 0;
  for (const r of state.ptoRanges) {
    const rf = toDateOnlyUTC(r.from);
    const rt = toDateOnlyUTC(r.to);
    if (rt < from) continue;
    const start = rf < from ? from : rf;
    hours += weekdaysBetweenInclusive(start, rt) * 8;
  }
  return hours;
}

/* =========================
   Rendering
   ========================= */
function renderSettings() {
  document.getElementById("startDate").value = state.startDate;
  document.getElementById("startBalance").value = state.startBalance;
  document.getElementById("accrualPerPeriod").value = state.accrualPerPeriod;
  document.getElementById("firstPayday").value = state.firstPayday;
  document.getElementById("payFrequencyDays").value = state.payFrequencyDays;
}
function renderDashboard() {
  const today = clampDate(new Date());
  document.getElementById("todayLabel").textContent = ymd(today);
  document.getElementById("balanceToday").textContent = fmt(getBalanceOn(ymd(today)));

  const latest = latestPTODate();
  document.getElementById("balanceAfterLatest").textContent =
    fmt(getBalanceOn(ymd(latest || today)));

  document.getElementById("totalFuturePTO").textContent =
    fmt(totalFuturePTO(ymd(today)));

  const next = nextPaydayOnOrAfter(
    today,
    toDateOnlyUTC(state.firstPayday),
    Number(state.payFrequencyDays) || 14
  );
  document.getElementById("nextPayday").textContent = ymd(next);
}
function renderPTOTable() {
  const tbody = document.getElementById("ptoTable");
  tbody.innerHTML = "";
  const rows = [...state.ptoRanges]
    .sort((a, b) => toDateOnlyUTC(a.from) - toDateOnlyUTC(b.from))
    .map((r, idx) => {
      const tr = document.createElement("tr");
      tr.className = "border-t";
      tr.innerHTML = `
        <td class="py-2">${r.from}</td>
        <td class="py-2">${r.to}</td>
        <td class="py-2">${fmt(Math.max(0, Number(r.hours) || 0))}</td>
        <td class="py-2">${r.note ? r.note.replace(/</g, "&lt;") : ""}</td>
        <td class="py-2">
          <button data-idx="${idx}" class="deletePTO text-red-600 hover:underline">Delete</button>
        </td>`;
      return tr;
    });
  rows.forEach((r) => tbody.appendChild(r));
  [...tbody.querySelectorAll(".deletePTO")].forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      const i = Number(ev.currentTarget.getAttribute("data-idx"));
      state.ptoRanges.splice(i, 1);
      saveState();
      renderAll();
    });
  });
}
function renderCreditsTable() {
  const tbody = document.getElementById("creditTable");
  tbody.innerHTML = "";
  const rows = [...state.credits]
    .sort((a, b) => toDateOnlyUTC(a.date) - toDateOnlyUTC(b.date))
    .map((c, idx) => {
      const tr = document.createElement("tr");
      tr.className = "border-t";
      tr.innerHTML = `
        <td class="py-2">${c.date}</td>
        <td class="py-2">${fmt(Math.max(0, Number(c.hours) || 0))}</td>
        <td class="py-2">${c.note ? c.note.replace(/</g, "&lt;") : ""}</td>
        <td class="py-2">
          <button data-idx="${idx}" class="deleteCredit text-red-600 hover:underline">Delete</button>
        </td>`;
      return tr;
    });
  rows.forEach((r) => tbody.appendChild(r));
  [...tbody.querySelectorAll(".deleteCredit")].forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      const i = Number(ev.currentTarget.getAttribute("data-idx"));
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
   Events & UI wiring
   ========================= */
function updatePTOPreview() {
  const fromVal = document.getElementById("ptoFrom").value;
  const toVal = document.getElementById("ptoTo").value;
  if (!fromVal || !toVal) {
    document.getElementById("ptoCalcHours").value = "";
    return;
  }
  const from = toDateOnlyUTC(fromVal);
  const to = toDateOnlyUTC(toVal);
  if (to < from) {
    document.getElementById("ptoCalcHours").value = "0";
    return;
  }
  const days = weekdaysBetweenInclusive(from, to);
  document.getElementById("ptoCalcHours").value = (days * 8).toFixed(2);
}
function setTabButtonStyles(active) {
  const bOverview = document.getElementById("tabOverview");
  const bForecast = document.getElementById("tabForecast");
  const activeCls = ["bg-gray-900", "text-white"];
  const inactiveCls = ["bg-white", "border", "text-gray-900"];
  [bOverview, bForecast].forEach(b => b.classList.remove(...activeCls, ...inactiveCls));
  if (active === "Overview") {
    bOverview.classList.add(...activeCls); bForecast.classList.add(...inactiveCls);
  } else {
    bForecast.classList.add(...activeCls); bOverview.classList.add(...inactiveCls);
  }
}
function wireUIEvents() {
  document.getElementById("saveSettings").addEventListener("click", () => {
    state.startDate = document.getElementById("startDate").value || state.startDate;
    state.startBalance = Number(document.getElementById("startBalance").value);
    state.accrualPerPeriod = Number(document.getElementById("accrualPerPeriod").value);
    state.firstPayday = document.getElementById("firstPayday").value || state.firstPayday;
    state.payFrequencyDays = Number(document.getElementById("payFrequencyDays").value);
    saveState(); renderAll();
  });
  document.getElementById("recalc").addEventListener("click", renderAll);
  document.getElementById("computeProjection").addEventListener("click", () => {
    const d = document.getElementById("projectionDate").value;
    document.getElementById("projectionResult").textContent = d ? fmt(getBalanceOn(d)) : "Pick a date";
  });
  document.getElementById("ptoFrom").addEventListener("change", updatePTOPreview);
  document.getElementById("ptoTo").addEventListener("change", updatePTOPreview);
  document.getElementById("addPTO").addEventListener("click", () => {
    const from = document.getElementById("ptoFrom").value;
    const to = document.getElementById("ptoTo").value;
    const note = document.getElementById("ptoNote").value.trim();
    if (!from || !to) return alert("Enter a From and To date.");
    const f = toDateOnlyUTC(from), t = toDateOnlyUTC(to);
    if (t < f) return alert('"To" date must be on or after "From" date.');
    const hours = weekdaysBetweenInclusive(f, t) * 8;
    state.ptoRanges.push({ from, to, hours, note });
    saveState();
    document.getElementById("ptoFrom").value = "";
    document.getElementById("ptoTo").value = "";
    document.getElementById("ptoNote").value = "";
    document.getElementById("ptoCalcHours").value = "";
    renderAll();
  });
  document.getElementById("addCredit").addEventListener("click", () => {
    const date = document.getElementById("creditDate").value;
    const hours = Number(document.getElementById("creditHours").value);
    const note = document.getElementById("creditNote").value.trim();
    if (!date || !isFinite(hours) || hours <= 0) return alert("Enter a valid date and positive hours.");
    state.credits.push({ date, hours, note });
    saveState();
    document.getElementById("creditDate").value = "";
    document.getElementById("creditHours").value = "";
    document.getElementById("creditNote").value = "";
    renderAll();
  });

  // Robust tab switching (works on button child clicks, too)
  document.addEventListener("click", (e) => {
    if (e.target?.closest?.("button#tabForecast")) {
      switchTab("Forecast");
    } else if (e.target?.closest?.("button#tabOverview")) {
      switchTab("Overview");
    } else if (e.target?.id === "regenForecast") {
      drawCurrentForecast();
    } else if (e.target?.id === "exportForecastCsv") {
      exportForecastCsv();
    } else if (e.target?.id === "modeYear") {
      document.body.dataset.mode = "year";
      document.getElementById("forecastYearWrap").classList.remove("hidden");
      document.getElementById("forecastSplitWrap").classList.add("hidden");
      drawForecastYear();
    } else if (e.target?.id === "modeSplit") {
      document.body.dataset.mode = "split";
      document.getElementById("forecastYearWrap").classList.add("hidden");
      document.getElementById("forecastSplitWrap").classList.remove("hidden");
      drawForecastSplit();
    }
  });

  window.addEventListener("resize", () => {
    const tForecast = document.getElementById("tab-Forecast");
    if (!tForecast.classList.contains("hidden")) drawCurrentForecast();
  });
}

/* =========================
   Tabs & Forecast Charts
   ========================= */
function switchTab(tab) {
  const tOverview = document.getElementById("tab-Overview");
  const tForecast = document.getElementById("tab-Forecast");
  if (tab === "Forecast") {
    tOverview.classList.add("hidden");
    tForecast.classList.remove("hidden");
    setTabButtonStyles("Forecast");
    requestAnimationFrame(drawCurrentForecast);
  } else {
    tForecast.classList.add("hidden");
    tOverview.classList.remove("hidden");
    setTabButtonStyles("Overview");
  }
}
function drawCurrentForecast() {
  if (document.body.dataset.mode === "split") drawForecastSplit();
  else drawForecastYear();
}
const $canvas = (id) => document.getElementById(id);

function forecastSeries(startDate, days) {
  const series = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(startDate, i);
    series.push({ date: d, y: getBalanceOn(ymd(d)) });
  }
  return series;
}
function setupCanvas(canvas) {
  const ctx = canvas.getContext("2d");
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
  yMin -= padY; yMax += padY;

  const xs = (i) => pad.l + (i / Math.max(1, (series.length - 1))) * W;
  const ys = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * H;

  // Axes
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t + H);
  ctx.lineTo(pad.l + W, pad.t + H);
  ctx.stroke();

  // Grid + Y labels
  ctx.fillStyle = "#6b7280";
  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const v = yMin + (i / ticks) * (yMax - yMin);
    const y = ys(v);
    ctx.strokeStyle = "#f3f4f6";
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + W, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(1), 4, y + 4);
  }

  // Month separators
  for (let i = 0; i < series.length; i++) {
    const d = series[i].date;
    if (d.getUTCDate() === 1) {
      const x = xs(i);
      ctx.strokeStyle = "#f3f4f6";
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + H);
      ctx.stroke();
      ctx.fillStyle = "#6b7280";
      ctx.fillText(d.toISOString().slice(0, 7), x - 14, pad.t + H + 18);
    }
  }

  // Line
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(xs(0), ys(series[0].y));
  for (let i = 1; i < series.length; i++) ctx.lineTo(xs(i), ys(series[i].y));
  ctx.stroke();

  canvas._forecastData = { series, pad, W, H, yMin, yMax };
}
function labelPaydays(canvas, seriesStart, series) {
  if (!canvas || !canvas._forecastData) return;
  const { pad, W, yMin, yMax, H } = canvas._forecastData;
  const ctx = canvas.getContext("2d");
  const xs = (i) => pad.l + (i / Math.max(1, (series.length - 1))) * W;
  const ys = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * H;

  const horizonEnd = addDays(seriesStart, series.length - 1);
  const paydays = getPaydaysBetween(
    seriesStart, horizonEnd, toDateOnlyUTC(state.firstPayday),
    Number(state.payFrequencyDays) || 14
  );

  ctx.fillStyle = "#111827";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

  for (const pay of paydays) {
    const idx = daysBetween(seriesStart, pay);
    if (idx < 0 || idx >= series.length) continue;
    const x = xs(idx);
    const y = ys(series[idx].y);
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(series[idx].y.toFixed(2), x, y - 6);
  }
}
function handleHover(event, canvas, hoverId) {
  if (!canvas || !canvas._forecastData) return;
  const { series, pad, W } = canvas._forecastData;
  const rect = canvas.getBoundingClientRect();
  const xCss = event.clientX - rect.left;
  const i = Math.round(((xCss - pad.l) / W) * (series.length - 1));
  const idx = Math.min(Math.max(i, 0), series.length - 1);
  const p = series[idx];
  const hoverEl = document.getElementById(hoverId);
  if (hoverEl) hoverEl.textContent = `${p.date.toISOString().slice(0, 10)} → ${p.y.toFixed(2)} h`;
}
function drawForecastYear() {
  const today = clampDate(new Date());
  const series = forecastSeries(today, 365);
  const canvas = $canvas("forecastCanvasYear");
  drawLineChart(canvas, series);
  labelPaydays(canvas, today, series);
  canvas.onmousemove = (ev) => handleHover(ev, canvas, "forecastHoverYear");
}
function drawForecastSplit() {
  const today = clampDate(new Date());
  const mid = addDays(today, 182);
  const s1 = forecastSeries(today, 182);
  const s2 = forecastSeries(mid, 365 - 182);
  const c1 = $canvas("forecastCanvasH1");
  const c2 = $canvas("forecastCanvasH2");
  drawLineChart(c1, s1); labelPaydays(c1, today, s1); c1.onmousemove = (ev) => handleHover(ev, c1, "forecastHoverH1");
  drawLineChart(c2, s2); labelPaydays(c2, mid, s2);   c2.onmousemove = (ev) => handleHover(ev, c2, "forecastHoverH2");
}
function exportForecastCsv() {
  const canvas = document.body.dataset.mode === "split"
    ? $canvas("forecastCanvasH1")
    : $canvas("forecastCanvasYear");
  if (!canvas || !canvas._forecastData) return;
  const { series } = canvas._forecastData;
  const rows = ["date,hours", ...series.map(p => `${p.date.toISOString().slice(0,10)},${p.y.toFixed(2)}`)];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "vacation_forecast.csv";
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/* =========================
   Init & Minimal Tests
   ========================= */
(function init() {
  if (!state.firstPayday) state.firstPayday = "2026-01-08";
  if (!state.payFrequencyDays) state.payFrequencyDays = 14;
  document.body.dataset.mode = document.body.dataset.mode || "year";
  renderAll(); wireUIEvents(); runTests();
})();

function assertEq(name, a, b) {
  const ok = a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9);
  if (!ok) console.error(`[TEST FAIL] ${name}: expected`, b, "got", a);
  else console.log(`[TEST PASS] ${name}`);
}
function runTests() {
  // Paydays
  assertEq("nextPaydayOnOrAfter 2026-01-01",
    ymd(nextPaydayOnOrAfter(new Date(Date.UTC(2026,0,1)), new Date(Date.UTC(2026,0,8)), 14)),
    "2026-01-08");
  assertEq("countPaydays two periods",
    countPaydays(new Date(Date.UTC(2026,0,8)), new Date(Date.UTC(2026,0,22)), 14), 2);

  // Weekday counter
  assertEq("weekdays 2026-01-05..09 (Mon–Fri)", weekdaysBetweenInclusive(
    new Date(Date.UTC(2026,0,5)), new Date(Date.UTC(2026,0,9))), 5);

  // Balance baseline (no accrual pre 1/08, no PTO/credits)
  assertEq("balance 2026-01-05", Number(getBalanceOn("2026-01-05").toFixed(2)), -15.78);
}
