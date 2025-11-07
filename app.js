/* Vacation Balance Planner — app.js (mobile-friendly, split charts, tests) */

/* ========== Utilities ========== */
const MS_PER_DAY = 86400000;
const fmt = (h) => `${(Math.round(h * 100) / 100).toFixed(2)} h`;
const ymd = (d) => d.toISOString().slice(0, 10);

function toDateOnlyUTC(d) {
  if (!d) return null;
  if (typeof d === "string") {
    const [y, m, dd] = d.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, dd));
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const clampToDateOnly = (d) => toDateOnlyUTC(ymd(toDateOnlyUTC(d)));
const addDays = (d, n) => new Date(d.getTime() + n * MS_PER_DAY);
function daysBetween(a, b) {
  const ms = clampToDateOnly(b) - clampToDateOnly(a);
  return Math.floor(ms / MS_PER_DAY);
}

/* ========== Paydays ========== */
function countPaydays(firstPayday, targetDate, freqDays) {
  const start = clampToDateOnly(firstPayday);
  const end = clampToDateOnly(targetDate);
  if (end < start) return 0;
  const diffDays = daysBetween(start, end);
  return Math.floor(diffDays / freqDays) + 1; // include first if on/before end
}
function nextPaydayOnOrAfter(date, firstPayday, freqDays) {
  const d = clampToDateOnly(date);
  const first = clampToDateOnly(firstPayday);
  if (d <= first) return first;
  const diff = daysBetween(first, d);
  const steps = Math.ceil(diff / freqDays);
  return addDays(first, steps * freqDays);
}
function getPaydaysBetween(startDate, endDate, firstPayday, freqDays) {
  const out = [];
  const start = clampToDateOnly(startDate);
  const end = clampToDateOnly(endDate);
  let pay = nextPaydayOnOrAfter(start, firstPayday, freqDays);
  while (pay <= end) {
    out.push(pay);
    pay = addDays(pay, freqDays);
  }
  return out;
}

/* ========== U.S. Federal Holidays (Observed) ========== */
function nthWeekdayOfMonth(year, monthIndex, weekday, n) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const firstWeekday = first.getUTCDay();
  const offset = (7 + weekday - firstWeekday) % 7;
  return new Date(Date.UTC(year, monthIndex, 1 + offset + 7 * (n - 1)));
}
function lastWeekdayOfMonth(year, monthIndex, weekday) {
  const firstNext = new Date(Date.UTC(year, monthIndex + 1, 1));
  const last = addDays(firstNext, -1);
  const lastWeekday = last.getUTCDay();
  const offset = (7 + lastWeekday - weekday) % 7;
  return addDays(last, -offset);
}
function observedFixed(year, monthIndex, day) {
  const d = new Date(Date.UTC(year, monthIndex, day));
  const wd = d.getUTCDay();
  if (wd === 0) return new Date(Date.UTC(year, monthIndex, day + 1));
  if (wd === 6) return new Date(Date.UTC(year, monthIndex, day - 1));
  return d;
}
function federalHolidaySetForYear(year) {
  const set = new Set();
  const push = (date) => set.add(ymd(date));
  push(observedFixed(year, 0, 1)); // New Year
  push(nthWeekdayOfMonth(year, 0, 1, 3)); // MLK
  push(nthWeekdayOfMonth(year, 1, 1, 3)); // Presidents
  push(lastWeekdayOfMonth(year, 4, 1)); // Memorial
  push(observedFixed(year, 5, 19)); // Juneteenth
  push(observedFixed(year, 6, 4)); // Independence Day
  push(nthWeekdayOfMonth(year, 8, 1, 1)); // Labor
  push(nthWeekdayOfMonth(year, 9, 1, 2)); // Indigenous/Columbus
  push(observedFixed(year, 10, 11)); // Veterans
  push(nthWeekdayOfMonth(year, 10, 4, 4)); // Thanksgiving
  push(observedFixed(year, 11, 25)); // Christmas
  return set;
}
function holidaySetForRange(yearStart, yearEnd) {
  const set = new Set();
  for (let y = yearStart; y <= yearEnd; y++) {
    for (const d of federalHolidaySetForYear(y)) set.add(d);
  }
  return set;
}
function isBusinessDay(date, holidaysSet) {
  const d = clampToDateOnly(date);
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !holidaysSet.has(ymd(d));
}
function businessDaysBetweenInclusive(fromDate, toDate, holidaysSet) {
  let from = clampToDateOnly(fromDate);
  let to = clampToDateOnly(toDate);
  if (to < from) return 0;
  let days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (isBusinessDay(d, holidaysSet)) days++;
  }
  return days;
}

