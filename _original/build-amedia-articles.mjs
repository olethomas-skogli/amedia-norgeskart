#!/usr/bin/env node
// Bakes a "Mest lest" (most-read) top-3 article snapshot into the Amedia Norgeskart bundle.
//
// The map app lives inside the __bundler/template JSON string of source.html. We unpack it,
// fetch each paper's top-3 articles from services.api.no (joining on domain -> sitekey via the
// norway-newspaper-map publications.json), inject the data + a renderer + CSS into the inner app,
// then re-pack and write a new HTML file. The original source is never modified.
//
// The bestread endpoint has no CORS header, so a browser on file:// can't call it live — hence
// this build-time snapshot. Re-run to refresh.

import { readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "source.html");
const OUTPUT = join(HERE, "Amedia Norgeskart - med artikler.html");
const PUBLICATIONS = join(HERE, "..", "norway-newspaper-map", "publications.json");

const UPSTREAM = "https://services.api.no/api/stagehand/insights/articles/bestread";
const PERIOD = 72; // hours — the only window the API supports
const CONCURRENCY = 5;
const THUMB_WIDTH = 96; // 2x the 48px popup display; resized with macOS `sips`
const THUMB_QUALITY = 70;

// ---------- helpers ----------

const domainOf = (url) => String(url).replace(/^https?:\/\//, "").replace(/\/$/, "");

// Resolve a possibly-relative article URL against the paper's domain (mirrors app.js absoluteUrl).
function absoluteUrl(url, domain) {
  if (!url) return `https://${domain}`;
  if (/^https?:\/\//.test(url)) return url;
  return `https://${domain}${url.startsWith("/") ? "" : "/"}${url}`;
}

// Run async tasks with a bounded number in flight.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------- 1. unpack the bundle ----------

const html = await readFile(SOURCE, "utf8");

// The template is stored as: <script type="__bundler/template">"<!DOCTYPE...">"</script>
const tplMatch = html.match(
  /(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/,
);
if (!tplMatch) throw new Error("Could not find __bundler/template block in source.html");
const [, tplOpen, tplJson, tplClose] = tplMatch;
let inner = JSON.parse(tplJson); // the real inner HTML document

// ---------- 2. domain -> sitekey map ----------

const pubsRaw = JSON.parse(await readFile(PUBLICATIONS, "utf8"));
const pubs = Object.values(pubsRaw)
  .filter(Array.isArray)
  .flat()
  .filter((p) => p && p.domain && p.sitekey);
const domainToSitekey = {};
for (const p of pubs) domainToSitekey[p.domain] = p.sitekey;

// ---------- 3. parse NP array out of the inner app ----------

const npMatch = inner.match(/const NP\s*=\s*(\[[\s\S]*?\]);/);
if (!npMatch) throw new Error("Could not find `const NP = [...]` in the inner app");
const NP = JSON.parse(npMatch[1]);
console.log(`Found ${NP.length} newspapers in the map.`);

// ---------- 4. fetch top-3 per paper ----------

let okCount = 0;
let failCount = 0;
let missingSitekey = 0;

const entries = await mapLimit(NP, CONCURRENCY, async (np) => {
  const domain = domainOf(np.url);
  const sitekey = domainToSitekey[domain];
  if (!sitekey) {
    missingSitekey++;
    console.warn(`  ! no sitekey for ${domain} (${np.name})`);
    return [domain, []];
  }
  const url = `${UPSTREAM}?site_key=${encodeURIComponent(sitekey)}&period=${PERIOD}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const arts = (json.data ?? [])
      .slice(0, 3)
      .map((d) => {
        const info = d.info ?? {};
        return {
          title: (info.title ?? "").replace(/&shy;/g, "").trim(),
          url: absoluteUrl(info.url, domain),
          img: info.image?.url ?? null,
          reads: typeof d.stats?.count === "number" ? d.stats.count : null,
        };
      })
      .filter((a) => a.title);
    okCount++;
    return [domain, arts];
  } catch (err) {
    failCount++;
    console.warn(`  ! fetch failed for ${domain} (${sitekey}): ${err.message}`);
    return [domain, []];
  }
});

const ARTICLES = Object.fromEntries(entries);
const totalArticles = Object.values(ARTICLES).reduce((n, a) => n + a.length, 0);
const buildDate = new Date().toLocaleDateString("no-NO", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

console.log(
  `Fetched: ${okCount} ok, ${failCount} failed, ${missingSitekey} without sitekey. ` +
    `${totalArticles} articles baked.`,
);

// ---------- 4b. embed thumbnails as small resized data URIs ----------
// The upstream "thumbnails" are full-res (~2000px, ~650KB each) and the token-signed URL can't be
// asked for a smaller size. So we download each once, resize to THUMB_WIDTH with macOS `sips`, and
// inline it as a base64 data URI. Popups then render images instantly with zero network.

const allArts = Object.values(ARTICLES)
  .flat()
  .filter((a) => a.img);
let imgOk = 0;
let imgFail = 0;

await mapLimit(allArts, CONCURRENCY, async (a, i) => {
  const inP = join(tmpdir(), `amthumb_${i}_in`);
  const outP = join(tmpdir(), `amthumb_${i}_out.jpg`);
  try {
    const r = await fetch(a.img);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await writeFile(inP, Buffer.from(await r.arrayBuffer()));
    // -Z scales the longest side; force JPEG output so PNG sources shrink too.
    await execFileP("sips", [
      "-s", "format", "jpeg",
      "-s", "formatOptions", String(THUMB_QUALITY),
      "-Z", String(THUMB_WIDTH),
      inP, "--out", outP,
    ]);
    const small = await readFile(outP);
    a.img = `data:image/jpeg;base64,${small.toString("base64")}`;
    imgOk++;
  } catch (err) {
    a.img = null; // popup omits the thumbnail rather than hot-linking the heavy original
    imgFail++;
  } finally {
    await Promise.all([rm(inP, { force: true }), rm(outP, { force: true })]);
  }
});

console.log(`Thumbnails embedded: ${imgOk} ok, ${imgFail} failed/skipped.`);

// ---------- 5/6. inject data + renderer + CSS into the inner app ----------

// 6a. Data + renderer — prepend to the inline <script> that defines NP.
const dataBlock =
  `const ARTICLES = ${JSON.stringify(ARTICLES)};\n` +
  `const ARTICLES_DATE = ${JSON.stringify(buildDate)};\n` +
  `function artHtml(np){\n` +
  `  const arts = ARTICLES[String(np.url).replace(/^https?:\\/\\//,'').replace(/\\/$/,'')] || [];\n` +
  `  if(!arts.length) return '';\n` +
  `  const rows = arts.map(function(a){\n` +
  `    const img = a.img ? '<img class=\\"pu-art-img\\" src=\\"'+a.img+'\\" alt=\\"\\" onerror=\\"this.remove()\\">' : '';\n` +
  `    const reads = (typeof a.reads==='number') ? a.reads.toLocaleString('no')+' lesninger' : '';\n` +
  `    return '<a class=\\"pu-art\\" href=\\"'+a.url+'\\" target=\\"_blank\\" rel=\\"noopener\\">'+img+\n` +
  `      '<div class=\\"pu-art-txt\\"><div class=\\"pu-art-t\\">'+a.title+'</div>'+\n` +
  `      (reads?'<div class=\\"pu-art-m\\">'+reads+'</div>':'')+'</div></a>';\n` +
  `  }).join('');\n` +
  `  return '<div class=\\"pu-arts\\"><div class=\\"pu-arts-h\\">Mest lest</div>'+rows+\n` +
  `    '<div class=\\"pu-arts-date\\">Oppdatert '+ARTICLES_DATE+'</div></div>';\n` +
  `}\n`;

const beforeNP = inner;
inner = inner.replace(/(const NP\s*=\s*\[)/, dataBlock + "$1");
if (inner === beforeNP) throw new Error("Failed to inject ARTICLES/artHtml before NP");

// 6b. Popup — inject ${artHtml(np)} just before the closing </div> of the .pu popup,
// anchoring on the unique "Besøk nettavis" link that ends the popup body.
const popupAnchor = inner.match(/(Besøk nettavis[^<]*<\/a>\s*)(<\/div>`)/);
if (!popupAnchor) throw new Error("Could not find the popup 'Besøk nettavis' anchor");
inner = inner.replace(
  /(Besøk nettavis[^<]*<\/a>\s*)(<\/div>`)/,
  "$1${artHtml(np)}$2",
);

// 6c. CSS — append a <style> block before </head>.
const css =
  `\n<style>\n` +
  `.pu-arts{margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.12)}\n` +
  `.pu-arts-h{font:600 11px/1.2 -apple-system,BlinkMacSystemFont,sans-serif;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:6px}\n` +
  `.pu-art{display:flex;gap:8px;align-items:flex-start;text-decoration:none;color:inherit;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.07)}\n` +
  `.pu-art:last-of-type{border-bottom:none}\n` +
  `.pu-art:hover .pu-art-t{text-decoration:underline}\n` +
  `.pu-art-img{width:48px;height:36px;flex:0 0 auto;object-fit:cover;border-radius:4px;background:rgba(255,255,255,0.08)}\n` +
  `.pu-art-txt{min-width:0}\n` +
  `.pu-art-t{font:600 12px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;color:var(--text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}\n` +
  `.pu-art-m{font:11px/1.2 -apple-system,BlinkMacSystemFont,sans-serif;color:var(--muted);margin-top:2px}\n` +
  `.pu-arts-date{font:10px/1.2 -apple-system,BlinkMacSystemFont,sans-serif;color:rgba(255,255,255,0.4);margin-top:6px}\n` +
  `</style>\n`;
const beforeCss = inner;
inner = inner.replace(/<\/head>/i, css + "</head>");
if (inner === beforeCss) throw new Error("Could not find </head> to inject CSS");

// ---------- 7. re-pack ----------

// Escape `</` -> `<\/` so inner </script> tags don't prematurely close the outer
// <script type="__bundler/template"> wrapper. `\/` is a valid JSON escape (the browser's
// JSON.parse turns it back into `/`). The original bundle used / for the same reason;
// JSON.stringify re-emits literal `/`, so we must re-escape before writing.
const newTpl = tplOpen + JSON.stringify(inner).replace(/<\//g, "<\\/") + tplClose;
const outHtml = html.slice(0, tplMatch.index) + newTpl + html.slice(tplMatch.index + tplMatch[0].length);
await writeFile(OUTPUT, outHtml);

console.log(`\nWrote ${OUTPUT}`);
console.log(`Open it in a browser to see the baked-in "Mest lest" articles in each popup.`);
