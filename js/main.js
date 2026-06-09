// Entry point. Importing ./map.js builds the map and markers; we then load the
// article snapshot (popups pick it up lazily) and wire up the side-panel UI.
import './map.js';
import { loadArticles } from './articles.js';
import { setupReelsViewer } from './reels.js';
import { initUI } from './ui.js';

loadArticles();
setupReelsViewer();
initUI();
