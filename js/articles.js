// "Mest lest" (most-read) articles shown at the bottom of each popup.
//
// The data is a build-time snapshot in data/articles.json — the upstream
// bestread API sends no CORS header, so it can't be called live from the
// browser. Refresh it with `node build/fetch-articles.mjs`. If the file is
// missing or a paper has no articles, the popup simply omits this block.

let ARTICLES = {}; // domain -> [{ title, url, img, reads }]
let ARTICLES_DATE = '';

// Fetch the snapshot. Resolves quietly (no throw) so a missing file or
// failed request just leaves popups without the "Mest lest" section.
export async function loadArticles(url = 'data/articles.json') {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    ARTICLES = json.papers ?? {};
    ARTICLES_DATE = json.date ?? '';
  } catch {
    /* no snapshot available — popups render without articles */
  }
}

const domainOf = (npUrl) => String(npUrl).replace(/^https?:\/\//, '').replace(/\/$/, '');

// HTML for one newspaper's "Mest lest" list, or '' when it has none.
export function artHtml(np) {
  const arts = ARTICLES[domainOf(np.url)] || [];
  if (!arts.length) return '';
  const rows = arts.map((a) => {
    const img = a.img ? `<img class="pu-art-img" src="${a.img}" alt="" onerror="this.remove()">` : '';
    const reads = (typeof a.reads === 'number') ? `${a.reads.toLocaleString('no')} lesninger` : '';
    return `<a class="pu-art" href="${a.url}" target="_blank" rel="noopener">${img}` +
      `<div class="pu-art-txt"><div class="pu-art-t">${a.title}</div>` +
      (reads ? `<div class="pu-art-m">${reads}</div>` : '') + '</div></a>';
  }).join('');
  return `<div class="pu-arts"><div class="pu-arts-h">Mest lest</div>${rows}` +
    (ARTICLES_DATE ? `<div class="pu-arts-date">Oppdatert ${ARTICLES_DATE}</div>` : '') + '</div>';
}
