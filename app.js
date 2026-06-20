/* =====================================================================
   app.js — TrafficAI Main Application Logic
   ===================================================================== */

// All data globals (VIOLATION_TYPES, generateViolation, generateDataset, etc.)
// are already declared by violations.js — do NOT re-declare them here.
// Just ensure window.ViolationData loaded; if not, provide minimal stubs.
if (typeof generateDataset === 'undefined') {
  window.generateDataset     = () => [];
  window.generateViolation   = () => ({});
  window.generateHourlyData  = () => [];
  window.generate30DayTrend  = () => [];
  window.generatePlate       = () => 'KA01AB1234';
  window.lookupPlate         = () => null;
  window.randInt    = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
  window.randFloat  = (a,b) => +(Math.random()*(b-a)+a).toFixed(1);
  window.randFrom   = (arr)  => arr[Math.floor(Math.random()*arr.length)];
  window.timeAgo    = ()     => 'just now';
  window.VIOLATION_TYPES  = [];
  window.CLASS_PERFORMANCE= [];
  window.LOCATIONS        = [];
  window.VEHICLE_TYPES    = [];
}


// ─── Backend API Configuration ────────────────────────────────────────
const API_BASE   = 'https://trafficg-production.up.railway.app';
const API_TIMEOUT = 60000; // 60s (model inference can take time)

let backendOnline = false;

async function checkBackendStatus() {
  try {
    const res = await Promise.race([
      fetch(`${API_BASE}/api/health`),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ]);
    if (res.ok) {
      const data = await res.json();
      backendOnline = true;
      updateBackendIndicator(true, data);
      // Refresh KPIs from real backend stats
      fetchBackendStats();
    }
  } catch {
    backendOnline = false;
    updateBackendIndicator(false, null);
  }
}

function updateBackendIndicator(online, health) {
  let indicator = document.getElementById('backendIndicator');
  if (!indicator) {
    // Create indicator in topbar
    indicator = document.createElement('div');
    indicator.id = 'backendIndicator';
    indicator.style.cssText = `
      display:flex;align-items:center;gap:6px;padding:4px 12px;
      border-radius:20px;font-size:0.7rem;font-weight:700;
      border:1px solid;cursor:pointer;transition:all 0.2s;
    `;
    indicator.title = 'Click for backend info';
    document.querySelector('.topbar-right').prepend(indicator);
  }

  if (online && health) {
    const yolo = health.models_loaded?.yolov8 ? '✅' : '⚠️';
    const ocr  = health.models_loaded?.easyocr ? '✅' : '⚠️';
    indicator.style.background = 'rgba(0,255,136,0.12)';
    indicator.style.borderColor= 'rgba(0,255,136,0.4)';
    indicator.style.color      = '#00ff88';
    indicator.innerHTML = `<span style="width:7px;height:7px;background:#00ff88;border-radius:50%;box-shadow:0 0 6px #00ff88"></span> AI Backend Online`;
    indicator.title = `YOLOv8: ${yolo}  EasyOCR: ${ocr}  Device: ${health.device}\nUptime: ${Math.round(health.uptime_seconds)}s`;
  } else {
    indicator.style.background = 'rgba(255,149,0,0.12)';
    indicator.style.borderColor= 'rgba(255,149,0,0.4)';
    indicator.style.color      = '#ff9500';
    indicator.innerHTML = `<span style="width:7px;height:7px;background:#ff9500;border-radius:50%"></span> Simulation Mode`;
    indicator.title = 'Python backend offline. Running frontend simulation.\nTo enable real AI: run backend/start.bat';
  }
}

async function fetchBackendStats() {
  try {
    const res = await fetch(`${API_BASE}/api/stats`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.total_violations_today)
      animateCounter(document.getElementById('kpiTotal'),    data.total_violations_today);
    if (data.critical_violations)
      animateCounter(document.getElementById('kpiCritical'), data.critical_violations);
    if (data.images_processed)
      animateCounter(document.getElementById('kpiImages'),   data.images_processed);
    if (data.plates_recognized)
      animateCounter(document.getElementById('kpiPlates'),   data.plates_recognized);
    if (data.accuracy)
      animateCounter(document.getElementById('kpiAccuracy'), data.accuracy, '%');
  } catch { /* fallback to simulated values */ }
}

// ─── State ────────────────────────────────────────────────────────────
const State = {
  dataset: [],
  currentPage: 'dashboard',
  chartsInitialized: new Set(),
  feedItems: [],
  notifCount: 3,
  galleryData: [],
  recentLookups: [],
  reportsList: [],
};

// ─── Navigation ───────────────────────────────────────────────────────
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  const navEl  = document.getElementById(`nav-${page}`);
  if (pageEl) pageEl.classList.add('active');
  if (navEl)  navEl.classList.add('active');

  document.getElementById('breadcrumb').textContent =
    navEl ? navEl.textContent.trim() : page;
  State.currentPage = page;

  // Lazy-init charts
  if (page === 'dashboard' && !State.chartsInitialized.has('dashboard')) {
    State.chartsInitialized.add('dashboard');
    initDashboardCharts();
  }
  if (page === 'analytics' && !State.chartsInitialized.has('analytics')) {
    State.chartsInitialized.add('analytics');
    initAnalyticsCharts();
  }
  if (page === 'performance' && !State.chartsInitialized.has('performance')) {
    State.chartsInitialized.add('performance');
    initPerformancePage();
  }
  if (page === 'settings' && !State.chartsInitialized.has('settings')) {
    State.chartsInitialized.add('settings');
    initSettingsPage();
  }
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    navigate(item.dataset.page);
  });
});

// ─── Live Clock ───────────────────────────────────────────────────────
function startClock() {
  const el = document.getElementById('liveTime');
  if (!el) return;
  const update = () => {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  update();
  setInterval(update, 1000);
}

// ─── KPI Counters (animated) ──────────────────────────────────────────
function animateCounter(el, target, suffix = '', duration = 1200) {
  if (!el) return; // null-safe guard
  const start = performance.now();
  const startVal = 0;
  const update = (now) => {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(startVal + (target - startVal) * ease);
    el.textContent = current.toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

function initKPIs() {
  try {
    animateCounter(document.getElementById('kpiTotal'),    247);
    animateCounter(document.getElementById('kpiCritical'),  89);
    animateCounter(document.getElementById('kpiAccuracy'), 95, '%');
    animateCounter(document.getElementById('kpiPlates'),  231);
    animateCounter(document.getElementById('kpiImages'), 1248);
    const avgEl = document.getElementById('kpiAvgTime');
    if (avgEl) avgEl.textContent = '142ms';
  } catch(e) { console.warn('KPI init error:', e); }
}

// ─── Violation Feed ───────────────────────────────────────────────────
function renderFeedItem(v) {
  const item = document.createElement('div');
  item.className = `feed-item ${v.severity}`;
  item.innerHTML = `
    <div class="feed-icon">${v.type.icon}</div>
    <div class="feed-info">
      <div class="feed-type">${v.type.label}</div>
      <div class="feed-plate">${v.plate}</div>
      <div class="feed-meta">${v.location} · ${v.camera}</div>
    </div>
    <div class="feed-conf">${v.confidence}%</div>
  `;
  item.addEventListener('click', () => openViolationModal(v));
  return item;
}

function initFeed() {
  const feed = document.getElementById('violationFeed');
  const initial = State.dataset.slice(0, 8);
  initial.forEach(v => feed.appendChild(renderFeedItem(v)));

  // Live feed simulation
  setInterval(() => {
    if (State.currentPage !== 'dashboard') return;
    const v = generateViolation();
    State.dataset.unshift(v);
    const item = renderFeedItem(v);
    feed.insertBefore(item, feed.firstChild);
    // Keep max 20 items
    while (feed.children.length > 20) feed.removeChild(feed.lastChild);
    // Update KPI
    const total = document.getElementById('kpiTotal');
    const cur = parseInt(total.textContent.replace(/,/g, '')) + 1;
    total.textContent = cur.toLocaleString();
    // Notification badge
    State.notifCount++;
    document.getElementById('notifCount').textContent = State.notifCount;
    addNotification(v);
  }, 4500);
}

// ─── Dashboard Charts ────────────────────────────────────────────────
const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
};
const CHART_COLORS = VIOLATION_TYPES.map(v => v.color);

function initDashboardCharts() {
  // Donut Chart
  const donutCtx = document.getElementById('violationDonut').getContext('2d');
  const donutData = VIOLATION_TYPES.map(v => {
    return State.dataset.filter(d => d.type.id === v.id).length || randInt(15, 80);
  });
  const donutChart = new Chart(donutCtx, {
    type: 'doughnut',
    data: {
      labels: VIOLATION_TYPES.map(v => v.label),
      datasets: [{ data: donutData, backgroundColor: CHART_COLORS, borderWidth: 2, borderColor: '#111829', hoverOffset: 8 }],
    },
    options: {
      ...CHART_DEFAULTS,
      cutout: '72%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}` } } },
    },
  });

  // Donut Legend
  const legendEl = document.getElementById('donutLegend');
  const total = donutData.reduce((a,b) => a+b, 0);
  VIOLATION_TYPES.forEach((v, i) => {
    const pct = ((donutData[i] / total) * 100).toFixed(1);
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `
      <span class="legend-label"><span class="legend-dot" style="background:${v.color}"></span>${v.label}</span>
      <span class="legend-pct">${pct}%</span>
    `;
    legendEl.appendChild(row);
  });

  // Hourly Bar Chart
  const hourlyCtx = document.getElementById('hourlyBar').getContext('2d');
  const hourlyData = generateHourlyData();
  const labels = Array.from({length:24}, (_,i) => i === 0 ? '12am' : i < 12 ? `${i}am` : i === 12 ? '12pm' : `${i-12}pm`);
  new Chart(hourlyCtx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: hourlyData,
        backgroundColor: hourlyData.map(v => v > 25 ? 'rgba(255,59,92,0.7)' : 'rgba(0,212,255,0.5)'),
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4a5a7a', font: { size: 9 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4a5a7a', font: { size: 9 } } },
      },
    },
  });

  initHeatmap();
}

