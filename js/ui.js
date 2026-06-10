// Side panel UI: region filter buttons, the searchable newspaper list,
// search box, geolocation ("find me"), and the mobile bottom-sheet gestures.
import { NP } from './newspapers.js';
import { state } from './state.js';
import { getIcon } from './icons.js';
import { map, markers, select } from './map.js';
import { probeVideoSitekeys, openReelsViewer } from './reels.js';

const pnl = document.getElementById('pnl');

// ---- region filter ----

const regions = ['Alle', ...[...new Set(NP.map((n) => n.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'no'))];

// Per-region map view: [lat, lon, zoom].
const REGION_VIEWS = {
  'Agder':           [58.4628, 8.5103,  9],
  'Akershus':        [59.9708, 11.1443, 9],
  'Buskerud':        [59.9065, 10.2166, 10],
  'Finnmark':        [70.3391, 24.5490, 7],
  'Innlandet':       [61.0337, 10.8064, 9],
  'Møre og Romsdal': [62.8924, 8.1484,  10],
  'Nordland':        [67.5652, 16.3202, 7],
  'Oslo':            [59.9217, 10.7627, 12],
  'Rogaland':        [58.9068, 6.1208,  9],
  'Telemark':        [59.4095, 9.2821,  9],
  'Troms':           [69.0303, 17.3337, 8],
  'Trøndelag':       [63.8733, 11.6977, 8],
  'Vestfold':        [59.3076, 10.2605, 10],
  'Vestland':        [60.6772, 8.7314,  8],
  'Østfold':         [59.3531, 11.0213, 10],
};

// Default nationwide view — used by the home button and the "Alle" chip.
const flyHome = () => map.flyTo([65.5, 15.5], 5, { duration: 1 });

export function flyToRegion(region) {
  if (region === 'Alle') { flyHome(); return; }
  const v = REGION_VIEWS[region];
  if (v) map.flyTo([v[0], v[1]], v[2], { duration: 1 });
}

function buildRegionButtons() {
  const rgs = document.getElementById('rgs');
  regions.forEach((r) => {
    const b = document.createElement('button');
    b.className = 'rbtn' + (r === 'Alle' ? ' on' : '');
    b.textContent = r;
    function doRegion() {
      if (state.curRegion === r && r !== 'Alle') {
        state.curRegion = 'Alle';
        document.querySelectorAll('.rbtn').forEach((x) => { x.classList.remove('on'); if (x.textContent === 'Alle') x.classList.add('on'); });
        renderList();
        flyHome();
      } else {
        state.curRegion = r;
        document.querySelectorAll('.rbtn').forEach((x) => { x.classList.remove('on'); });
        b.classList.add('on');
        if (state.active !== null) { markers[state.active]?.setIcon(getIcon(NP[state.active], state.active, state.curZoom)); map.closePopup(); state.active = null; }
        renderList();
        flyToRegion(r);
      }
    }
    b.addEventListener('click', doRegion);
    rgs.appendChild(b);
  });
}

// ---- list rendering ----

export function renderList() {
  const list = document.getElementById('nlist');
  list.innerHTML = ''; let n = 0;
  NP.forEach((np, i) => {
    if (state.mode === 'video' && state.videoSitekeys && !state.videoSitekeys.has(np.sitekey)) { markers[i]?.setOpacity(0); return; }
    if (state.curQ && !np.name.toLowerCase().includes(state.curQ) && !np.city.toLowerCase().includes(state.curQ)) { markers[i]?.setOpacity(0); return; }
    if (state.curRegion !== 'Alle' && np.region !== state.curRegion) { markers[i]?.setOpacity(0); return; }
    markers[i]?.setOpacity(1); n++;
    const el = document.createElement('div');
    el.className = 'nitem' + (state.active === i ? ' active' : '');
    el.dataset.i = i;
    // In video mode rows open the reels viewer — the ▶ badge makes the mode
    // switch visible even when the filtered counts barely change.
    const vid = state.mode === 'video' ? '<span class="nplay" aria-hidden="true">▶</span>' : '';
    el.innerHTML = `<div class="lcell"><img src="${np.logo}" alt="" width="68" height="20" style="width:68px;height:20px;object-fit:contain" loading="eager" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="lbadge">${np.name}</span></div><div class="ninfo"><div class="nname">${np.name}</div><div class="ncity">${np.city}</div></div>${vid}`;
    el.addEventListener('click', () => {
      if (state.mode === 'video') { openReelsViewer(np); return; }
      select(i, true);
      // On mobile, close the bottom sheet so the popup is visible on the map.
      if (window.innerWidth <= 768) closeSheet(false);
    });
    list.appendChild(el);
  });
  document.getElementById('cnt').textContent = n;
  const cntM = document.getElementById('cnt-m');
  if (cntM) cntM.textContent = n;
  updateFilterBadge();
}

// ---- Nyheter / Videoer mode toggle ----

function setPhead(text) {
  const el = document.querySelector('.phead');
  if (el) el.textContent = text;
}

// True while the reel-availability probe runs, so re-entering video mode
// doesn't start a second probe.
let _probing = false;

async function setMode(mode) {
  if (mode === state.mode) return;

  // Switch mode and the toggle UI immediately — the probe below must never
  // block or swallow taps (it can take seconds; a dead toggle reads as a bug).
  state.mode = mode;
  document.querySelectorAll('#mode-toggle .mbtn').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  // Drop any current selection/popup when switching modes.
  if (state.active !== null) {
    markers[state.active]?.setIcon(getIcon(NP[state.active], state.active, state.curZoom));
    map.closePopup();
    state.active = null;
  }
  renderList();

  // Probe reel availability the first time video mode is entered. Until it
  // finishes the video list is unfiltered; re-render when it lands (the user
  // may have toggled back to news meanwhile — then just leave the result for
  // the next switch).
  if (mode === 'video' && !state.videoSitekeys && !_probing) {
    _probing = true;
    setPhead('Laster videoer…');
    try {
      state.videoSitekeys = await probeVideoSitekeys((done, total) => setPhead(`Laster videoer… ${done}/${total}`));
    } finally {
      _probing = false;
      setPhead('Fylke / region');
      if (state.mode === 'video') renderList();
    }
  }
}

function buildModeToggle() {
  const wrap = document.getElementById('mode-toggle');
  if (!wrap) return;
  wrap.querySelectorAll('.mbtn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
}

// ---- geolocation ----

export function locateAndZoom(onSuccess) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    // Find closest region by finding the nearest newspaper.
    let best = null, bestDist = Infinity;
    NP.forEach((n) => {
      const d = Math.pow(n.lat - lat, 2) + Math.pow(n.lon - lon, 2);
      if (d < bestDist) { bestDist = d; best = n; }
    });
    if (best && best.region) {
      state.curRegion = best.region;
      document.querySelectorAll('.rbtn').forEach((x) => { x.classList.remove('on'); });
      document.querySelectorAll('.rbtn').forEach((x) => { if (x.textContent === state.curRegion) x.classList.add('on'); });
      renderList();
      flyToRegion(state.curRegion);
    } else {
      map.flyTo([lat, lon], 10, { duration: 1.5 });
    }
    if (onSuccess) onSuccess();
  }, () => {});
}

