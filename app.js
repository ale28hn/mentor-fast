(() => {
  'use strict';
  const KEY = 'mentorFast.v1';
  const PRESETS = [
    { id: '16:8', label: '16:8', h: 16 },
    { id: '18:6', label: '18:6', h: 18 },
    { id: '20:4', label: '20:4', h: 20 },
    { id: '13h',  label: '13h',  h: 13 },
    { id: 'omad', label: 'OMAD', h: 23 },
    { id: 'custom', label: 'Custom', h: null },
  ];
  const DEFAULT = { presetId: '20:4', customH: 20, active: null, history: [], updated: 0 };
  const $ = id => document.getElementById(id);

  // ---------- storage: localStorage primary, IndexedDB backup ----------
  let state = load();
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign({}, DEFAULT, JSON.parse(raw));
    } catch (e) {}
    return Object.assign({}, DEFAULT);
  }
  function save() {
    state.updated = Date.now();
    const s = JSON.stringify(state);
    try { localStorage.setItem(KEY, s); } catch (e) {}
    idbPut(s);
  }
  function idb() {
    return new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej('no idb');
      const r = indexedDB.open('mentorFast', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function idbPut(s) {
    idb().then(db => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(s, KEY); }).catch(() => {});
  }
  function idbGet() {
    return idb().then(db => new Promise(res => {
      const q = db.transaction('kv').objectStore('kv').get(KEY);
      q.onsuccess = () => res(q.result || null); q.onerror = () => res(null);
    })).catch(() => null);
  }
  // If localStorage was wiped (or IDB is newer), restore from IndexedDB.
  idbGet().then(s => {
    if (!s) { save(); return; }
    try {
      const b = JSON.parse(s);
      if ((b.updated || 0) > (state.updated || 0)) {
        state = Object.assign({}, DEFAULT, b);
        try { localStorage.setItem(KEY, s); } catch (e) {}
        render(true);
      }
    } catch (e) {}
  });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ---------- helpers ----------
  const goalHours = () => {
    if (state.active) return state.active.goalH;
    const p = PRESETS.find(p => p.id === state.presetId) || PRESETS[2];
    return p.h ?? clampH(state.customH);
  };
  const clampH = h => Math.min(72, Math.max(1, Number(h) || 20));
  const pad = n => String(n).padStart(2, '0');
  const hms = ms => { ms = Math.max(0, ms); const t = Math.floor(ms / 1000); return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t % 3600 / 60))}:${pad(t % 60)}`; };
  const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtDT = t => {
    const d = new Date(t), now = new Date();
    const day = d.toDateString() === now.toDateString() ? 'Today'
      : d.toDateString() === new Date(now - 864e5).toDateString() ? 'Yesterday'
      : d.toDateString() === new Date(+now + 864e5).toDateString() ? 'Tomorrow'
      : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return `${day} ${fmtTime(t)}`;
  };
  const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const fmtH = h => (Math.round(h * 10) / 10) + 'h';

  function streak() {
    const days = new Set(state.history.filter(f => f.end - f.start >= 12 * 3600e3).map(f => dayKey(f.end)));
    if (state.active && Date.now() - state.active.start >= 12 * 3600e3) days.add(dayKey(Date.now()));
    let d = new Date(); d.setHours(12, 0, 0, 0);
    if (!days.has(dayKey(d))) d = new Date(d - 864e5); // today not done yet: count from yesterday
    let n = 0;
    while (days.has(dayKey(d))) { n++; d = new Date(d - 864e5); }
    return n;
  }

  // ---------- UI ----------
  const C = 2 * Math.PI * 88;
  $('progress').style.strokeDasharray = C;

  function renderPresets() {
    const box = $('presets'); box.innerHTML = '';
    const activeId = state.active ? state.active.presetId : state.presetId;
    PRESETS.forEach(p => {
      const b = document.createElement('button');
      b.textContent = p.label; b.type = 'button';
      if (p.id === activeId) b.classList.add('on');
      b.onclick = () => {
        state.presetId = p.id;
        if (state.active) { state.active.presetId = p.id; state.active.goalH = p.h ?? clampH(state.customH); }
        save(); render(true);
      };
      box.appendChild(b);
    });
    $('customRow').hidden = activeId !== 'custom';
    $('customHours').value = state.active && activeId === 'custom' ? state.active.goalH : state.customH;
  }

  function renderHistory() {
    const ul = $('historyList');
    const items = state.history.slice(-10).reverse();
    if (!items.length) { ul.innerHTML = '<li class="muted">No fasts logged yet.</li>'; return; }
    ul.innerHTML = '';
    items.forEach(f => {
      const h = (f.end - f.start) / 3600e3;
      const li = document.createElement('li');
      li.innerHTML = `<span>${fmtDT(f.end)}</span><span class="${h >= f.goalH ? 'ok' : ''}">${fmtH(h)} / ${fmtH(f.goalH)}${h >= f.goalH ? ' ✓' : ''}</span>`;
      ul.appendChild(li);
    });
  }

  function render(full) {
    if (full) { renderPresets(); renderHistory(); }
    const g = goalHours(), gms = g * 3600e3, eatH = Math.max(0, 24 - g);
    const s = streak();
    $('streak').textContent = `🔥 ${s} day${s === 1 ? '' : 's'} streak`;
    const a = state.active;
    $('startBtn').hidden = !!a; $('endBtn').hidden = !a; $('resetBtn').hidden = !a; $('editStartBtn').hidden = !a;
    const prog = $('progress');
    if (!a) {
      $('status').textContent = 'Not fasting';
      $('big').textContent = hms(gms);
      $('sub').textContent = `Goal ${fmtH(g)}${eatH ? ` · eat ${fmtH(eatH)}` : ''}`;
      $('pct').textContent = '';
      $('startedAt').textContent = '—';
      $('goalAt').textContent = fmtDT(Date.now() + gms);
      $('eatWin').textContent = eatH ? `${fmtTime(Date.now() + gms)}–${fmtTime(Date.now() + gms + eatH * 3600e3)}` : '—';
      prog.style.strokeDashoffset = C; prog.classList.remove('done');
      document.title = 'Mentor Fast';
      return;
    }
    const el = Date.now() - a.start, goalAt = a.start + gms, done = el >= gms;
    $('status').textContent = done ? 'Goal reached 🎉' : 'Fasting';
    $('big').textContent = done ? '+' + hms(el - gms) : hms(gms - el);
    $('sub').textContent = done ? `Fasted ${hms(el)}` : `remaining · ${hms(el)} elapsed`;
    $('pct').textContent = `${Math.min(100, Math.floor(el / gms * 100))}% of ${fmtH(g)}`;
    $('startedAt').textContent = fmtDT(a.start);
    $('goalAt').textContent = fmtDT(goalAt);
    $('eatWin').textContent = eatH ? `${fmtTime(goalAt)}–${fmtTime(goalAt + eatH * 3600e3)}` : 'Any time';
    prog.style.strokeDashoffset = C * (1 - Math.min(1, el / gms));
    prog.classList.toggle('done', done);
    $('endBtn').textContent = done ? 'End fast' : 'End fast early';
    document.title = (done ? '+' + hms(el - gms) : hms(gms - el)) + ' · Mentor Fast';
  }

  // ---------- actions ----------
  $('startBtn').onclick = () => {
    state.active = { start: Date.now(), goalH: goalHours(), presetId: state.presetId };
    save(); render(true);
  };
  $('endBtn').onclick = () => {
    const a = state.active; if (!a) return;
    const el = Date.now() - a.start;
    if (el < a.goalH * 3600e3 && !confirm(`End fast early at ${fmtH(el / 3600e3)}? It will be logged.`)) return;
    state.history.push({ start: a.start, end: Date.now(), goalH: a.goalH });
    if (state.history.length > 400) state.history = state.history.slice(-400);
    state.active = null; save(); render(true);
  };
  $('resetBtn').onclick = () => {
    if (!confirm('Discard this fast without logging it?')) return;
    state.active = null; save(); render(true);
  };
  $('customHours').onchange = e => {
    const h = clampH(e.target.value); e.target.value = h; state.customH = h;
    if (state.active && state.active.presetId === 'custom') state.active.goalH = h;
    save(); render(true);
  };
  const toLocalInput = t => { const d = new Date(t - new Date(t).getTimezoneOffset() * 6e4); return d.toISOString().slice(0, 16); };
  $('editStartBtn').onclick = () => {
    if (!state.active) return;
    $('editInput').value = toLocalInput(state.active.start);
    $('editInput').max = toLocalInput(Date.now());
    $('editDlg').showModal ? $('editDlg').showModal() : null;
  };
  $('editDlg').addEventListener('close', () => {
    if ($('editDlg').returnValue !== 'ok' || !state.active) return;
    const t = new Date($('editInput').value).getTime();
    if (!isNaN(t) && t <= Date.now()) { state.active.start = t; save(); render(true); }
  });

  // Another tab / home-screen instance changed state
  window.addEventListener('storage', e => { if (e.key === KEY) { state = load(); render(true); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { state = load(); render(true); } });
  window.addEventListener('pageshow', () => render(true));

  render(true);
  setInterval(() => render(false), 1000);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