// ─── Heatmap ─────────────────────────────────────────────────────────
function initHeatmap() {
  const grid = document.getElementById('heatmapGrid');
  grid.innerHTML = '';
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 20; c++) {
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      const intensity = Math.random();
      const h = intensity > 0.75 ? 0 : intensity > 0.45 ? 30 : intensity > 0.2 ? 90 : 145;
      const alpha = 0.15 + intensity * 0.7;
      cell.style.background = `hsla(${h}, 90%, 50%, ${alpha})`;
      cell.title = `Zone (${r+1},${c+1}): ${Math.round(intensity*100)} violations`;
      grid.appendChild(cell);
    }
  }
}

// ─── Analytics Charts ─────────────────────────────────────────────────
function initAnalyticsCharts() {
  // 30-Day Trend
  const trendCtx = document.getElementById('trendLine').getContext('2d');
  const trend = generate30DayTrend();
  const dayLabels = Array.from({length:30}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate() - (29 - i));
    return d.toLocaleDateString('en-IN', { month:'short', day:'numeric' });
  });
  new Chart(trendCtx, {
    type: 'line',
    data: {
      labels: dayLabels,
      datasets: [{
        label: 'Violations',
        data: trend,
        borderColor: '#00d4ff',
        borderWidth: 2,
        backgroundColor: 'rgba(0,212,255,0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: { ...CHART_DEFAULTS.plugins, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4a5a7a', maxTicksLimit: 8 } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4a5a7a' } },
      },
    },
  });

  // Type Bar
  const typeCtx = document.getElementById('typeBar').getContext('2d');
  const typeCounts = VIOLATION_TYPES.map(v => randInt(80, 420));
  new Chart(typeCtx, {
    type: 'bar',
    data: {
      labels: VIOLATION_TYPES.map(v => v.label.split(' ').slice(0,2).join(' ')),
      datasets: [{
        data: typeCounts,
        backgroundColor: CHART_COLORS.map(c => c + 'cc'),
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      indexAxis: 'y',
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4a5a7a' } },
        y: { grid: { display: false }, ticks: { color: '#8b9ec4', font: { size: 10 } } },
      },
    },
  });

  // Time Heatmap (Day × Hour)
  initTimeHeatmap();

  // Location List
  initLocationList();

  // Condition Radar
  const radarCtx = document.getElementById('conditionRadar').getContext('2d');
  new Chart(radarCtx, {
    type: 'radar',
    data: {
      labels: ['Clear', 'Overcast', 'Rain', 'Fog', 'Night', 'Dawn/Dusk'],
      datasets: [
        { label: 'Accuracy', data: [97, 94, 88, 85, 90, 93], borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.15)', borderWidth: 2, pointRadius: 3 },
        { label: 'Recall',   data: [96, 92, 86, 82, 88, 91], borderColor: '#00ff88', backgroundColor: 'rgba(0,255,136,0.08)',  borderWidth: 2, pointRadius: 3 },
      ],
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: { legend: { display: true, labels: { color: '#8b9ec4', font: { size: 10 } } } },
      scales: { r: { grid: { color: 'rgba(255,255,255,0.08)' }, pointLabels: { color: '#8b9ec4', font: { size: 9 } }, ticks: { display: false }, min: 70, max: 100 } },
    },
  });

  // Vehicle Bar
  const vehicleCtx = document.getElementById('vehicleBar').getContext('2d');
  new Chart(vehicleCtx, {
    type: 'bar',
    data: {
      labels: VEHICLE_TYPES,
      datasets: [{
        data: [420, 380, 95, 62, 140, 28],
        backgroundColor: ['rgba(0,212,255,0.6)','rgba(255,59,92,0.6)','rgba(168,85,247,0.6)','rgba(255,149,0,0.6)','rgba(0,196,176,0.6)','rgba(255,214,10,0.6)'],
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        x: { grid: { display: false }, ticks: { color: '#8b9ec4', font: { size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4a5a7a' } },
      },
    },
  });
}

function initTimeHeatmap() {
  const el = document.getElementById('timeHeatmap');
  el.innerHTML = '';
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const hours = Array.from({length:24}, (_,i) => i % 4 === 0 ? (i === 0 ? '12a' : i < 12 ? `${i}a` : i === 12 ? '12p' : `${i-12}p`) : '');

  // Header row
  el.appendChild(Object.assign(document.createElement('div'), { className: 'th-header' }));
  hours.forEach(h => {
    const cell = document.createElement('div');
    cell.className = 'th-header';
    cell.textContent = h;
    el.appendChild(cell);
  });

  days.forEach(day => {
    const dayEl = document.createElement('div');
    dayEl.className = 'th-day';
    dayEl.textContent = day;
    el.appendChild(dayEl);
    for (let h = 0; h < 24; h++) {
      const cell = document.createElement('div');
      cell.className = 'th-cell';
      const morning = Math.exp(-0.5*Math.pow((h-9)/2,2));
      const evening = Math.exp(-0.5*Math.pow((h-18)/2.5,2));
      const intensity = (morning + evening) * (0.6 + Math.random()*0.4);
      const hue = intensity > 0.7 ? 0 : intensity > 0.4 ? 20 : 200;
      cell.style.background = `hsla(${hue}, 85%, 55%, ${0.1 + intensity * 0.75})`;
      cell.title = `${day} ${h}:00 — ${Math.round(intensity*50)} violations`;
      el.appendChild(cell);
    }
  });
}

function initLocationList() {
  const el = document.getElementById('locationList');
  const locations = LOCATIONS.slice(0, 8).map((loc, i) => ({
    name: loc, count: randInt(30, 180) - i * 12,
  })).sort((a,b) => b.count - a.count);
  const max = locations[0].count;
  locations.forEach((loc, i) => {
    const item = document.createElement('div');
    item.className = 'location-item';
    item.innerHTML = `
      <div class="location-rank">${i+1}</div>
      <div class="location-info">
        <div class="location-name">${loc.name}</div>
        <div class="location-count">${loc.count} violations today</div>
      </div>
      <div class="location-bar-wrap"><div class="location-bar" style="width:${(loc.count/max)*100}%"></div></div>
    `;
    el.appendChild(item);
  });
}

// ─── Performance Page ─────────────────────────────────────────────────
function drawRing(canvasId, value, color1 = '#00d4ff', color2 = '#00ff88') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cx = 60, cy = 60, r = 48;
  const startAngle = -Math.PI/2;
  const endAngle = startAngle + (value/100) * 2 * Math.PI;

  ctx.clearRect(0, 0, 120, 120);

  // Track
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2*Math.PI);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 10;
  ctx.stroke();

  // Value arc
  const grad = ctx.createLinearGradient(0, 0, 120, 120);
  grad.addColorStop(0, color1);
  grad.addColorStop(1, color2);
  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, endAngle);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function initPerformancePage() {
  drawRing('accRing', 95.8);
  drawRing('preRing', 94.2, '#a855f7', '#00d4ff');
  drawRing('recRing', 93.7, '#00ff88', '#00c4b0');
  drawRing('f1Ring',  93.9, '#ff9500', '#ffd60a');
  drawRing('mapRing', 97.3, '#00d4ff', '#a855f7');
  drawRing('ocrRing', 94.1, '#00c4b0', '#00ff88');

  initClassPerfTable();
  initConfusionMatrix();
  initPRCurve();
  initEfficiencyStats();
  initModelInfo();
}

function initClassPerfTable() {
  const el = document.getElementById('classPerfTable');
  const table = document.createElement('table');
  table.className = 'class-table';
  table.innerHTML = `
    <thead><tr>
      <th>Violation Class</th><th>Precision</th><th>Recall</th>
      <th>F1-Score</th><th>mAP</th><th>Samples</th><th>Performance</th>
    </tr></thead>
    <tbody>${CLASS_PERFORMANCE.map(c => `
      <tr>
        <td class="class-name">${c.name}</td>
        <td>${c.precision}%</td>
        <td>${c.recall}%</td>
        <td>${c.f1}%</td>
        <td>${c.mAP}%</td>
        <td>${c.samples.toLocaleString()}</td>
        <td>
          <div style="display:flex;align-items:center;gap:4px">
            <div class="class-bar-wrap"><div class="class-bar" style="width:${c.mAP}%"></div></div>
            <span style="font-size:0.7rem;color:#8b9ec4">${c.mAP}%</span>
          </div>
        </td>
      </tr>`).join('')}
    </tbody>
  `;
  el.appendChild(table);
}

function initConfusionMatrix() {
  const el = document.getElementById('confusionMatrix');
  const classes = ['Helmet','Seatbelt','Triple','Wrongside','Stopline','RedLight','Parking'];
  const n = classes.length;
  el.style.gridTemplateColumns = `50px repeat(${n}, 1fr)`;
  el.style.display = 'grid';
  el.style.gap = '2px';
  el.style.fontSize = '0.55rem';

  // Header
  el.appendChild(document.createElement('div'));
  classes.forEach(c => {
    const th = document.createElement('div');
    th.style.cssText = 'text-align:center;color:#4a5a7a;padding:2px;font-size:0.55rem;';
    th.textContent = c.substring(0,5);
    el.appendChild(th);
  });

  classes.forEach((rowClass, r) => {
    const rowLabel = document.createElement('div');
    rowLabel.style.cssText = 'color:#4a5a7a;display:flex;align-items:center;font-size:0.55rem;';
    rowLabel.textContent = rowClass.substring(0,5);
    el.appendChild(rowLabel);

    classes.forEach((_,c) => {
      const cell = document.createElement('div');
      cell.className = 'cm-cell';
      let val, alpha;
      if (r === c) { val = randInt(88,99); alpha = 0.6 + (val/100)*0.3; cell.style.background = `rgba(0,255,136,${alpha})`; }
      else { val = randInt(0,8); alpha = val/100; cell.style.background = `rgba(255,59,92,${alpha+0.05})`; }
      cell.style.color = r===c ? '#003322' : val > 4 ? '#ff3b5c' : '#4a5a7a';
      cell.textContent = val;
      el.appendChild(cell);
    });
  });
}

function initPRCurve() {
  const ctx = document.getElementById('prCurve').getContext('2d');
  const points = [];
  let r = 1.0;
  for (let i = 0; i <= 20; i++) {
    const p = 0.6 + 0.4 * Math.pow(1 - r, 0.3) + (Math.random()-0.5)*0.02;
    points.push({x: r, y: Math.min(1, p)});
    r -= 0.05;
  }
  new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'P-R Curve',
        data: points,
        borderColor: '#a855f7',
        backgroundColor: 'rgba(168,85,247,0.1)',
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      parsing: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Recall', color: '#4a5a7a', font:{size:10} }, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4a5a7a' }, min: 0, max: 1 },
        y: { title: { display: true, text: 'Precision', color: '#4a5a7a', font:{size:10} }, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4a5a7a' }, min: 0, max: 1 },
      },
    },
  });
}

