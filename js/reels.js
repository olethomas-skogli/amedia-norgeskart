// Video "reels" — ported from the norway-newspaper-map project. A paper's reels
// are fetched (lazily, by sitekey, via the same-origin /api/reels proxy in
// serve.mjs) and shown in a fullscreen TikTok/Instagram-style viewer.
import { NP } from './newspapers.js';

// ---- helpers ----

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const reelDate = new Intl.DateTimeFormat('no', { day: 'numeric', month: 'short' });

// ---- data ----

// A publication's reels are fetched lazily and cached by sitekey.
const reelCache = new Map(); // sitekey -> reel[]

function mapReel(r) {
  return {
    title: r.title || '',
    lead: r.leadText || '',
    poster: r.poster?.url || '',
    mp4: r.video?.src || '',
    created: r.publishedAt ? Date.parse(r.publishedAt) : NaN,
    permalink: r.permalink || '',
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch a paper's reels by sitekey, with retry/backoff. The upstream rate-limits
// the probe burst with 503s, so we retry 5xx/network errors. Results are cached
// only when the response is definitive (2xx → reels, 4xx → genuinely none); a
// run of failures returns [] WITHOUT caching, so a later open retries.
export async function fetchReels(sitekey) {
  if (reelCache.has(sitekey)) return reelCache.get(sitekey);
  const url = `/api/reels?content=none&tail=latest&publication=${encodeURIComponent(sitekey)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const reels = ((await res.json()).results ?? []).map(mapReel);
        reelCache.set(sitekey, reels);
        return reels;
      }
      if (res.status >= 400 && res.status < 500) { // no feed for this publication
        reelCache.set(sitekey, []);
        return [];
      }
      // 5xx → fall through to backoff + retry
    } catch {
      // network error → fall through to backoff + retry
    }
    await sleep(300 * (attempt + 1));
  }
  console.warn('Reel fetch gave up (not cached):', sitekey);
  return [];
}

// Probe every paper's reel feed (bounded concurrency) and return the set of
// sitekeys with at least one reel. Warms reelCache so opening a viewer is
// instant afterwards. `onProgress(done, total)` is called as it goes.
export async function probeVideoSitekeys(onProgress) {
  const CONCURRENCY = 5; // gentle on the upstream; it rate-limits bursts with 503
  const have = new Set();
  let done = 0;
  let i = 0;
  const worker = async () => {
    while (i < NP.length) {
      const np = NP[i++];
      const reels = await fetchReels(np.sitekey);
      if (reels.length) have.add(np.sitekey);
      done++;
      onProgress?.(done, NP.length);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return have;
}

// Newest-first; used by both the popup list and the fullscreen viewer so a
// thumbnail's index matches the reel shown.
const sortReels = (reels) => reels.slice().sort((a, b) => b.created - a.created);

// Compact reel rows for the popup's "Videoer" tab (poster thumb + ▶ + title +
// date), styled like the article rows. Capped to a short preview — tapping a row
// opens the full viewer. Empty-state when the paper has no reels.
const POPUP_REEL_LIMIT = 6;
export function reelRowsHtml(reels) {
  if (!reels.length) return '<div class="pu-empty">Ingen videoer akkurat nå.</div>';
  return sortReels(reels).slice(0, POPUP_REEL_LIMIT).map((v) => {
    const date = Number.isNaN(v.created) ? '' : reelDate.format(v.created);
    const thumb = v.poster
      ? `<img class="pu-art-img" src="${escapeHtml(v.poster)}" alt="" onerror="this.remove()">`
      : '';
    return `<div class="pu-art pu-vid" role="button" tabindex="0">` +
      `<div class="pu-vid-thumb">${thumb}<span class="pu-vid-badge" aria-hidden="true">▶</span></div>` +
      `<div class="pu-art-txt"><div class="pu-art-t">${escapeHtml(v.title)}</div>` +
      (date ? `<div class="pu-art-m">${escapeHtml(date)}</div>` : '') + '</div></div>';
  }).join('');
}

// ---- fullscreen viewer ----

let reelsMuted = true; // start muted so autoplay is allowed
let reelsObserver = null;

const reelsViewer = () => document.getElementById('reels-viewer');
const reelsTrack = () => document.getElementById('reels-track');
const reelVideos = () => [...reelsTrack().querySelectorAll('video')];

// Open the viewer for a single newspaper and lazily load its reels. `startIndex`
// scrolls straight to a chosen reel (e.g. the popup thumbnail that was tapped).
export async function openReelsViewer(np, startIndex = 0) {
  if (!np?.sitekey) return;
  const viewer = reelsViewer();
  const track = reelsTrack();
  if (!viewer || !track) return;

  track.innerHTML = '<p class="reels-status">Laster reels…</p>';
  viewer.hidden = false;
  viewer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('reels-open');
  viewer.querySelector('.reels-close')?.focus();

  try {
    const reels = sortReels(await fetchReels(np.sitekey));
    if (!viewer.hidden) renderReels(reels, np.name, startIndex);
  } catch (err) {
    track.innerHTML = '<p class="reels-status">Klarte ikke å laste reels.</p>';
    console.error('Reels load failed:', err);
  }
}

function renderReels(reels, label, startIndex = 0) {
  const track = reelsTrack();
  track.innerHTML = '';

  if (!reels.length) {
    track.innerHTML = '<p class="reels-status">Ingen reels her akkurat nå.</p>';
    return;
  }

  for (const v of reels) {
    const reel = document.createElement('section');
    reel.className = 'reel';
    const date = Number.isNaN(v.created) ? '' : reelDate.format(v.created);
    const lead = v.lead ? `<p class="reel-lead">${escapeHtml(v.lead)}</p>` : '';
    const link = v.permalink
      ? `<a class="reel-link" href="${escapeHtml(v.permalink)}" target="_blank" rel="noopener">Se hele saken →</a>`
      : '';
    reel.innerHTML = `
      <video class="reel-video" loop playsinline preload="none"${v.poster ? ` poster="${escapeHtml(v.poster)}"` : ''}>
        ${v.mp4 ? `<source src="${escapeHtml(v.mp4)}" type="video/mp4" />` : ''}
      </video>
      <span class="reel-play" aria-hidden="true">▶</span>
      <div class="reel-caption">
        <p class="reel-by">${escapeHtml(label)}${date ? ` · ${escapeHtml(date)}` : ''}</p>
        <p class="reel-title">${escapeHtml(v.title)}</p>
        ${lead}
        ${link}
      </div>`;

    const video = reel.querySelector('video');
    video.muted = reelsMuted;
    // Tap the video area to toggle play/pause (taps on the link are unaffected).
    video.addEventListener('click', () => togglePlay(video, reel));
    reel.querySelector('.reel-play').addEventListener('click', () => togglePlay(video, reel));
    reel.addEventListener('play', () => reel.classList.remove('paused'), true);

    track.appendChild(reel);
  }

  // Jump to the tapped reel (no smooth scroll so the observer settles on it).
  if (startIndex > 0) track.children[startIndex]?.scrollIntoView({ block: 'start' });

  startReelsObserver();
}

function togglePlay(video, reel) {
  if (video.paused) {
    video.play();
    reel.classList.remove('paused');
  } else {
    video.pause();
    reel.classList.add('paused');
  }
}

// Play whichever reel is in view, pause/reset the rest.
function startReelsObserver() {
  reelsObserver?.disconnect();
  reelsObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target.querySelector('video');
      if (!video) continue;
      if (entry.isIntersecting) {
        video.muted = reelsMuted;
        video.play().catch(() => {});
        entry.target.classList.remove('paused');
      } else {
        video.pause();
        video.currentTime = 0;
      }
    }
  }, { root: reelsTrack(), threshold: 0.6 });
  for (const reel of reelsTrack().querySelectorAll('.reel')) reelsObserver.observe(reel);
}

export function closeReelsViewer() {
  const viewer = reelsViewer();
  if (!viewer || viewer.hidden) return;
  reelsObserver?.disconnect();
  reelsObserver = null;
  for (const v of reelVideos()) v.pause();
  // Move focus out before hiding — focus must not remain inside an
  // aria-hidden/hidden subtree (assistive-tech warning otherwise).
  if (viewer.contains(document.activeElement)) document.activeElement.blur();
  reelsTrack().innerHTML = '';
  viewer.hidden = true;
  viewer.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('reels-open');
}

function setReelsMuted(muted) {
  reelsMuted = muted;
  for (const v of reelVideos()) v.muted = muted;
  const btn = document.getElementById('reels-mute');
  if (btn) btn.textContent = muted ? '🔇' : '🔊';
}

// Wire the viewer's close/mute/backdrop/Esc controls. Call once on startup.
export function setupReelsViewer() {
  const viewer = reelsViewer();
  if (!viewer) return;
  viewer.querySelector('.reels-close')?.addEventListener('click', closeReelsViewer);
  document.getElementById('reels-mute')?.addEventListener('click', () => setReelsMuted(!reelsMuted));
  // Click on the dimmed backdrop (outside the frame) closes.
  viewer.addEventListener('click', (e) => { if (e.target === viewer) closeReelsViewer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !viewer.hidden) closeReelsViewer(); });
}