/* ========== State ========== */
const DEFAULTS = {
  startDate: "2026-01-01",
  startBalance: -15.78,
  accrualPerPeriod: 4.61,
  firstPayday: "2026-01-08",
  payFrequencyDays: 14,
  pto: [],
  ptoRanges: [],
  credits: [],
};
let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem("vacation_planner_state_v2");
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...structuredClone(DEFAULTS),
        ...parsed,
        pto: Array.isArray(parsed.pto) ? parsed.pto : [],
        ptoRanges: Array.isArray(parsed.ptoRanges) ? parsed.ptoRanges : [],
        credits: Array.isArray(parsed.credits) ? parsed.credits : [],
      };
    }
    const v1raw = localStorage.getItem("vacation_planner_state_v1");
    if (v1raw) {
      const v1 = JSON.parse(v1raw);
      return { ...structuredClone(DEFAULTS), ...v1 };
    }
    return structuredClone(DEFAULTS);
  } catch {
    return structuredClone(DEFAULTS);
  }
}
function saveState() {
  localStorage.setItem("vacation_planner_state_v2", JSON.stringify(state));
}

/* ========== Calculations ========== */
function totalPtoHoursUpTo(targetDateStr) {
  const target = toDateOnlyUTC(targetDateStr);
  const years = [
    toDateOnlyUTC(state.startDate).getUTCFullYear(),
    target.getUTCFullYear(),
  ];
  const minY = Math.min(...years) - 1;
  const maxY = Math.max(...years) + 1;
  const holidays = holidaySetForRange(minY, maxY);

  let hours = 0;
  for (const e of state.pto) {
    const d = toDateOnlyUTC(e.date);
    if (d <= target && isBusinessDay(d, holidays)) {
      hours += Math.max(0, Number(e.hours) || 0);
    }
  }
  for (const r of state.ptoRanges) {
    const from = toDateOnlyUTC(r.from);
    const to = toDateOnlyUTC(r.to);
    if (from > target) continue;
    const cappedTo = to <= target ? to : target;
    const days = businessDaysBetweenInclusive(from, cappedTo, holidays);
    hours += days * 8;
  }
  return hours;
}
function totalCreditsUpTo(targetDateStr) {
  const target = toDateOnlyUTC(targetDateStr);
  let hours = 0;
  for (const c of state.credits) {
    const d = toDateOnlyUTC(c.date);
    if (d <= target) hours += Math.max(0, Number(c.hours) || 0);
  }
  return hours;
}
function getBalanceOn(targetDateStr) {
  const targetDate = toDateOnlyUTC(targetDateStr);
  const firstPayday = toDateOnlyUTC(state.firstPayday);
  const accrual = Number(state.accrualPerPeriod) || 0;
  const freq = Number(state.payFrequencyDays) || 14;
  let bal = Number(state.startBalance) || 0;

  if (targetDate >= firstPayday) {
    const periods = countPaydays(firstPayday, targetDate, freq);
    bal += periods * accrual;
  }
  bal -= totalPtoHoursUpTo(targetDateStr);
  bal += totalCreditsUpTo(targetDateStr);
  return bal;
}
function latestPTODate() {
  const dates = [];
  for (const e of state.pto) dates.push(toDateOnlyUTC(e.date));
  for (const r of state.ptoRanges) dates.push(toDateOnlyUTC(r.to));
  if (!dates.length) return null;
  return dates.sort((a, b) => b - a)[0];
}
function totalFuturePTO(fromDateStr) {
  const from = toDateOnlyUTC(fromDateStr);
  const years = [
    toDateOnlyUTC(state.startDate).getUTCFullYear(),
    from.getUTCFullYear() + 5,
  ];
  const holidays = holidaySetForRange(
    Math.min(...years) - 1,
    Math.max(...years) + 1
  );
  let hours = 0;
  for (const r of state.ptoRanges) {
    const rf = toDateOnlyUTC(r.from);
    const rt = toDateOnlyUTC(r.to);
    if (rt < from) continue;
    const start = rf < from ? from : rf;
    const days = businessDaysBetweenInclusive(start, rt, holidays);
    hours += days * 8;
  }
  for (const e of state.pto) {
    const d = toDateOnlyUTC(e.date);
    if (d >= from && isBusinessDay(d, holidays)) {
      hours += Math.max(0, Number(e.hours) || 0);
    }
  }
  return hours;
}