// ---- search box + panel + mobile gestures ----

let _debTimer;

// Open the bottom sheet (mobile). On desktop the panel is pinned open by CSS,
// so these classes are inert there. expand: true → 85dvh, so search results
// stay visible above the on-screen keyboard.
function openSheet({ expand = false } = {}) {
  pnl.classList.add('open');
  if (expand) pnl.classList.add('expanded');
}

// Single close path shared by ✕, Escape, outside-tap, drag-down and item
// selection. clearSearch: false keeps the query (drag-dismiss, item click).
function closeSheet(clearSearch = true) {
  pnl.classList.remove('open', 'expanded');
  const qEl = document.getElementById('q');
  if (clearSearch && (state.curQ || qEl.value)) { state.curQ = ''; qEl.value = ''; renderList(); }
  qEl.blur();
}

// Amber dot on the topbar funnel when any filter is narrowing the list.
function updateFilterBadge() {
  const dot = document.getElementById('filter-dot');
  if (dot) dot.hidden = state.curRegion === 'Alle' && state.mode === 'news';
}

function wireControls() {
  document.getElementById('home-btn').onclick = () => { flyHome(); };
  document.getElementById('gps-btn').onclick = () => { locateAndZoom(); };

  const qEl = document.getElementById('q');

  if (window.innerWidth <= 768) {
    setTimeout(() => { locateAndZoom(); }, 2000);
    // Funnel opens the sheet on the filter section — explicitly no keyboard.
    document.getElementById('filter-btn')?.addEventListener('click', () => {
      qEl.blur();
      openSheet();
      document.querySelector('.rbtn.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
    // Tapping the (real) search input is the user gesture iOS needs for the
    // keyboard; the sheet opens expanded so results show above the keyboard.
    qEl.addEventListener('focus', () => openSheet({ expand: true }));
    // The whole pill reads as one tap target — icon taps focus the input too.
    document.querySelector('.spill')?.addEventListener('click', () => qEl.focus());
  } // panel always open on desktop

  qEl.oninput = (e) => {
    clearTimeout(_debTimer);
    const v = e.target.value.toLowerCase();
    if (window.innerWidth <= 768) openSheet({ expand: true }); // typing after a drag-dismiss re-opens results
    _debTimer = setTimeout(() => { state.curQ = v; renderList(); }, 150);
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.panel') && !e.target.closest('.spill') && !e.target.closest('.filter-btn')) closeSheet();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  document.getElementById('sheet-close')?.addEventListener('click', () => closeSheet());
}

// Auto-hide the stats card on mobile after 4s.
function wireStatsCardAutoHide() {
  if (window.innerWidth <= 768) {
    setTimeout(() => {
      const sc = document.getElementById('statscard');
      if (sc) { sc.style.transition = 'opacity 0.5s'; sc.style.opacity = '0'; sc.style.pointerEvents = 'none'; }
    }, 4000);
  }
}

// Drag-to-dismiss bottom sheet on mobile.
function wireBottomSheet() {
  if (window.innerWidth > 768) return;
  const pnlEl = document.querySelector('.panel');
  let dragStartY = 0;
  let dragCurrentY = 0;
  let isDragging = false;

  pnlEl.addEventListener('touchstart', (e) => {
    // .rgs: horizontal chip swipes must scroll the rail, not drag the sheet.
    if (e.target.closest('.nlist-wrap, .rgs, input')) return;
    dragStartY = e.touches[0].clientY;
    // Initialize to the start position: a clean tap fires no touchmove, and a
    // stale 0 here made touchend compute dy = -dragStartY → every tap on the
    // sheet "expanded" it, yanking buttons out from under the finger.
    dragCurrentY = dragStartY;
    isDragging = true;
    pnlEl.classList.add('no-transition');
  }, { passive: true });

  pnlEl.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    dragCurrentY = e.touches[0].clientY;
    const dy = dragCurrentY - dragStartY;
    if (dy > 0) { pnlEl.style.transform = 'translateY(' + dy + 'px)'; }
  }, { passive: true });

  pnlEl.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    pnlEl.classList.remove('no-transition');
    const dy = dragCurrentY - dragStartY;
    if (dy > 80) {
      pnlEl.style.transform = '';
      closeSheet(false); // drag-dismiss keeps the search query
    } else if (dy < -60) {
      pnlEl.style.transform = '';
      pnlEl.classList.add('expanded');
    } else {
      pnlEl.style.transform = '';
    }
    dragCurrentY = 0; dragStartY = 0;
  });
}

export function initUI() {
  buildModeToggle();
  buildRegionButtons();
  wireControls();
  renderList();
  wireStatsCardAutoHide();
  wireBottomSheet();
}