function initEfficiencyStats() {
  const stats = [
    { label: 'GPU Utilization',    val: 78, unit: '%',   bar: '#00d4ff' },
    { label: 'CPU Usage',          val: 42, unit: '%',   bar: '#00ff88' },
    { label: 'Memory Usage',       val: 61, unit: '%',   bar: '#a855f7' },
    { label: 'Throughput',         val: 85, unit: ' fps',bar: '#ff9500' },
    { label: 'Queue Processing',   val: 94, unit: '%',   bar: '#00c4b0' },
    { label: 'Uptime (30-day)',    val: 99, unit: '%',   bar: '#00ff88' },
  ];
  const el = document.getElementById('efficiencyStats');
  stats.forEach(s => {
    const item = document.createElement('div');
    item.className = 'eff-item';
    item.innerHTML = `
      <div class="eff-label">${s.label} <span>${s.val}${s.unit}</span></div>
      <div class="eff-bar-wrap"><div class="eff-bar" style="width:${s.val}%;background:${s.bar}"></div></div>
    `;
    el.appendChild(item);
  });
}

function initModelInfo() {
  const rows = [
    ['Architecture', 'YOLOv8-L + ResNet50'],
    ['Input Resolution', '1280×720 px'],
    ['Parameters', '68.2M'],
    ['FLOPs', '265.7G'],
    ['Framework', 'PyTorch 2.1 + ONNX'],
    ['OCR Engine', 'Tesseract v5 + CRNN'],
    ['Training Dataset', '2.4M images'],
    ['GPU Hardware', 'NVIDIA A100 80GB'],
    ['Inference Time', '142ms avg'],
    ['Batch Size', '16 images'],
    ['Quantization', 'INT8 (TensorRT)'],
    ['Deployed On', 'Edge + Cloud Hybrid'],
  ];
  const el = document.getElementById('modelInfo');
  rows.forEach(([k,v]) => {
    const row = document.createElement('div');
    row.className = 'model-row';
    row.innerHTML = `<span class="model-key">${k}</span><span class="model-val">${v}</span>`;
    el.appendChild(row);
  });
}

// ─── Gallery Page ─────────────────────────────────────────────────────
const SAMPLE_IMAGES = [
  { src: 'file:///C:/Users/Tara0/.gemini/antigravity/brain/d064356b-bcad-425f-a414-307a03dc5760/traffic_sample_1_1781635086184.png', name: 'Intersection Scene', desc: 'Multiple violations detected', tags: ['redlight', 'helmet', 'stopline'] },
  { src: 'file:///C:/Users/Tara0/.gemini/antigravity/brain/d064356b-bcad-425f-a414-307a03dc5760/traffic_sample_2_1781635103477.png', name: 'Night Scene', desc: 'Low-light detection', tags: ['helmet', 'parking'] },
  { src: 'file:///C:/Users/Tara0/.gemini/antigravity/brain/d064356b-bcad-425f-a414-307a03dc5760/traffic_sample_3_1781635114927.png', name: 'Highway Scene', desc: 'Triple riding & wrong-side', tags: ['triple', 'wrongside'] },
];

function initGallery() {
  const grid = document.getElementById('galleryGrid');
  grid.innerHTML = '';

  State.galleryData.forEach((v, i) => {
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.dataset.type = v.type.id;
    card.dataset.severity = v.severity;

    // Thumbnail canvas
    const canvas = document.createElement('canvas');
    canvas.className = 'gallery-thumb-canvas';
    canvas.width = 280; canvas.height = 160;
    card.appendChild(canvas);

    const meta = document.createElement('div');
    meta.className = 'gallery-meta';
    meta.innerHTML = `
      <div class="gallery-violation">
        <span class="gallery-vtype">${v.type.icon} ${v.type.label}</span>
        <span class="severity-badge ${v.severity}">${v.severity}</span>
      </div>
      <div class="gallery-plate">🔤 ${v.plate}</div>
      <div class="gallery-details">
        <span>${v.location.split(' ').slice(0,3).join(' ')}</span>
        <span class="gallery-conf">${v.confidence}%</span>
      </div>
    `;
    card.appendChild(meta);
    card.addEventListener('click', () => openViolationModal(v));
    grid.appendChild(card);

    // Draw thumbnail
    requestAnimationFrame(() => drawThumbnail(canvas, v));
  });
}

function drawThumbnail(canvas, violation) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  // Background
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#080c18');
  grad.addColorStop(1, '#111829');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = 'rgba(0,212,255,0.06)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += 30) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for (let y = 0; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

  // Random vehicles
  const numVehicles = randInt(2, 5);
  for (let i = 0; i < numVehicles; i++) {
    const vx = randInt(20, w-60), vy = randInt(20, h-40);
    const vw = randInt(30, 60), vh = randInt(15, 25);
    const isViolation = i === 0;
    ctx.fillStyle = isViolation ? `rgba(255,59,92,0.25)` : 'rgba(255,255,255,0.08)';
    ctx.strokeStyle = isViolation ? violation.type.color : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = isViolation ? 2 : 1;
    roundRect(ctx, vx, vy, vw, vh, 3);

    if (isViolation) {
      // Label
      ctx.fillStyle = violation.type.color;
      ctx.font = 'bold 8px JetBrains Mono, monospace';
      ctx.fillText(violation.type.label.split(' ').slice(0,2).join(' '), vx, vy - 4);
      // Confidence
      ctx.fillStyle = '#00ff88';
      ctx.font = '7px Inter';
      ctx.fillText(`${violation.confidence}%`, vx + vw + 4, vy + vh/2 + 3);
    }
  }

  // Plate box
  const px = randInt(30, w-80), py = randInt(30, h-30);
  ctx.strokeStyle = '#00d4ff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px, py, 60, 16);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(px, py, 60, 16);
  ctx.fillStyle = '#00d4ff';
  ctx.font = 'bold 7px JetBrains Mono, monospace';
  ctx.fillText(violation.plate.substring(0,8), px+3, py+11);

  // Overlay text
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, h-22, w, 22);
  ctx.fillStyle = '#8b9ec4';
  ctx.font = '9px Inter';
  ctx.fillText(`${violation.camera} · ${violation.location.split(' ').slice(0,2).join(' ')}`, 6, h-8);
  ctx.fillStyle = violation.type.color;
  ctx.font = 'bold 9px Inter';
  ctx.textAlign = 'right';
  ctx.fillText(violation.type.icon + ' ' + violation.severity.toUpperCase(), w-6, h-8);
  ctx.textAlign = 'left';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// Gallery filters
