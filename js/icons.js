// Leaflet marker icons. Below PIN_ZOOM each newspaper is a small glowing dot;
// at or above it the marker becomes a logo card showing the paper's masthead.
import { state, PIN_ZOOM } from './state.js';

/* global L */

export function makePinIcon(sel) {
  return L.divIcon({
    html: `<div class="pin${sel ? ' sel' : ''}"></div>`,
    className: '', iconSize: [sel ? 13 : 11, sel ? 13 : 11], iconAnchor: [sel ? 6 : 5, sel ? 6 : 5], popupAnchor: [0, -8],
  });
}

export function makeLogoIcon(np, sel) {
  return L.divIcon({
    html: `<div class="lm${sel ? ' sel' : ''}">
      <img src="${np.logo}" alt="" width="68" height="20" style="display:none;width:68px;height:20px;object-fit:contain"
        onload="this.style.display='block';this.nextElementSibling.style.display='none'"
        onerror="this.style.display='none'">
      <span class="lm-txt">${np.name}</span>
    </div>`,
    className: '', iconSize: [78, 30], iconAnchor: [39, 30], popupAnchor: [0, -32],
  });
}

// `i` = this marker's index; `zoom` = current map zoom. Whether it renders
// selected is derived from the shared `state.active` at call time.
export function getIcon(np, i, zoom) {
  const sel = state.active === i;
  return zoom < PIN_ZOOM ? makePinIcon(sel) : makeLogoIcon(np, sel);
}
