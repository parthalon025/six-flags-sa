#!/usr/bin/env node
/**
 * Bake review surface — every bake beside its pinned reference images.
 *
 * Emits one self-contained review.html (images inlined as data URIs) from
 * a directory of bakes: bake | reference images | style-cert rows | the
 * profile's agent-review prompts. This is what a bake PR's reviewer —
 * human or agent — opens; the sha-pinned image ledger guarantees the left
 * half of every comparison is stable.
 *
 *   npm run venues:bake-review                       # artifacts/display-bake
 *   npm run venues:bake-review -- --dir some/dir
 */

import path from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { MONO_ROOT, readJson } from '../lib/venue-io.mjs';
import {
  readReferenceProfiles, profileForKit, readReferenceImageLedger, referenceImagePath,
} from '../lib/display-references.mjs';

const argv = process.argv.slice(2);
let dir = path.join(MONO_ROOT, 'artifacts', 'display-bake');
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--dir') dir = path.resolve(argv[++i]);
}

const MIME = { '.png': 'image/png', '.webp': 'image/webp', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg' };
const dataUri = (file) => {
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const profiles = readReferenceProfiles();
const imageLedger = readReferenceImageLedger();
const bakes = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : [];
if (!bakes.length) {
  console.error(`no bakes under ${dir} — run venues:bake first`);
  process.exit(2);
}

const sections = bakes.map((png) => {
  const stem = png.replace(/\.png$/, '');
  const kitId = stem.split('--')[1];
  const profile = profileForKit(kitId, profiles);
  const cert = readJson(path.join(dir, `${stem}.style-cert.json`), null);
  const refs = (profile?.inspiration?.images || [])
    .map((id) => imageLedger[id])
    .filter((row) => row && existsSync(referenceImagePath(row)));
  const rows = (cert?.checks || []).map((c) => `
    <tr class="${c.pass ? 'ok' : 'bad'}"><td>${c.pass ? '✓' : '✗'}</td><td>${esc(c.key)}</td><td>${esc(c.evidence)}</td></tr>`).join('');
  const review = (cert?.review || []).map((r) => `
    <li><label><input type="checkbox"> ${esc(r.prompt)}</label></li>`).join('');
  return `
  <section>
    <h2>${esc(stem)} ${cert ? (cert.certified ? '<span class="ok">certified</span>' : '<span class="bad">FAILING</span>') : '<span>uncertified</span>'}</h2>
    <div class="pair">
      <figure><img src="${dataUri(path.join(dir, png))}"><figcaption>bake</figcaption></figure>
      ${refs.map((r) => `<figure><img src="${dataUri(referenceImagePath(r))}"><figcaption>${esc(r.label)}</figcaption></figure>`).join('')}
    </div>
    ${rows ? `<table><tr><th></th><th>check</th><th>evidence</th></tr>${rows}</table>` : ''}
    ${review ? `<h3>Agent review</h3><ul>${review}</ul>` : ''}
  </section>`;
}).join('\n');

const html = `<!doctype html><meta charset="utf-8"><title>Bake review</title>
<style>
body{font:14px system-ui;margin:2rem;background:#f6f4ef;color:#222}
section{background:#fff;border:1px solid #ddd;border-radius:8px;padding:1rem;margin-bottom:2rem}
.pair{display:flex;gap:1rem;overflow-x:auto}
figure{margin:0}figure img{max-height:420px;display:block;border:1px solid #ccc}
figcaption{font-size:12px;color:#666;padding:2px 0}
table{border-collapse:collapse;margin-top:.75rem;font-size:13px}
td,th{border:1px solid #ddd;padding:3px 8px;text-align:left}
tr.ok td:first-child{color:#2c7a3f}tr.bad td:first-child{color:#c02020}
tr.bad{background:#fdecec}
.ok{color:#2c7a3f}.bad{color:#c02020}
</style>
<h1>Bake review — ${bakes.length} bake(s)</h1>
${sections}`;

const out = path.join(dir, 'review.html');
writeFileSync(out, html);
console.log(`review sheet: ${out} (${bakes.length} bakes)`);