function bindGalleryFilters() {
  const filterType = document.getElementById('filterType');
  const filterSev  = document.getElementById('filterSeverity');
  const search     = document.getElementById('gallerySearch');

  [filterType, filterSev, search].forEach(el => el.addEventListener('change', filterGallery));
  search.addEventListener('input', filterGallery);
}

function filterGallery() {
  const typeVal = document.getElementById('filterType').value;
  const sevVal  = document.getElementById('filterSeverity').value;
  const search  = document.getElementById('gallerySearch').value.toLowerCase();

  document.querySelectorAll('.gallery-card').forEach((card, i) => {
    const v = State.galleryData[i];
    if (!v) return;
    const matchType = !typeVal || v.type.id === typeVal;
    const matchSev  = !sevVal  || v.severity === sevVal;
    const matchSearch = !search || v.plate.toLowerCase().includes(search) || v.location.toLowerCase().includes(search) || v.type.label.toLowerCase().includes(search);
    card.style.display = (matchType && matchSev && matchSearch) ? '' : 'none';
  });
}

// ─── Demo Canvas (Hero) ───────────────────────────────────────────────
let demoAnimFrame;
let demoBoxes = [];
const DEMO_WIDTH = 420, DEMO_HEIGHT = 280;

function initDemoCanvas() {
  const canvas = document.getElementById('demoCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Initialize boxes
  demoBoxes = Array.from({length:6}, (_,i) => ({
    x: randInt(20, DEMO_WIDTH-80),
    y: randInt(20, DEMO_HEIGHT-60),
    w: randInt(50, 100),
    h: randInt(30, 55),
    vx: (Math.random()-0.5) * 0.8,
    vy: (Math.random()-0.5) * 0.4,
    type: VIOLATION_TYPES[i % VIOLATION_TYPES.length],
    conf: randFloat(85, 99.5),
    plate: generatePlate(),
    isViolation: i < 3,
  }));

  function drawFrame() {
    ctx.clearRect(0, 0, DEMO_WIDTH, DEMO_HEIGHT);

    // BG
    ctx.fillStyle = '#060910';
    ctx.fillRect(0, 0, DEMO_WIDTH, DEMO_HEIGHT);

    // Scan line effect
    const scanY = (Date.now() / 20) % DEMO_HEIGHT;
    const scanGrad = ctx.createLinearGradient(0, scanY-20, 0, scanY+20);
    scanGrad.addColorStop(0, 'rgba(0,212,255,0)');
    scanGrad.addColorStop(0.5, 'rgba(0,212,255,0.06)');
    scanGrad.addColorStop(1, 'rgba(0,212,255,0)');
    ctx.fillStyle = scanGrad;
    ctx.fillRect(0, scanY-20, DEMO_WIDTH, 40);

    // Grid
    ctx.strokeStyle = 'rgba(0,212,255,0.05)';
    ctx.lineWidth = 0.5;
    for (let x=0; x<DEMO_WIDTH; x+=40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,DEMO_HEIGHT); ctx.stroke(); }
    for (let y=0; y<DEMO_HEIGHT; y+=40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(DEMO_WIDTH,y); ctx.stroke(); }

    // Road markings
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([20,15]);
    ctx.beginPath(); ctx.moveTo(0, DEMO_HEIGHT/2); ctx.lineTo(DEMO_WIDTH, DEMO_HEIGHT/2); ctx.stroke();
    ctx.setLineDash([]);

    // Update & draw boxes
    demoBoxes.forEach(box => {
      box.x += box.vx;
      box.y += box.vy;
      if (box.x < 0 || box.x + box.w > DEMO_WIDTH) box.vx *= -1;
      if (box.y < 0 || box.y + box.h > DEMO_HEIGHT) box.vy *= -1;

      const color = box.isViolation ? box.type.color : '#00d4ff';
      const alpha = box.isViolation ? '0.8' : '0.4';

      // Box
      ctx.strokeStyle = color;
      ctx.lineWidth = box.isViolation ? 2 : 1.5;
      ctx.globalAlpha = parseFloat(alpha);
      ctx.strokeRect(box.x, box.y, box.w, box.h);

      // Corner accents
      const cLen = 8;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      [[0,0],[1,0],[0,1],[1,1]].forEach(([cx,cy]) => {
        const ox = box.x + cx * box.w;
        const oy = box.y + cy * box.h;
        ctx.beginPath();
        ctx.moveTo(ox + (cx ? -cLen : cLen), oy);
        ctx.lineTo(ox, oy);
        ctx.lineTo(ox, oy + (cy ? -cLen : cLen));
        ctx.stroke();
      });

      if (box.isViolation) {
        // Label bg
        const label = box.type.label.substring(0, 16);
        ctx.font = 'bold 8px Inter, sans-serif';
        const lw = ctx.measureText(label).width + 8;
        ctx.fillStyle = box.type.color;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(box.x, box.y - 16, lw, 14);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.fillText(label, box.x + 4, box.y - 5);

        // Conf
        ctx.fillStyle = '#00ff88';
        ctx.font = '7px JetBrains Mono, monospace';
        ctx.fillText(`${box.conf}%`, box.x + box.w + 3, box.y + 10);

        // Plate
        ctx.fillStyle = '#00d4ff';
        ctx.font = 'bold 7px JetBrains Mono, monospace';
        ctx.fillText(box.plate, box.x, box.y + box.h + 10);
      } else {
        ctx.fillStyle = '#00d4ff';
        ctx.font = 'bold 7px Inter';
        ctx.globalAlpha = 0.7;
        ctx.fillText(VEHICLE_TYPES[Math.floor(Math.random()*4)], box.x, box.y - 4);
        ctx.globalAlpha = 1;
      }
    });

    // HUD overlay
    ctx.fillStyle = 'rgba(0,212,255,0.7)';
    ctx.font = 'bold 7px JetBrains Mono, monospace';
    ctx.fillText(`FRAME: ${String(Math.floor(Date.now()/33)).padStart(8,'0')}`, 8, DEMO_HEIGHT-20);
    ctx.fillStyle = '#00ff88';
    ctx.fillText(`DETECT: ${demoBoxes.filter(b=>b.isViolation).length} VIOLATIONS`, 8, DEMO_HEIGHT-10);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8b9ec4';
    ctx.fillText(`YOLOv8-L ·  97.3% mAP`, DEMO_WIDTH-8, DEMO_HEIGHT-10);
    ctx.textAlign = 'left';

    demoAnimFrame = requestAnimationFrame(drawFrame);
  }
  drawFrame();
}

// ─── Image Analysis (Simulate) ────────────────────────────────────────
const PROCESSING_STEPS_DEF = [
  { label: 'Loading & decoding image', time: '12ms' },
  { label: 'Noise reduction & deblurring', time: '28ms' },
  { label: 'Contrast normalization & enhancement', time: '15ms' },
  { label: 'Vehicle & road-user detection (YOLOv8)', time: '48ms' },
  { label: 'Classification & confidence scoring', time: '22ms' },
  { label: 'Violation rule validation', time: '8ms' },
  { label: 'License plate localization', time: '18ms' },
  { label: 'OCR extraction (Tesseract)', time: '34ms' },
  { label: 'Annotation & evidence generation', time: '11ms' },
];

function bindUploadZone() {
  const zone = document.getElementById('uploadZone');
  const input = document.getElementById('fileInput');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) analyzeImage(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files[0]) analyzeImage(input.files[0]); });

  // Sample grid
  const sampleGrid = document.getElementById('sampleGrid');
  SAMPLE_IMAGES.forEach((s, i) => {
    const item = document.createElement('div');
    item.className = 'sample-item';
    const img = document.createElement('img');
    img.src = s.src.replace(/\\/g, '/').replace('C:/', '/');
    img.className = 'sample-thumb';
    img.alt = s.name;
    img.onerror = () => img.src = '';
    item.innerHTML = `
      <div class="sample-info">
        <div class="sample-name">${s.name}</div>
        <div class="sample-desc">${s.desc}</div>
      </div>
      <span class="sample-tag">${s.tags.length} violations</span>
    `;
    item.insertBefore(img, item.firstChild);
    item.addEventListener('click', () => analyzeSampleImage(i));
    sampleGrid.appendChild(item);
  });

  document.getElementById('analyzeAnotherBtn').addEventListener('click', resetAnalysis);
  document.getElementById('downloadBtn').addEventListener('click', downloadEvidence);
}

