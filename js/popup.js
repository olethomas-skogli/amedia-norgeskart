// The tabbed body of a newspaper popup: "Mest lest" (articles, from the cached
// snapshot) and "Videoer" (the paper's reels, fetched lazily on first view).
import { artRowsHtml } from './articles.js';
import { fetchReels, reelRowsHtml, openReelsViewer } from './reels.js';

// HTML appended after the "Besøk nettavis" link in the popup. The news pane is
// filled eagerly (snapshot data is already loaded); the video pane loads on
// first tab click (see wirePopup).
export function popupBodyHtml(np) {
  return `<div class="pu-tabs">
      <button class="pu-tab on" type="button" data-tab="news">Mest lest</button>
      <button class="pu-tab" type="button" data-tab="video">Videoer</button>
    </div>
    <div class="pu-pane pu-pane-news">${artRowsHtml(np)}</div>
    <div class="pu-pane pu-pane-video" hidden></div>`;
}

// Re-pan the popup into view after its height changes (popups grow upward from
// the marker and would otherwise clip behind the topbar). `_adjustPan` re-pans
// WITHOUT re-rendering — popup.update() would regenerate from the bind template
// and wipe our in-place pane content.
const repan = (popup) => popup?._adjustPan?.();

// Wire the tab buttons after the popup opens. Call from map's 'popupopen'.
// `popup` is the Leaflet popup whose content height changes as tabs/videos load.
export function wirePopup(root, np, popup) {
  if (!root) return;
  const tabs = [...root.querySelectorAll('.pu-tab')];
  const newsPane = root.querySelector('.pu-pane-news');
  const videoPane = root.querySelector('.pu-pane-video');
  if (!tabs.length || !newsPane || !videoPane) return;

  let videoLoaded = false;

  async function loadVideos() {
    videoLoaded = true;
    videoPane.innerHTML = '<div class="pu-empty">Laster videoer…</div>';
    repan(popup);
    const reels = await fetchReels(np.sitekey);
    videoPane.innerHTML = reelRowsHtml(reels);
    // Row index matches the viewer's order (both sort newest-first).
    videoPane.querySelectorAll('.pu-vid').forEach((row, i) => {
      const open = () => openReelsViewer(np, i);
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    repan(popup);
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => {
    const which = tab.dataset.tab;
    tabs.forEach((t) => t.classList.toggle('on', t === tab));
    newsPane.hidden = which !== 'news';
    videoPane.hidden = which !== 'video';
    if (which === 'video' && !videoLoaded) loadVideos();
    else repan(popup);
  }));
}