/* ========== Rendering ========== */
function renderSettings() {
  document.getElementById("startDate").value = state.startDate;
  document.getElementById("startBalance").value = state.startBalance;
  document.getElementById("accrualPerPeriod").value = state.accrualPerPeriod;
  document.getElementById("firstPayday").value = state.firstPayday;
  document.getElementById("payFrequencyDays").value = state.payFrequencyDays;
}
function renderDashboard() {
  const today = clampToDateOnly(new Date());
  document.getElementById("todayLabel").textContent = ymd(today);
  document.getElementById("balanceToday").textContent = fmt(getBalanceOn(ymd(today)));

  const latest = latestPTODate();
  const label = document.getElementById("balanceAfterLatest");
  label.textContent = fmt(getBalanceOn(ymd(latest || today)));

  document.getElementById("totalFuturePTO").textContent = fmt(totalFuturePTO(ymd(today)));

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

/* ========== Events ========== */
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
  const minY = Math.min(from.getUTCFullYear(), to.getUTCFullYear()) - 1;
  const maxY = Math.max(from.getUTCFullYear(), to.getUTCFullYear()) + 1;
  const holidays = holidaySetForRange(minY, maxY);
  const days = businessDaysBetweenInclusive(from, to, holidays);
  document.getElementById("ptoCalcHours").value = (days * 8).toFixed(2);
}
function wireUIEvents() {
  document.getElementById("saveSettings").addEventListener("click", () => {
    state.startDate = document.getElementById("startDate").value || state.startDate;
    state.startBalance = Number(document.getElementById("startBalance").value);
    state.accrualPerPeriod = Number(document.getElementById("accrualPerPeriod").value);
    state.firstPayday = document.getElementById("firstPayday").value || state.firstPayday;
    state.payFrequencyDays = Number(document.getElementById("payFrequencyDays").value);
    saveState();
    renderAll();
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
    const minY = Math.min(f.getUTCFullYear(), t.getUTCFullYear()) - 1;
    const maxY = Math.max(f.getUTCFullYear(), t.getUTCFullYear()) + 1;
    const holidays = holidaySetForRange(minY, maxY);
    const hours = businessDaysBetweenInclusive(f, t, holidays) * 8;
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
  document.getElementById("exportBtn").addEventListener("click", () => {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "vacation_planner_state.json";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });
  document.getElementById("importInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        const merged = { ...structuredClone(DEFAULTS), ...imported };
        merged.pto = Array.isArray(merged.pto) ? merged.pto : [];
        merged.ptoRanges = Array.isArray(merged.ptoRanges) ? merged.ptoRanges : [];
        merged.credits = Array.isArray(merged.credits) ? merged.credits : [];
        state = merged; saveState(); renderAll();
      } catch { alert("Could not import file."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  });
  document.addEventListener("click", (e) => {
    if (e.target && e.target.id === "tabForecast") switchTab("Forecast");
    if (e.target && e.target.id === "tabOverview") switchTab("Overview");
    if (e.target && e.target.id === "regenForecast") {
      if (document.body.dataset.mode === "split") drawForecastSplit();
      else drawForecastYear();
    }
    if (e.target && e.target.id === "exportForecastCsv") exportForecastCsv();
    if (e.target && e.target.id === "modeYear") {
      document.body.dataset.mode = "year";
      document.getElementById("forecastYearWrap").classList.remove("hidden");
      document.getElementById("forecastSplitWrap").classList.add("hidden");
      drawForecastYear();
    }
    if (e.target && e.target.id === "modeSplit") {
      document.body.dataset.mode = "split";
      document.getElementById("forecastYearWrap").classList.add("hidden");
      document.getElementById("forecastSplitWrap").classList.remove("hidden");
      drawForecastSplit();
    }
  });
  window.addEventListener("resize", () => {
    const tForecast = document.getElementById("tab-Forecast");
    if (!tForecast.classList.contains("hidden")) {
      if (document.body.dataset.mode === "split") drawForecastSplit();
      else drawForecastYear();
    }
  });
}

/* ========== Tabs & Forecast Chart (Canvas) ========== */
function switchTab(tab) {
  const tOverview = document.getElementById("tab-Overview");
  const tForecast = document.getElementById("tab-Forecast");
  const bOverview = document.getElementById("tabOverview");
  const bForecast = document.getElementById("tabForecast");
  const active = "bg-gray-900 text-white";
  const inactive = "bg-white border text-gray-900";
  if (tab === "Forecast") {
    tOverview.classList.add("hidden");
    tForecast.classList.remove("hidden");
    bForecast.classList.add(...active.split(" "));
    bOverview.classList.remove(...active.split(" "));
    bOverview.classList.add(...inactive.split(" "));
    setTimeout(() => {
      if (document.body.dataset.mode === "split") drawForecastSplit();
      else drawForecastYear();
    }, 0);
  } else {
    tForecast.classList.add("hidden");
    tOverview.classList.remove("hidden");
    bOverview.classList.add(...active.split(" "));
    bForecast.classList.remove(...active.split(" "));
    bForecast.classList.add(...inactive.split(" "));
  }
}
const $canvas = (id) => document.getElementById(id);
function generateForecastSeries(startDate, days) {
  const series = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(startDate, i);
    series.push({ date: d, y: getBalanceOn(ymd(d)) });
  }
  return series;
}
function drawLineChart(canvas, series) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const widthCss = canvas.clientWidth;
  const heightCss = canvas.clientHeight;
  canvas.width = Math.floor(widthCss * ratio);
  canvas.height = Math.floor(heightCss * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, widthCss, heightCss);

  if (!series.length) return;

  const pad = { l: 48, r: 12, t: 12, b: 28 };
  const W = widthCss - pad.l - pad.r;
  const H = heightCss - pad.t - pad.b;

  let yMin = Math.min(...series.map((p) => p.y));
  let yMax = Math.max(...series.map((p) => p.y));
  const padY = (yMax - yMin) * 0.05 || 1;
  yMin -= padY; yMax += padY;

  const xs = (i) => pad.l + (i / (series.length - 1)) * W;
  const ys = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * H;

  // Axes
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t + H);
  ctx.lineTo(pad.l + W, pad.t + H);
  ctx.stroke();

  // Y ticks
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

  // Month grid + labels
  for (let i = 0; i < series.length; i++) {
    const d = series[i].date;
    if (d.getUTCDate() === 1) {
      const x = xs(i);
      ctx.strokeStyle = "#f3f4f6";
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + H);
      ctx.stroke();
      const label = d.toISOString().slice(0, 7);
      ctx.fillStyle = "#6b7280";
      ctx.fillText(label, x - 14, pad.t + H + 18);
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
  const { pad, W, yMin, yMax } = canvas._forecastData;
  const ctx = canvas.getContext("2d");
  const xs = (i) => pad.l + (i / (series.length - 1)) * W;
  const ys = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (canvas._forecastData.H);

  const horizonEnd = addDays(seriesStart, series.length - 1);
  const paydays = getPaydaysBetween(
    seriesStart,
    horizonEnd,
    toDateOnlyUTC(state.firstPayday),
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
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(series[idx].y.toFixed(2), x, y - 6);
  }
}
function drawForecastYear() {
  const today = clampToDateOnly(new Date());
  const series = generateForecastSeries(today, 365);
  const canvas = $canvas("forecastCanvasYear");
  drawLineChart(canvas, series);
  labelPaydays(canvas, today, series);
  canvas.addEventListener("mousemove", (ev) => handleHover(ev, canvas, "forecastHoverYear"));
}
function drawForecastSplit() {
  const today = clampToDateOnly(new Date());
  const mid = addDays(today, 182);
  const s1 = generateForecastSeries(today, 182);
  const s2 = generateForecastSeries(mid, 365 - 182);
  const c1 = $canvas("forecastCanvasH1");
  const c2 = $canvas("forecastCanvasH2");
  drawLineChart(c1, s1); labelPaydays(c1, today, s1);
  drawLineChart(c2, s2); labelPaydays(c2, mid, s2);
  c1.addEventListener("mousemove", (ev) => handleHover(ev, c1, "forecastHoverH1"));
  c2.addEventListener("mousemove", (ev) => handleHover(ev, c2, "forecastHoverH2"));
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
function exportForecastCsv() {
  const canvas = document.body.dataset.mode === "split"
    ? $canvas("forecastCanvasH1")
    : $canvas("forecastCanvasYear");
  if (!canvas || !canvas._forecastData) return;
  const { series } = canvas._forecastData;
  const rows = ["date,hours"];
  for (const p of series) rows.push(`${p.date.toISOString().slice(0, 10)},${p.y.toFixed(2)}`);
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "vacation_forecast.csv";
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/* ========== Init & Tests ========== */
(function init() {
  if (!state.firstPayday) state.firstPayday = "2026-01-08";
  if (!state.payFrequencyDays) state.payFrequencyDays = 14;
  renderAll();
  wireUIEvents();
  document.body.dataset.mode = document.body.dataset.mode || "year";
  runTests();
})();

function assertEq(name, a, b) {
  const ok = a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9);
  if (!ok) console.error(`[TEST FAIL] ${name}: expected`, b, "got", a);
  else console.log(`[TEST PASS] ${name}`);
}
function runTests() {
  assertEq(
    "nextPaydayOnOrAfter 2026-01-01",
    ymd(nextPaydayOnOrAfter(new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 0, 8)), 14)),
    "2026-01-08"
  );
  assertEq(
    "countPaydays two periods",
    countPaydays(new Date(Date.UTC(2026, 0, 8)), new Date(Date.UTC(2026, 0, 22)), 14),
    2
  );
  const hol2026 = holidaySetForRange(2026, 2026);
  console.log("[TEST INFO] Holidays contain 2026-01-01:", hol2026.has("2026-01-01"));
  assertEq(
    "business days 2026-01-05..09",
    businessDaysBetweenInclusive(new Date(Date.UTC(2026, 0, 5)), new Date(Date.UTC(2026, 0, 9)), hol2026),
    5
  );
  assertEq("balance before first payday", Number(getBalanceOn("2026-01-05").toFixed(2)), -15.78);
  const pd = getPaydaysBetween(
    new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 0, 31)), new Date(Date.UTC(2026, 0, 8)), 14
  ).map(ymd);
  assertEq("paydays count Jan 2026", pd.length, 2);
  assertEq("payday #1", pd[0], "2026-01-08");
  assertEq("payday #2", pd[1], "2026-01-22");
}