function analyzeImage(file) {
  if (backendOnline) {
    // ── Real backend path ──────────────────────────────────────────
    showProcessingUI();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('camera', `CAM-${String(Math.floor(Math.random()*24)+1).padStart(2,'0')}`);

    fetch(`${API_BASE}/api/analyze`, { method: 'POST', body: formData })
      .then(res => {
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        return res.json();
      })
      .then(data => showBackendResults(data))
      .catch(err => {
        console.warn('Backend analyze failed, using simulation:', err);
        const reader = new FileReader();
        reader.onload = e => startAnalysis(e.target.result, file.name);
        reader.readAsDataURL(file);
      });
  } else {
    // ── Simulation fallback ────────────────────────────────────────
    const reader = new FileReader();
    reader.onload = e => startAnalysis(e.target.result, file.name);
    reader.readAsDataURL(file);
  }
}

function analyzeSampleImage(idx) {
  const sample = SAMPLE_IMAGES[idx];
  const violations = sample.tags.map(tag => VIOLATION_TYPES.find(v => v.id === tag)).filter(Boolean);
  startAnalysis(null, sample.name, violations, sample.src);
}

// Show animated pipeline UI while backend processes
function showProcessingUI() {
  document.getElementById('analysisPlaceholder').style.display = 'none';
  document.getElementById('processingSteps').style.display = 'block';
  document.getElementById('analysisResults').style.display  = 'none';

  const stepList = document.getElementById('stepList');
  stepList.innerHTML = '';
  PROCESSING_STEPS_DEF.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'step-item';
    el.innerHTML = `
      <div class="step-icon pending" id="stepIcon${i}">${i+1}</div>
      <span class="step-label" id="stepLabel${i}">${s.label}</span>
      <span class="step-time" id="stepTime${i}">–</span>
    `;
    stepList.appendChild(el);
  });

  // Animate steps while waiting
  let cur = 0;
  const interval = setInterval(() => {
    if (cur > 0) {
      document.getElementById(`stepIcon${cur-1}`).className = 'step-icon done';
      document.getElementById(`stepIcon${cur-1}`).textContent = '✓';
      document.getElementById(`stepLabel${cur-1}`).classList.add('done');
      document.getElementById(`stepTime${cur-1}`).textContent = PROCESSING_STEPS_DEF[cur-1].time;
    }
    if (cur >= PROCESSING_STEPS_DEF.length) { clearInterval(interval); return; }
    document.getElementById(`stepIcon${cur}`).className = 'step-icon running';
    document.getElementById(`stepIcon${cur}`).textContent = '⟳';
    cur++;
  }, 400);
  window._stepInterval = interval;
}

// Render results from real backend response
function showBackendResults(data) {
  if (window._stepInterval) { clearInterval(window._stepInterval); }
  // Mark all steps done
  PROCESSING_STEPS_DEF.forEach((s, i) => {
    const icon = document.getElementById(`stepIcon${i}`);
    const lbl  = document.getElementById(`stepLabel${i}`);
    const tm   = document.getElementById(`stepTime${i}`);
    if (icon) { icon.className = 'step-icon done'; icon.textContent = '✓'; }
    if (lbl) lbl.classList.add('done');
    if (tm) tm.textContent = s.time;
  });

  document.getElementById('processingSteps').style.display = 'none';
  const results = document.getElementById('analysisResults');
  results.style.display = 'flex';

  // Show annotated image from backend
  const canvas = document.getElementById('resultCanvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = () => {
    canvas.width  = img.naturalWidth  || 600;
    canvas.height = img.naturalHeight || 400;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = data.image_annotated;

  // Result details from real data
  const violations = data.violations || [];
  const plates     = data.plates     || [];
  const meta       = data.metadata   || {};
  const perf       = data.performance || {};
  const plate_text = plates.length ? plates[0].text : generatePlate();

  document.getElementById('downloadBtn').dataset.plate = plate_text;

  const details = document.getElementById('resultDetails');
  const violBadges = violations.length
    ? violations.map(v =>
        `<div class="detection-badge ${v.severity}">${v.icon || '⚠️'} ${v.label} · ${(v.confidence*100).toFixed(1)}%</div>`
      ).join('')
    : '<div class="detection-badge ok">✅ No violations detected</div>';

  details.innerHTML = `
    <div class="result-section-title">Detected Violations (Real AI)</div>
    <div class="detection-badge-grid">${violBadges}</div>
    <div class="result-section-title" style="margin-top:12px">Metadata</div>
    <div class="meta-grid">
      <div class="meta-item"><div class="meta-label">License Plate(s)</div>
        <div class="meta-value plate">${plates.map(p=>p.text).join(', ') || 'Not detected'}</div></div>
      <div class="meta-item"><div class="meta-label">Processing Time</div>
        <div class="meta-value conf">${perf.total_ms || '–'}ms</div></div>
      <div class="meta-item"><div class="meta-label">Vehicles Detected</div>
        <div class="meta-value">${meta.vehicle_count ?? '–'}</div></div>
      <div class="meta-item"><div class="meta-label">Image Quality</div>
        <div class="meta-value">${meta.image_quality || '–'}</div></div>
      <div class="meta-item"><div class="meta-label">Weather Estimate</div>
        <div class="meta-value">${meta.weather_estimate || '–'}</div></div>
      <div class="meta-item"><div class="meta-label">Lighting</div>
        <div class="meta-value">${meta.lighting || '–'}</div></div>
      <div class="meta-item"><div class="meta-label">Analysis ID</div>
        <div class="meta-value">${data.analysis_id || '–'}</div></div>
      <div class="meta-item"><div class="meta-label">Detection Engine</div>
        <div class="meta-value">YOLOv8 + EasyOCR</div></div>
    </div>
    ${ perf.detection_ms ? `
    <div class="result-section-title" style="margin-top:12px">Performance Breakdown</div>
    <div class="meta-grid">
      <div class="meta-item"><div class="meta-label">Preprocess</div><div class="meta-value">${perf.preprocess_ms}ms</div></div>
      <div class="meta-item"><div class="meta-label">Detection</div><div class="meta-value">${perf.detection_ms}ms</div></div>
      <div class="meta-item"><div class="meta-label">OCR</div><div class="meta-value">${perf.ocr_ms}ms</div></div>
      <div class="meta-item"><div class="meta-label">Annotation</div><div class="meta-value">${perf.annotation_ms}ms</div></div>
    </div>` : '' }
  `;
}

function startAnalysis(imgSrc, name, presetViolations = null, fallbackSrc = null) {
  const placeholder = document.getElementById('analysisPlaceholder');
  const steps = document.getElementById('processingSteps');
  const results = document.getElementById('analysisResults');

  placeholder.style.display = 'none';
  steps.style.display = 'block';
  results.style.display = 'none';

  const stepList = document.getElementById('stepList');
  stepList.innerHTML = '';
  const stepEls = PROCESSING_STEPS_DEF.map((s, i) => {
    const el = document.createElement('div');
    el.className = 'step-item';
    el.innerHTML = `
      <div class="step-icon pending" id="stepIcon${i}">${i+1}</div>
      <span class="step-label" id="stepLabel${i}">${s.label}</span>
      <span class="step-time" id="stepTime${i}">–</span>
    `;
    stepList.appendChild(el);
    return el;
  });

  let current = 0;
  function runStep() {
    if (current > 0) {
      const prev = current - 1;
      document.getElementById(`stepIcon${prev}`).className = 'step-icon done';
      document.getElementById(`stepIcon${prev}`).textContent = '✓';
      document.getElementById(`stepLabel${prev}`).classList.add('done');
    }
    if (current >= PROCESSING_STEPS_DEF.length) {
      finishAnalysis(imgSrc || fallbackSrc, name, presetViolations);
      return;
    }
    const icon = document.getElementById(`stepIcon${current}`);
    const time = document.getElementById(`stepTime${current}`);
    icon.className = 'step-icon running';
    icon.textContent = '⟳';
    time.textContent = '...';
    setTimeout(() => {
      time.textContent = PROCESSING_STEPS_DEF[current].time;
      current++;
      setTimeout(runStep, randInt(80, 280));
    }, randInt(200, 600));
  }
  runStep();
}

function finishAnalysis(imgSrc, name, presetViolations = null) {
  document.getElementById('processingSteps').style.display = 'none';
  const results = document.getElementById('analysisResults');
  results.style.display = 'flex';

  const violations = presetViolations || [
    VIOLATION_TYPES[randInt(0, VIOLATION_TYPES.length-1)],
    ...(Math.random() > 0.5 ? [VIOLATION_TYPES[randInt(0, VIOLATION_TYPES.length-1)]] : []),
  ].filter((v, i, arr) => arr.findIndex(x => x.id === v.id) === i);

  const plate = generatePlate();
  const conf  = randFloat(91, 99.2);

  const canvas = document.getElementById('resultCanvas');
  const ctx = canvas.getContext('2d');

  function drawAnnotated(bgImg) {
    canvas.width = 600; canvas.height = 400;
    if (bgImg) {
      ctx.drawImage(bgImg, 0, 0, 600, 400);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 600, 400);
      grad.addColorStop(0, '#080c18'); grad.addColorStop(1, '#111829');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, 600, 400);
      ctx.strokeStyle = 'rgba(0,212,255,0.05)'; ctx.lineWidth = 0.5;
      for (let x=0;x<600;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,400);ctx.stroke();}
      for (let y=0;y<400;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(600,y);ctx.stroke();}
    }
    // Dark overlay
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, 600, 400);

    // Draw vehicles
    const boxes = [
      { x: 60, y: 80, w: 140, h: 90, violation: violations[0] },
      { x: 340, y: 120, w: 120, h: 75, violation: violations[1] || null },
      { x: 200, y: 240, w: 100, h: 60, violation: null },
      { x: 450, y: 280, w: 90, h: 55, violation: null },
    ];

    boxes.forEach((box) => {
      const color = box.violation ? box.violation.color : 'rgba(255,255,255,0.4)';
      ctx.strokeStyle = color;
      ctx.lineWidth = box.violation ? 2.5 : 1.5;
      ctx.strokeRect(box.x, box.y, box.w, box.h);

      // Corners
      [[0,0],[1,0],[0,1],[1,1]].forEach(([cx,cy]) => {
        const ox = box.x + cx * box.w, oy = box.y + cy * box.h;
        ctx.beginPath();
        ctx.moveTo(ox + (cx ? -10 : 10), oy); ctx.lineTo(ox, oy); ctx.lineTo(ox, oy + (cy ? -10 : 10));
        ctx.stroke();
      });

      if (box.violation) {
        // Label
        ctx.fillStyle = box.violation.color;
        ctx.globalAlpha = 0.92;
        const lbl = `${box.violation.icon} ${box.violation.label}`;
        ctx.font = 'bold 11px Inter, sans-serif';
        const lw = ctx.measureText(lbl).width + 12;
        ctx.fillRect(box.x, box.y - 20, lw, 18);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.fillText(lbl, box.x + 6, box.y - 6);
        // Confidence
        ctx.fillStyle = '#00ff88';
        ctx.font = 'bold 10px JetBrains Mono';
        ctx.fillText(`${conf}%`, box.x + box.w + 5, box.y + 15);
      } else {
        ctx.fillStyle = '#00d4ff';
        ctx.font = 'bold 9px Inter';
        ctx.globalAlpha = 0.7;
        ctx.fillText(randFrom(VEHICLE_TYPES), box.x, box.y - 5);
        ctx.globalAlpha = 1;
      }
    });

    // Plate detection
    const px = 60, py = 280;
    ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2;
    ctx.strokeRect(px, py, 100, 26);
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(px, py, 100, 26);
    ctx.fillStyle = '#00d4ff'; ctx.font = 'bold 12px JetBrains Mono';
    ctx.fillText(plate, px + 5, py + 17);

    // HUD
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 370, 600, 30);
    ctx.fillStyle = '#8b9ec4'; ctx.font = '10px Inter';
    ctx.fillText(`TrafficAI v2.4 · ${new Date().toLocaleString('en-IN')} · YOLOv8-L`, 10, 389);
    ctx.fillStyle = '#00ff88'; ctx.font = 'bold 10px Inter'; ctx.textAlign = 'right';
    ctx.fillText(`${violations.length} VIOLATION(S) DETECTED`, 590, 389);
    ctx.textAlign = 'left';
  }

  if (imgSrc) {
    const img = new Image();
    img.onload = () => drawAnnotated(img);
    img.onerror = () => drawAnnotated(null);
    img.src = imgSrc;
  } else {
    drawAnnotated(null);
  }

  // Result Details
  const details = document.getElementById('resultDetails');
  details.innerHTML = `
    <div class="result-section-title">Detected Violations</div>
    <div class="detection-badge-grid">
      ${violations.map(v => `<div class="detection-badge ${v.severity}">${v.icon} ${v.label} · ${randFloat(91,99.5,1)}%</div>`).join('')}
    </div>
    <div class="result-section-title" style="margin-top:12px">Metadata</div>
    <div class="meta-grid">
      <div class="meta-item"><div class="meta-label">License Plate</div><div class="meta-value plate">${plate}</div></div>
      <div class="meta-item"><div class="meta-label">Confidence</div><div class="meta-value conf">${conf}%</div></div>
      <div class="meta-item"><div class="meta-label">Vehicle Type</div><div class="meta-value">${randFrom(VEHICLE_TYPES)}</div></div>
      <div class="meta-item"><div class="meta-label">Processing Time</div><div class="meta-value">${randInt(125, 165)}ms</div></div>
      <div class="meta-item"><div class="meta-label">Camera</div><div class="meta-value">CAM-${String(randInt(1,24)).padStart(2,'0')}</div></div>
      <div class="meta-item"><div class="meta-label">Timestamp</div><div class="meta-value">${new Date().toLocaleTimeString('en-IN')}</div></div>
      <div class="meta-item"><div class="meta-label">Location</div><div class="meta-value">${randFrom(LOCATIONS)}</div></div>
      <div class="meta-item"><div class="meta-label">Weather</div><div class="meta-value">${randFrom(['Clear','Overcast','Rain'])}</div></div>
    </div>
  `;

  // Store for download
  document.getElementById('downloadBtn').dataset.plate = plate;
}

