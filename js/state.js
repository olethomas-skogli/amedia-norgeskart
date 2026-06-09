// Shared mutable app state.
//
// The map, marker list and UI all read and write a few of the same values
// (which marker is selected, the current zoom, the active region/search
// filter). Keeping them on one object lets the modules share state without
// fighting ES-module live-binding rules around reassigned `let` exports.
export const state = {
  active: null,    // index of the currently selected newspaper, or null
  curZoom: null,   // last-known map zoom (drives pin vs. logo icons)
  curRegion: 'Alle', // active region filter
  curQ: '',        // active search query (lowercased)
  mode: 'news',    // 'news' (articles) | 'video' (reels)
  videoSitekeys: null, // Set of sitekeys with ≥1 reel, once probed (null = not yet)
};

// Zoom level at and above which markers switch from dots to logo cards.
export const PIN_ZOOM = window.innerWidth <= 768 ? 8 : 7;
