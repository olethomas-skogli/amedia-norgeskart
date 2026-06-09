#!/usr/bin/env node
// Builds data/articles.json — a "Mest lest" (most-read) top-3 article snapshot
// per newspaper, consumed at runtime by js/articles.js.
//
// The bestread endpoint sends no CORS header, so the browser can't call it live
// from our origin — hence this build-time snapshot. Re-run to refresh.
//
//   node build/fetch-articles.mjs
//
// We fetch each paper's top-3 from services.api.no (joining domain -> sitekey
// via the sibling norway-newspaper-map/publications.json), download each
// thumbnail once, resize it small with macOS `sips`, and inline it as a base64
// data URI so popups render images instantly with zero network.

import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { NP } from '../js/newspapers.js';

const execFileP = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUTPUT = join(ROOT, 'data', 'articles.json');
const PUBLICATIONS = join(ROOT, '..', 'norway-newspaper-map', 'publications.json');

const UPSTREAM = 'https://services.api.no/api/stagehand/insights/articles/bestread';
const PERIOD = 72; // hours — the only window the API supports
const CONCURRENCY = 5;
const THUMB_WIDTH = 96; // 2x the 48px popup display; resized with macOS `sips`
const THUMB_QUALITY = 70;

// ---------- helpers ----------

const domainOf = (url) => String(url).replace(/^https?:\/\//, '').replace(/\/$/, '');

// Resolve a possibly-relative article URL against the paper's domain.
function absoluteUrl(url, domain) {
  if (!url) return `https://${domain}`;
  if (/^https?:\/\//.test(url)) return url;
  return `https://${domain}${url.startsWith('/') ? '' : '/'}${url}`;
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

// ---------- 1. domain -> sitekey map ----------

const pubsRaw = JSON.parse(await readFile(PUBLICATIONS, 'utf8'));
const pubs = Object.values(pubsRaw)
  .filter(Array.isArray)
  .flat()
  .filter((p) => p && p.domain && p.sitekey);
const domainToSitekey = {};
for (const p of pubs) domainToSitekey[p.domain] = p.sitekey;

console.log(`Found ${NP.length} newspapers in the map.`);

// ---------- 2. fetch top-3 per paper ----------

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
          title: (info.title ?? '').replace(/&shy;/g, '').trim(),
          url: absoluteUrl(info.url, domain),
          img: info.image?.url ?? null,
          reads: typeof d.stats?.count === 'number' ? d.stats.count : null,
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

const papers = Object.fromEntries(entries);
const totalArticles = Object.values(papers).reduce((n, a) => n + a.length, 0);
const date = new Date().toLocaleDateString('no-NO', { day: 'numeric', month: 'long', year: 'numeric' });

console.log(
  `Fetched: ${okCount} ok, ${failCount} failed, ${missingSitekey} without sitekey. ` +
    `${totalArticles} articles.`,
);

// ---------- 3. embed thumbnails as small resized data URIs ----------
// Upstream thumbnails are full-res (~2000px, ~650KB) and the signed URL can't
// be asked for a smaller size, so download once, resize with `sips`, inline.

const allArts = Object.values(papers).flat().filter((a) => a.img);
let imgOk = 0;
let imgFail = 0;

await mapLimit(allArts, CONCURRENCY, async (a, i) => {
  const inP = join(tmpdir(), `amthumb_${i}_in`);
  const outP = join(tmpdir(), `amthumb_${i}_out.jpg`);
  try {
    const r = await fetch(a.img);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await writeFile(inP, Buffer.from(await r.arrayBuffer()));
    // -Z scales the longest side; force JPEG so PNG sources shrink too.
    await execFileP('sips', [
      '-s', 'format', 'jpeg',
      '-s', 'formatOptions', String(THUMB_QUALITY),
      '-Z', String(THUMB_WIDTH),
      inP, '--out', outP,
    ]);
    const small = await readFile(outP);
    a.img = `data:image/jpeg;base64,${small.toString('base64')}`;
    imgOk++;
  } catch {
    a.img = null; // popup omits the thumbnail rather than hot-linking the heavy original
    imgFail++;
  } finally {
    await Promise.all([rm(inP, { force: true }), rm(outP, { force: true })]);
  }
});

console.log(`Thumbnails embedded: ${imgOk} ok, ${imgFail} failed/skipped.`);

// ---------- 4. write data/articles.json ----------

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, JSON.stringify({ date, papers }));

console.log(`\nWrote ${OUTPUT}`);
console.log('Reload the site to see the baked-in "Mest lest" articles in each popup.');