function resetAnalysis() {
  document.getElementById('analysisPlaceholder').style.display = 'flex';
  document.getElementById('processingSteps').style.display = 'none';
  document.getElementById('analysisResults').style.display = 'none';
  document.getElementById('fileInput').value = '';
}

function downloadEvidence() {
  const canvas = document.getElementById('resultCanvas');
  const link = document.createElement('a');
  link.download = `evidence_${document.getElementById('downloadBtn').dataset.plate || 'violation'}_${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// ─── OCR Page ─────────────────────────────────────────────────────────
function initOCRPage() {
  const zone = document.getElementById('ocrUploadZone');
  const input = document.getElementById('ocrFileInput');
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files[0]) {
      const reader = new FileReader();
      reader.onload = e => runOCR(e.target.result);
      reader.readAsDataURL(input.files[0]);
    }
  });

  // Sample plates
  const samplesEl = document.getElementById('ocrSamplePlates');
  const samplePlates = [generatePlate(), generatePlate(), generatePlate(), generatePlate()];
  samplePlates.forEach(plate => {
    const btn = document.createElement('button');
    btn.className = 'plate-sample-btn';
    btn.innerHTML = `<span class="plate-icon">🔤</span> ${plate}`;
    btn.addEventListener('click', () => runOCRSimulated(plate));
    samplesEl.appendChild(btn);
  });

  // Lookup
  document.getElementById('lookupBtn').addEventListener('click', () => {
    const val = document.getElementById('plateInput').value.trim().toUpperCase();
    if (val) runLookup(val);
  });
  document.getElementById('plateInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('lookupBtn').click();
  });

  initOCRCanvas();
}

function initOCRCanvas() {
  const canvas = document.getElementById('ocrCanvas');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#080c18';
  ctx.fillRect(0, 0, 500, 320);
  ctx.strokeStyle = 'rgba(0,212,255,0.05)'; ctx.lineWidth = 0.5;
  for (let x=0;x<500;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,320);ctx.stroke();}
  for (let y=0;y<320;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(500,y);ctx.stroke();}
  ctx.fillStyle = '#1a2540'; ctx.fillRect(150, 120, 200, 80);
  ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2; ctx.strokeRect(150, 120, 200, 80);
  ctx.fillStyle = '#8b9ec4'; ctx.font = '14px Inter'; ctx.textAlign = 'center';
  ctx.fillText('Upload image to detect plates', 250, 168);
  ctx.textAlign = 'left';
}

function runOCRSimulated(plate) {
  const canvas = document.getElementById('ocrCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 500, 320);
  ctx.fillStyle = '#060910'; ctx.fillRect(0, 0, 500, 320);

  // Draw scene
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 0.5;
  for (let x=0;x<500;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,320);ctx.stroke();}
  for (let y=0;y<320;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(500,y);ctx.stroke();}

  // Vehicle
  ctx.strokeStyle = 'rgba(0,212,255,0.5)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(120, 80, 260, 160);

  // Plate box
  const px = 175, py = 195, pw = 150, ph = 35;
  ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2.5;
  ctx.strokeRect(px, py, pw, ph);

  // Plate bg
  ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(px, py, pw, ph);
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(px+2, py+2, pw-4, ph-4);
  ctx.fillStyle = '#000';
  ctx.font = 'bold 16px JetBrains Mono'; ctx.textAlign = 'center';
  ctx.fillText(plate, px + pw/2, py + ph/2 + 6);
  ctx.textAlign = 'left';

  // Label
  ctx.fillStyle = '#00d4ff'; ctx.font = 'bold 10px Inter';
  ctx.fillText(`PLATE DETECTED · ${randFloat(93, 99.5, 1)}%`, px, py-8);

  // Detected plates display
  const detectedEl = document.getElementById('detectedPlates');
  detectedEl.innerHTML = `
    <div class="plate-result">
      <div>
        <div class="plate-number">${plate}</div>
        <div class="plate-region">${plate.substring(0,2)} — ${plate.substring(0,2) === 'KA' ? 'Karnataka' : plate.substring(0,2) === 'MH' ? 'Maharashtra' : 'State'}</div>
      </div>
      <div class="plate-conf">${randFloat(93,99.5,1)}%</div>
    </div>
  `;

  // Auto lookup
  document.getElementById('plateInput').value = plate;
  runLookup(plate);
  addRecentLookup(plate);
}

function runOCR(imgSrc) {
  const plates = [generatePlate(), ...(Math.random() > 0.5 ? [generatePlate()] : [])];
  plates.forEach(p => runOCRSimulated(p));
}

function runLookup(plate) {
  const info = lookupPlate(plate);
  const el = document.getElementById('lookupResult');
  el.innerHTML = `
    <div style="background:rgba(255,213,0,0.12);border:1px solid rgba(255,213,0,0.4);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#ffd60a;line-height:1.5;">
      <strong>⚠️ DEMONSTRATION DATA ONLY</strong><br>
      This is simulated data for project demonstration purposes. Real vehicle registration lookup requires official access to the <strong>Vahan National Register</strong> (MoRTH, Government of India), which is restricted to authorised traffic enforcement agencies.
    </div>
    <div class="lookup-row"><span class="lookup-key">Plate</span><span class="lookup-val">${info.plate}</span></div>
    <div class="lookup-row"><span class="lookup-key">Owner</span><span class="lookup-val">${info.owner} <em style="color:#666;font-size:11px;">(simulated)</em></span></div>
    <div class="lookup-row"><span class="lookup-key">Vehicle</span><span class="lookup-val">${info.year} ${info.make} ${info.model}</span></div>
    <div class="lookup-row"><span class="lookup-key">Color</span><span class="lookup-val">${info.color}</span></div>
    <div class="lookup-row"><span class="lookup-key">Type</span><span class="lookup-val">${info.type}</span></div>
    <div class="lookup-row"><span class="lookup-key">State</span><span class="lookup-val">${info.state}</span></div>
    <div class="lookup-row"><span class="lookup-key">RTO</span><span class="lookup-val">${info.rto}</span></div>
    <div class="lookup-row"><span class="lookup-key">Insurance</span><span class="lookup-val ${info.insurance==='EXPIRED'?'flagged':''}">${info.insurance}</span></div>
    <div class="lookup-row"><span class="lookup-key">Fitness</span><span class="lookup-val ${info.fitness==='EXPIRED'?'flagged':''}">${info.fitness}</span></div>
    <div class="lookup-row"><span class="lookup-key">Prior Violations</span><span class="lookup-val ${info.previousViolations>5?'flagged':''}">${info.previousViolations}</span></div>
    ${info.flagged ? '<div class="lookup-row"><span class="lookup-key">⚠️ Status</span><span class="lookup-val flagged">FLAGGED VEHICLE</span></div>' : ''}
  `;
  addRecentLookup(plate);
}


function addRecentLookup(plate) {
  if (State.recentLookups.includes(plate)) return;
  State.recentLookups.unshift(plate);
  if (State.recentLookups.length > 6) State.recentLookups.pop();
  renderRecentLookups();
}

function renderRecentLookups() {
  const el = document.getElementById('recentLookups');
  el.innerHTML = '';
  State.recentLookups.forEach(plate => {
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.innerHTML = `<span class="recent-plate">${plate}</span><span class="recent-time">${randInt(1,30)}m ago</span>`;
    item.addEventListener('click', () => { document.getElementById('plateInput').value = plate; runLookup(plate); });
    el.appendChild(item);
  });
}

// ─── Reports Page ─────────────────────────────────────────────────────
function initReportsPage() {
  // Set date range defaults
  const today = new Date();
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
  document.getElementById('reportTo').valueAsDate = today;
  document.getElementById('reportFrom').valueAsDate = weekAgo;

  // Format buttons
  document.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Generate button
  document.getElementById('generateReportBtn').addEventListener('click', () => {
    const btn = document.getElementById('generateReportBtn');
    btn.textContent = '⟳ Generating…';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = '✓ Report Generated';
      btn.style.background = 'linear-gradient(135deg, #00ff88, #00c4b0)';
      addReport();
      setTimeout(() => {
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Generate Report';
        btn.style.background = '';
        btn.disabled = false;
      }, 2000);
    }, 2200);
  });

  initReportList();
  initRecordsTable();
}

function addReport() {
  const types = ['Daily Summary', 'Weekly Analysis', 'Custom Range', 'Violation-specific'];
  const sizes = ['1.2 MB', '3.4 MB', '850 KB', '2.1 MB'];
  const idx = randInt(0, types.length-1);
  const report = {
    name: `${document.getElementById('reportType').value} — ${new Date().toLocaleDateString('en-IN')}`,
    meta: `${State.dataset.length} violations · Auto-generated`,
    size: sizes[idx],
    icon: '📊',
  };
  State.reportsList.unshift(report);
  renderReportList();
}

function initReportList() {
  const reports = [
    { name: 'Daily Summary — 16 Jun 2026', meta: '247 violations · PDF', size: '1.8 MB', icon: '📋' },
    { name: 'Weekly Analysis — W24 2026', meta: '1,423 violations · PDF', size: '4.2 MB', icon: '📊' },
    { name: 'Red-Light Violations — Jun 2026', meta: '312 records · CSV', size: '420 KB', icon: '🔴' },
    { name: 'Monthly Overview — May 2026', meta: '5,812 violations · PDF', size: '12.4 MB', icon: '📅' },
  ];
  State.reportsList = reports;
  renderReportList();
}

function renderReportList() {
  const el = document.getElementById('reportList');
  el.innerHTML = '';
  State.reportsList.slice(0, 6).forEach(r => {
    const item = document.createElement('div');
    item.className = 'report-item';
    item.innerHTML = `
      <span class="report-icon">${r.icon}</span>
      <div class="report-info">
        <div class="report-name">${r.name}</div>
        <div class="report-meta">${r.meta}</div>
      </div>
      <span class="report-size">${r.size}</span>
      <button class="report-download">⬇ Download</button>
    `;
    el.appendChild(item);
  });
}

function initRecordsTable() {
  const tbody = document.getElementById('recordsBody');
  tbody.innerHTML = '';
  State.dataset.slice(0, 50).forEach(v => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="td-id">${v.id}</td>
      <td class="td-plate">${v.plate}</td>
      <td>${v.type.icon} ${v.type.label.split(' ').slice(0,2).join(' ')}</td>
      <td style="font-size:0.75rem">${v.location.split(' ').slice(0,3).join(' ')}</td>
      <td style="font-size:0.72rem;color:#4a5a7a">${v.timestamp.toLocaleTimeString('en-IN')}</td>
      <td><span class="severity-badge ${v.severity}">${v.severity}</span></td>
      <td><span class="td-status ${v.status}">${v.status}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Settings Page ────────────────────────────────────────────────────
function initSettingsPage() {
  // Threshold sliders
  const thresholds = [
    { label: 'Detection Confidence', val: 75, id: 'detConf' },
    { label: 'OCR Confidence', val: 70, id: 'ocrConf' },
    { label: 'Helmet Detection', val: 80, id: 'helmetConf' },
    { label: 'Red-Light Detection', val: 85, id: 'redConf' },
    { label: 'Plate Detection', val: 78, id: 'plateConf' },
    { label: 'NMS IoU Threshold', val: 45, id: 'nmsConf' },
  ];
  const threshEl = document.getElementById('thresholdSettings');
  thresholds.forEach(t => {
    const item = document.createElement('div');
    item.className = 'setting-item';
    item.innerHTML = `
      <div class="setting-header">
        <span class="setting-label">${t.label}</span>
        <span class="setting-value" id="val_${t.id}">${t.val}%</span>
      </div>
      <input type="range" class="setting-slider" id="${t.id}" min="50" max="99" value="${t.val}" />
    `;
    threshEl.appendChild(item);
    const slider = item.querySelector(`#${t.id}`);
    const display = item.querySelector(`#val_${t.id}`);
    slider.addEventListener('input', () => { display.textContent = slider.value + '%'; });
  });

  // Model settings
  const modelSettings = [
    { label: 'Enable GPU Inference', checked: true },
    { label: 'Use INT8 Quantization', checked: true },
    { label: 'Night Mode Enhancement', checked: true },
    { label: 'Rain Dehazing Filter', checked: false },
    { label: 'Motion Blur Correction', checked: true },
    { label: 'Multi-Camera Fusion', checked: false },
  ];
  const modelEl = document.getElementById('modelSettings');
  modelSettings.forEach(s => {
    const label = document.createElement('label');
    label.className = 'toggle-switch';
    label.innerHTML = `
      <input type="checkbox" class="toggle-input" ${s.checked ? 'checked' : ''} />
      <span class="toggle-track"></span>
      ${s.label}
    `;
    modelEl.appendChild(label);
  });

  // Camera grid
  const cams = Array.from({length:16}, (_,i) => ({
    id: `CAM-${String(i+1).padStart(2,'0')}`,
    loc: randFrom(LOCATIONS),
    online: Math.random() > 0.1,
  }));
  const camGrid = document.getElementById('cameraGrid');
  cams.forEach(c => {
    const item = document.createElement('div');
    item.className = 'cam-item';
    item.innerHTML = `
      <div class="cam-status ${c.online ? 'online' : 'offline'}"></div>
      <div class="cam-info">
        <div class="cam-id">${c.id}</div>
        <div class="cam-loc">${c.loc.split(' ').slice(0,3).join(' ')}</div>
      </div>
    `;
    camGrid.appendChild(item);
  });

  // Preprocess settings
  const preprocessOpts = [
    { label: 'Auto White Balance', checked: true },
    { label: 'Adaptive Histogram Equalization', checked: true },
    { label: 'Noise Reduction (Gaussian)', checked: true },
    { label: 'Sharpening Filter', checked: false },
    { label: 'Automatic Orientation Fix', checked: true },
    { label: 'Shadow Removal', checked: false },
  ];
  const prepEl = document.getElementById('preprocessSettings');
  preprocessOpts.forEach(s => {
    const label = document.createElement('label');
    label.className = 'toggle-switch';
    label.innerHTML = `
      <input type="checkbox" class="toggle-input" ${s.checked ? 'checked' : ''} />
      <span class="toggle-track"></span>
      ${s.label}
    `;
    prepEl.appendChild(label);
  });

  // Alert settings
  const alerts = [
    { title: '🚨 Critical Violations', desc: 'Immediate notification for wrong-side driving, red-light running. Alert via SMS + email.' },
    { title: '📧 Daily Summary', desc: 'End-of-day violation summary report sent to registered administrators at 11:59 PM.' },
    { title: '⚠️ Model Accuracy Drop', desc: 'Alert when detection accuracy drops below configured threshold (default: 90%).' },
    { title: '📷 Camera Offline', desc: 'Instant alert when any camera goes offline or loses connection for >60 seconds.' },
    { title: '🔴 High-Density Zones', desc: 'Alert when a location exceeds 50 violations in a 1-hour window (hotspot alert).' },
    { title: '🔄 System Health', desc: 'Hourly system health check reports including GPU, CPU, memory and queue status.' },
  ];
  const alertEl = document.getElementById('alertSettings');
  alerts.forEach(a => {
    const item = document.createElement('div');
    item.className = 'alert-item';
    item.innerHTML = `
      <div class="alert-title">${a.title}</div>
      <div class="alert-desc">${a.desc}</div>
      <label class="toggle-switch">
        <input type="checkbox" class="toggle-input" checked />
        <span class="toggle-track"></span>
        Enable
      </label>
    `;
    alertEl.appendChild(item);
  });
}

