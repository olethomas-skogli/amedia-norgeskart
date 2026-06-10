// Leaflet map: base layer, the 105 newspaper markers, their popups, and the
// selection logic that ties a marker to its row in the side panel.
import { NP } from './newspapers.js';
import { state, PIN_ZOOM } from './state.js';
import { getIcon } from './icons.js';
import { openReelsViewer } from './reels.js';
import { popupBodyHtml, wirePopup } from './popup.js';

/* global L */

const isMobile = window.innerWidth <= 768;

export const map = L.map('map', {
  minZoom: isMobile ? 4.5 : 5, maxZoom: 14,
  // Bounds extend well past the northern/easternmost markers (Hammerfest
  // 70.7°N, Kirkenes 30°E): popup autoPan needs ~600px of pan headroom at min
  // zoom, and Leaflet's _panInsideMaxBounds reverts any pan past the bounds —
  // tighter bounds left popups clipped behind the topbar (or the right edge).
  maxBounds: L.latLngBounds([55.0, 3.5], [83.0, 40.0]),
  maxBoundsViscosity: 0.85,
  zoomControl: false, attributionControl: false,
});
map.setView(isMobile ? [63.5, 15.5] : [65.2, 14.5], isMobile ? 4.5 : 5);
L.control.zoom({ position: 'bottomleft' }).addTo(map);

// Dark map tiles
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd', maxZoom: 19,
}).addTo(map);

state.curZoom = map.getZoom();

export const markers = {};

// Logos whose source art is already dark and shouldn't be colour-filtered.
const NO_FILTER_LOGOS = ['www.nordhordland.no', 'www.ba.no', 'www.gbnett.no', 'www.kv.no'];

// Popup options. autoPan keeps the popup fully on-screen; the top-left padding
// clears the fixed topbar (52px desktop / 48px mobile) so popups never hide
// behind the search bar. maxHeight makes tall "Mest lest" popups scroll
// internally and bounds how far autoPan must pan the map.
const POPUP_OPTS = {
  maxWidth: 240, minWidth: 180,
  autoPanPaddingTopLeft: L.point(12, 64),
  autoPanPaddingBottomRight: L.point(12, 24),
  maxHeight: Math.min(Math.round(window.innerHeight * 0.6), 460),
};

NP.forEach((np, i) => {
  const m = L.marker([np.lat, np.lon], { icon: getIcon(np, i, state.curZoom) });
  const noFilter = NO_FILTER_LOGOS.some((d) => np.logo.includes(d)) ? 'no-filter' : '';
  m.bindPopup(() => `<div class="pu">
    <div class="pulogo">
      <img src="${np.logo}" alt="" width="68" height="20" style="display:none;width:68px;height:20px;object-fit:contain" class="${noFilter}"
        onload="this.style.display='block';this.nextElementSibling.style.display='none'"
        onerror="this.style.display='none'">
      <span class="pulogtxt">${np.name}</span>
    </div>
    <div class="puname">${np.name}</div>
    <div class="pucity">${np.city} · ${np.region}</div>
    <a class="pulink" href="${np.url}" target="_blank">Besøk nettavis ↗</a>${popupBodyHtml(np)}
  </div>`, POPUP_OPTS);
  m.np = np; // so 'popupopen' can wire the right paper's tabs
  m.on('click', () => {
    if (state.mode === 'video') {
      if (state.videoSitekeys && !state.videoSitekeys.has(np.sitekey)) return;
      openReelsViewer(np);
    } else {
      select(i, false);
    }
  });
  markers[i] = m;
  m.addTo(map);
});

map.on('zoomend', () => {
  state.curZoom = map.getZoom();
  NP.forEach((np, i) => markers[i]?.setIcon(getIcon(np, i, state.curZoom)));
});

// In Videoer mode markers open the reels viewer, not a popup. Leaflet still
// auto-opens a bound popup on marker click, so close it the moment it opens.
// Otherwise wire up the popup's "Mest lest | Videoer" tabs.
map.on('popupopen', (e) => {
  if (state.mode === 'video') { map.closePopup(); return; }
  wirePopup(e.popup.getElement(), e.popup._source?.np, e.popup);
});

// Select a newspaper: highlight its marker + panel row, optionally fly to it,
// and open its popup.
export function select(i, fly) {
  if (state.active !== null) {
    markers[state.active]?.setIcon(getIcon(NP[state.active], state.active, state.curZoom));
    document.querySelector(`.nitem[data-i="${state.active}"]`)?.classList.remove('active');
  }
  state.active = i;
  markers[i]?.setIcon(getIcon(NP[i], i, state.curZoom));
  document.querySelector(`.nitem[data-i="${i}"]`)?.classList.add('active');
  document.querySelector(`.nitem[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  if (fly) map.flyTo([NP[i].lat, NP[i].lon], Math.max(state.curZoom, PIN_ZOOM + 2), { duration: 0.8 });
  // Only open if not already open: a marker click auto-opens the bound popup, so
  // re-opening here would re-render its content and drop the wired popup tabs.
  setTimeout(() => { const mk = markers[i]; if (mk && !mk.isPopupOpen()) mk.openPopup(); }, fly ? 900 : 0);
}
