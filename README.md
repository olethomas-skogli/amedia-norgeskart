# Amedia Norgeskart

An interactive map of Amedia's 105 Norwegian local newspapers, built on
[Leaflet](https://leafletjs.com). A **Nyheter / Videoer** toggle in the side
panel switches between two modes:

- **Nyheter** — click a marker/row to see the paper's details and its current
  "Mest lest" (most-read) articles in a popup.
- **Videoer** — only papers with current video "reels" are shown; clicking one
  opens a fullscreen TikTok-style reels viewer. (Reels tech ported from the
  sibling `norway-newspaper-map` project.)

## Running

The app uses native ES modules and `fetch`, and the reels API has no CORS
header — so it's served by a small node server (`serve.mjs`) that also proxies
the reels endpoint same-origin at `/api/reels`. Opening `index.html` from
`file://` will not work.

```bash
npm start          # node serve.mjs → http://localhost:8773
```

Plain static servers (`python -m http.server`, `npx serve`) will serve the page
but **Videoer mode won't load** without the `/api/reels` proxy.

## Project layout

```
index.html              Markup + asset links. No inline JS/CSS.
css/
  app.css               App styles (top bar, panel, markers, popups).
  fonts.css             @font-face for the self-hosted DM Sans woff2.
js/                      ES modules (loaded via <script type="module">):
  main.js               Entry point — loads articles, inits the UI.
  newspapers.js         The 105-paper NP dataset (name, city, lat/lon, logo…).
  state.js              Shared mutable state (selection, zoom, filters).
  icons.js              Leaflet marker icons (dot vs. logo card by zoom).
  map.js                Map, base layer, markers, popups, selection.
  ui.js                 Mode toggle, region filter, list, search, mobile sheet.
  articles.js           Loads data/articles.json and renders the popup list.
  reels.js              Videoer mode: fetches reels (/api/reels) + fullscreen viewer.
css/reels.css           Fullscreen reels-viewer styles.
serve.mjs               Node static server + /api/reels proxy (the reels API has no CORS).
vendor/leaflet/         Self-hosted Leaflet 1.9.4 (js, css, marker images).
assets/fonts/           DM Sans woff2 (latin, latin-ext).
data/
  articles.json         Build-time "Mest lest" snapshot (see below).
build/
  fetch-articles.mjs    Regenerates data/articles.json.
_original/              The previous single-file bundle + build script, kept
                        for reference. Not used by the running app.
```

## Videoer (reels)

Reels are fetched **live** per paper from
`services.api.no/api/video-yoshi/v1/reels?publication=<sitekey>` via the
`/api/reels` proxy in `serve.mjs` (the upstream sends no CORS header). The
`sitekey` for each paper lives in `js/newspapers.js`. On first switch to Videoer
mode the app probes every paper's feed (bounded concurrency, cached) and shows
only those with ≥1 reel. Media (poster/mp4) is played directly by a native
`<video>` element and isn't proxied.

## Refreshing the "Mest lest" articles

`data/articles.json` is a **build-time snapshot**: the upstream `bestread`
endpoint sends no CORS header, so the browser can't call it live. Regenerate it
with:

```bash
npm run articles       # node build/fetch-articles.mjs
```

This fetches each paper's top-3 from `services.api.no`, resizes each thumbnail
with macOS `sips`, inlines them as base64, and writes `data/articles.json`. It
requires:

- macOS (for `sips`), and
- the sibling repo `../norway-newspaper-map` for `publications.json`
  (the domain → sitekey mapping).

If `data/articles.json` is absent or a paper has no articles, popups simply omit
the "Mest lest" section.

## Deployment (Netlify)

Live at **https://plussalt-norgeskart.netlify.app/**. The site is static (no
build step), so `serve.mjs` isn't used in production — instead `netlify.toml`
declares a proxy redirect that is the production equivalent of the `/api/reels`
route in `serve.mjs`:

```toml
[[redirects]]
  from = "/api/reels"
  to = "https://services.api.no/api/video-yoshi/v1/reels"
  status = 200
  force = true
```

Netlify fetches the upstream server-side (forwarding the query params), so the
browser only ever calls our own origin — no CORS issue. The app calls
`/api/reels` relatively, so the same code works locally (via `serve.mjs`) and on
Netlify (via the redirect). Article data is the static `data/articles.json`, so
it needs no proxy.

## Background

This project was previously distributed as a single self-contained HTML file
(`_original/source.html`) produced by a custom bundler that packed the whole app
— Leaflet, fonts, marker images, and all code — into one file that ran offline
from `file://`. It has been unpacked into this conventional served static site;
the original files are preserved under `_original/` for reference.
