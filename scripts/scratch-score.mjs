// Scores your Scratch account out of 100 and draws it as a status bar
// (scratch-score.svg), then points the README section at it.
// Everything comes live from the Scratch API, so nothing is hardcoded.
import { writeFileSync, readFileSync } from "node:fs";

const USER = process.env.SCRATCH_USER || "blockblock2";
const README = process.env.README_PATH || "README.md";
const IMAGE = process.env.SCORE_IMAGE || "scratch-score.svg";
const THEME = process.env.SCORE_THEME || "light";
const START = "<!-- SCRATCH-SCORE:START -->";
const END = "<!-- SCRATCH-SCORE:END -->";

// Score needed for the full 20 points in each stat.
const TARGETS = { stars: 100, hearts: 100, remixes: 25, studio_invites: 25, followers: 100 };

const API = 'https://api.scratch.mit.edu';
const PAGE = 40; // Scratch API max page size

// Each stat is worth 20 points (5 x 20 = 100). Points grow on a log curve,
// so the first few hearts count a lot and the bar fills completely at the target.
const CATEGORIES = [
  { key: 'stars',          label: 'Stars',          icon: '★', color: '#f5b400' },
  { key: 'hearts',         label: 'Hearts',         icon: '♥', color: '#ef4a6b' },
  { key: 'remixes',        label: 'Remixes',        icon: '⟳', color: '#3fb46b' },
  { key: 'studio_invites', label: 'Studio invites', icon: '▣', color: '#4c97ff' },
  { key: 'followers',      label: 'Followers',      icon: '☺', color: '#9966ff' },
];

async function getJSON(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'scratch-score-action' } });
    if (res.ok) return res.json();
    if (res.status === 404) throw new Error(`Not found: ${url} (check the username)`);
    await new Promise(r => setTimeout(r, 1000 * attempt));
  }
  throw new Error(`Scratch API kept failing for ${url}`);
}

// Walks a paged Scratch endpoint until a short page comes back.
async function getAll(endpoint, maxPages) {
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = await getJSON(`${API}${endpoint}?limit=${PAGE}&offset=${page * PAGE}`);
    all.push(...batch);
    if (batch.length < PAGE) return { items: all, capped: false };
  }
  return { items: all, capped: true };
}

function points(value, target) {
  if (!(value > 0)) return 0;
  return 20 * Math.min(1, Math.log1p(value) / Math.log1p(target));
}

function score(stats, targets) {
  const parts = CATEGORIES.map(c => ({
    ...c,
    value: stats[c.key],
    target: targets[c.key],
    points: points(stats[c.key], targets[c.key]),
  }));
  const total = Math.round(parts.reduce((s, p) => s + p.points, 0));
  return { total, parts };
}

function grade(total) {
  if (total >= 90) return 'Legendary';
  if (total >= 75) return 'Popular';
  if (total >= 55) return 'Rising';
  if (total >= 35) return 'Getting noticed';
  return 'Just starting';
}

const esc = s => String(s).replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = n => n >= 10000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : n.toLocaleString('en-US');

function renderSVG(username, result, theme) {
  const dark = theme === 'dark';
  const bg = dark ? '#0f1422' : '#ffffff';
  const fg = dark ? '#e7ebf5' : '#1b2033';
  const muted = dark ? '#8f98b3' : '#626b85';
  const track = dark ? '#232a3d' : '#e9ecf4';
  const border = dark ? '#2b3349' : '#d9deea';

  const W = 520, barX = 24, barY = 78, barW = W - 48, barH = 18;
  const seg = barW / 5;

  // One segment per stat; each fills by its share of 20 points.
  const segments = result.parts.map((p, i) => {
    const x = barX + i * seg;
    const fill = (p.points / 20) * (seg - 3);
    return `<rect x="${x}" y="${barY}" width="${seg - 3}" height="${barH}" rx="4" fill="${track}"/>` +
      (fill > 0 ? `<rect x="${x}" y="${barY}" width="${fill.toFixed(1)}" height="${barH}" rx="4" fill="${p.color}"/>` : '');
  }).join('');

  const rows = result.parts.map((p, i) => {
    const x = barX + i * seg;
    return `<circle cx="${x + 5}" cy="${barY + 35.5}" r="4.5" fill="${p.color}"/>` +
      `<text x="${x + 16}" y="${barY + 40}" fill="${fg}" font-size="13" font-weight="600">${fmt(p.value)}</text>` +
      `<text x="${x}" y="${barY + 57}" fill="${muted}" font-size="10.5">${esc(p.label)}</text>` +
      `<text x="${x}" y="${barY + 71}" fill="${muted}" font-size="10.5">${p.points.toFixed(1)} / 20</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="172" viewBox="0 0 ${W} 172" role="img" aria-label="Scratch score for ${esc(username)}: ${result.total} out of 100">
<style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="171" rx="12" fill="${bg}" stroke="${border}"/>
<text x="24" y="34" fill="${muted}" font-size="12">Scratch score</text>
<text x="24" y="58" fill="${fg}" font-size="17" font-weight="700">@${esc(username)}</text>
<text x="${W - 24}" y="58" fill="${muted}" font-size="14" text-anchor="end">/ 100</text>
<text x="${W - 70}" y="58" fill="${fg}" font-size="30" font-weight="700" text-anchor="end">${result.total}</text>
<text x="${W - 24}" y="34" fill="${muted}" font-size="12" text-anchor="end">${esc(grade(result.total))}</text>
${segments}
${rows}
</svg>`;
}


const u = encodeURIComponent(USER);
const user = await getJSON(`${API}/users/${u}`);
const projects = await getAll(`/users/${u}/projects`, 50);
const followers = await getAll(`/users/${u}/followers`, 250);
const studios = await getAll(`/users/${u}/studios/curate`, 50);

const sum = (k) => projects.items.reduce((s, p) => s + (p.stats?.[k] || 0), 0);
const stats = {
  stars: sum("favorites"),
  hearts: sum("loves"),
  remixes: sum("remixes"),
  // Studios you curate that someone else made = studio invites you accepted.
  studio_invites: studios.items.filter((st) => st.host !== user.id).length,
  followers: followers.items.length,
};

const result = score(stats, TARGETS);
writeFileSync(IMAGE, renderSVG(USER, result, THEME));

const readme = readFileSync(README, "utf8");
const s = readme.indexOf(START), e = readme.indexOf(END);
if (s === -1 || e < s) throw new Error(`Add ${START} and ${END} to ${README}`);
const block = `${START}
<p align="center">
  <a href="https://scratch.mit.edu/users/${USER}/"><img src="${IMAGE}" width="520" alt="Scratch score: ${result.total} out of 100"></a>
</p>
${END}`;
writeFileSync(README, readme.slice(0, s) + block + readme.slice(e + END.length));

console.log(`Score: ${result.total}/100 (${grade(result.total)})`);
for (const p of result.parts) console.log(`  ${p.label}: ${p.value} -> ${p.points.toFixed(1)}/20`);