// ─── Notifications ────────────────────────────────────────────────────
const INIT_NOTIFS = [
  { icon: '🚨', title: 'Critical: Red-light violation — KA01AB1234', time: '2m ago' },
  { icon: '🪖', title: 'Helmet violation — MH02CD5678 at Silk Board', time: '8m ago' },
  { icon: '📊', title: 'Daily report ready — 247 violations today', time: '1h ago' },
];

function initNotifications() {
  const list = document.getElementById('notifList');
  list.innerHTML = '';
  INIT_NOTIFS.forEach(n => {
    const item = createNotifItem(n);
    list.appendChild(item);
  });

  const btn = document.getElementById('notifBtn');
  const dropdown = document.getElementById('notifDropdown');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.classList.toggle('show');
  });
  document.addEventListener('click', () => dropdown.classList.remove('show'));
  dropdown.addEventListener('click', e => e.stopPropagation());

  document.getElementById('clearNotif').addEventListener('click', () => {
    list.innerHTML = '';
    document.getElementById('notifCount').textContent = '0';
    State.notifCount = 0;
  });
}

function createNotifItem(n) {
  const item = document.createElement('div');
  item.className = 'notif-item';
  item.innerHTML = `
    <span class="notif-dot-type">${n.icon}</span>
    <div class="notif-info">
      <div class="notif-title-text">${n.title}</div>
      <div class="notif-time-text">${n.time}</div>
    </div>
  `;
  return item;
}

function addNotification(violation) {
  const list = document.getElementById('notifList');
  const item = createNotifItem({
    icon: violation.type.icon,
    title: `${violation.type.label} — ${violation.plate} at ${violation.location.split(' ').slice(0,3).join(' ')}`,
    time: 'just now',
  });
  list.insertBefore(item, list.firstChild);
  while (list.children.length > 15) list.removeChild(list.lastChild);
}

// ─── Violation Detail Modal ───────────────────────────────────────────
function openViolationModal(violation) {
  const modal = document.getElementById('violationModal');
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');

  const canvas = document.createElement('canvas');
  canvas.className = 'modal-canvas';
  canvas.width = 640; canvas.height = 380;

  content.innerHTML = `
    <div class="modal-vtype">${violation.type.icon} ${violation.type.label}</div>
    <span class="severity-badge ${violation.severity}" style="margin-bottom:8px;display:inline-block">${violation.severity}</span>
  `;
  content.appendChild(canvas);

  const grid = document.createElement('div');
  grid.className = 'modal-grid';
  [
    ['License Plate', violation.plate, '#00d4ff'],
    ['Confidence', `${violation.confidence}%`, '#00ff88'],
    ['Vehicle', violation.vehicle, '#e8eef8'],
    ['Camera', violation.camera, '#e8eef8'],
    ['Location', violation.location, '#e8eef8'],
    ['Timestamp', violation.timestamp.toLocaleString('en-IN'), '#8b9ec4'],
    ['Weather', violation.weather, '#e8eef8'],
    ['Status', violation.status.toUpperCase(), violation.status === 'flagged' ? '#ff3b5c' : '#00ff88'],
  ].forEach(([k,v,c]) => {
    const el = document.createElement('div');
    el.className = 'modal-info-item';
    el.innerHTML = `<div class="modal-info-label">${k}</div><div class="modal-info-val" style="color:${c}">${v}</div>`;
    grid.appendChild(el);
  });
  content.appendChild(grid);

  // Draw annotated image on modal canvas
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#080c18'; ctx.fillRect(0, 0, 640, 380);
  ctx.strokeStyle = 'rgba(0,212,255,0.05)'; ctx.lineWidth = 0.5;
  for (let x=0;x<640;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,380);ctx.stroke();}
  for (let y=0;y<380;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(640,y);ctx.stroke();}

  // Main violation box
  ctx.strokeStyle = violation.type.color; ctx.lineWidth = 2.5;
  ctx.strokeRect(120, 80, 260, 160);
  ctx.fillStyle = violation.type.color + '20'; ctx.fillRect(120, 80, 260, 160);

  // Label
  ctx.font = 'bold 13px Inter';
  const lbl = `${violation.type.icon} ${violation.type.label}`;
  const lw = ctx.measureText(lbl).width + 14;
  ctx.fillStyle = violation.type.color + 'dd'; ctx.fillRect(120, 60, lw, 20);
  ctx.fillStyle = '#fff'; ctx.fillText(lbl, 127, 74);

  // Plate
  ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2; ctx.strokeRect(145, 215, 120, 28);
  ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(145, 215, 120, 28);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px JetBrains Mono'; ctx.textAlign = 'center';
  ctx.fillText(violation.plate, 205, 233); ctx.textAlign = 'left';

  // Confidence
  ctx.fillStyle = '#00ff88'; ctx.font = 'bold 11px JetBrains Mono';
  ctx.fillText(`${violation.confidence}%`, 390, 110);

  // HUD
  ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 355, 640, 25);
  ctx.fillStyle = '#4a5a7a'; ctx.font = '10px Inter';
  ctx.fillText(`TrafficAI v2.4 · ${violation.camera} · ${violation.timestamp.toLocaleString('en-IN')}`, 8, 372);

  overlay.classList.add('show');
}

document.getElementById('modalClose').addEventListener('click', () => {
  document.getElementById('modalOverlay').classList.remove('show');
});
document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modalOverlay'))
    document.getElementById('modalOverlay').classList.remove('show');
});

// ─── Menu Toggle (Mobile) ─────────────────────────────────────────────
const _menuToggle = document.getElementById('menuToggle');
if (_menuToggle) _menuToggle.addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ─── Initialize Application ───────────────────────────────────────────
function init() {
  try {
    // Generate dataset
    State.dataset = generateDataset(200);
    State.galleryData = State.dataset.slice(0, 40);

    // Start services
    startClock();
    initKPIs();
    initFeed();
    initNotifications();
    initDemoCanvas();
    bindUploadZone();
    bindGalleryFilters();

    // Init dashboard charts (active page)
    initDashboardCharts();
    State.chartsInitialized.add('dashboard');

    // Gallery
    initGallery();

    // OCR
    initOCRPage();

    // Reports
    initReportsPage();

    // Check Python backend status
    checkBackendStatus();
    setInterval(checkBackendStatus, 15000);

    console.log('%c TrafficAI loaded successfully ', 'background:#00d4ff;color:#000;font-weight:bold;padding:4px 8px;border-radius:4px;');
  } catch(err) {
    console.error('TrafficAI init error:', err);
  }
}

// Wait for DOM
document.addEventListener('DOMContentLoaded', init);

