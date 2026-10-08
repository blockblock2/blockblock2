// Scores your Scratch account out of 100 and draws it as a status bar
// (scratch-score.svg), then points the README section at it.
// Everything comes live from the Scratch API, so nothing is hardcoded.
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const USER = process.env.SCRATCH_USER || "blockblock2";
const README = process.env.README_PATH || "README.md";
const IMAGE = process.env.SCORE_IMAGE || "scratch-score.svg";
const START = "<!-- SCRATCH-SCORE:START -->";
const END = "<!-- SCRATCH-SCORE:END -->";

// Score needed for the full 20 points in each stat.
const TARGETS = { stars: 200, hearts: 200, remixes: 50, studio_invites: 50, followers: 200 };

const API = 'https://api.scratch.mit.edu';
const PAGE = 40; // Scratch API max page size

// Each stat is worth 20 points (5 x 20 = 100). Points grow evenly and
// the stat only maxes out when it reaches its target.
const CATEGORIES = [
  { key: 'stars',          label: 'Stars',          icon: '★', color: '#f5b400' },
  { key: 'hearts',         label: 'Hearts',         icon: '♥', color: '#ef4a6b' },
  { key: 'remixes',        label: 'Remixes',        icon: '⟳', color: '#3fb46b' },
  { key: 'studio_invites', label: 'Invites', icon: '▣', color: '#4c97ff' },
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
  // Straight line: half the target = 10 points, the full target = 20.
  if (!(value > 0)) return 0;
  return 20 * Math.min(1, value / target);
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

// Neon arcade card, matching followers-card.svg (same size, colors and fonts).
function renderSVG(username, result) {
  const W = 860, PAD = 40, inner = W - 2 * PAD;
  const mono = "ui-monospace,SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono',monospace";
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif";
  const neonColors = { stars: '#ffc531', hearts: '#ff2bd6', remixes: '#3dffa2', studio_invites: '#19e3ff', followers: '#a98bff' };
  const total = result.total, left = 100 - total;
  const fillW = total ? Math.max(14, inner * total / 100) : 0;
  const rank = grade(total).toUpperCase();
  const best = [...result.parts].sort((a, b) => b.points - a.points || b.value - a.value)[0];
  const maxed = result.parts.filter(p => p.points >= 19.95).length;

  // Stat tiles
  const gap = 14, tw = (inner - gap * 4) / 5, ty = 300, th = 150;
  const tiles = result.parts.map((p, i) => {
    const x = PAD + i * (tw + gap), c = neonColors[p.key], isMax = p.points >= 19.95;
    const mw = tw - 32, mf = (p.points / 20) * mw;
    return `
  <rect x="${x}" y="${ty}" width="${tw}" height="${th}" rx="14" fill="#120f24" stroke="${isMax ? '#ffc531' : '#4a4580'}" stroke-opacity="${isMax ? '.8' : '.7'}" stroke-width="2"${isMax ? ' filter="url(#softglow)"' : ''}/>
  <text x="${x + 16}" y="${ty + 30}" font-family="${mono}" font-size="11" font-weight="700" letter-spacing="2" fill="#8f93c9">${esc(p.label.toUpperCase())}</text>
  <text x="${x + 16}" y="${ty + 76}" font-family="${mono}" font-size="34" font-weight="800" fill="${c}" filter="url(#softglow)">${fmt(p.value)}</text>
  <rect x="${x + 16}" y="${ty + 96}" width="${mw}" height="8" rx="4" fill="#1b1830" stroke="#2c2850"/>
  ${mf > 0 ? `<rect x="${x + 16}" y="${ty + 96}" width="${Math.max(8, mf).toFixed(1)}" height="8" rx="4" fill="${c}"/>` : ''}
  <text x="${x + 16}" y="${ty + 130}" font-family="${mono}" font-size="13" font-weight="700" fill="#d9dcff">${p.points.toFixed(1)}<tspan fill="#5d6094">/20</tspan></text>
  ${isMax ? `<rect x="${x + tw - 62}" y="${ty + 115}" width="46" height="20" rx="10" fill="#ffc531"/><text x="${x + tw - 39}" y="${ty + 129}" text-anchor="middle" font-family="${mono}" font-size="11" font-weight="800" fill="#1a1300">MAX</text>` : ''}`;
  }).join('');

  const H = ty + th + 86, fy = H - 34;
  const bx = W - PAD - 190, bw = 190;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Scratch score ${total} out of 100">
<title>${esc(username)}: Scratch score ${total}/100</title>
<defs>
  <linearGradient id="neon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff2bd6"/><stop offset=".5" stop-color="#7b5cff"/><stop offset="1" stop-color="#19e3ff"/></linearGradient>
  <linearGradient id="xp" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#19e3ff"/><stop offset="1" stop-color="#ff2bd6"/></linearGradient>
  <linearGradient id="shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <radialGradient id="vignette" cx=".5" cy="0" r="1"><stop offset="0" stop-color="#2a1650" stop-opacity=".9"/><stop offset=".6" stop-color="#0a0a14" stop-opacity="0"/></radialGradient>
  <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="#ffffff" stroke-opacity=".045"/></pattern>
  <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" fill-opacity=".22"/></pattern>
  <filter id="glow" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="softglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <clipPath id="bar"><rect x="${PAD}" y="206" width="${inner}" height="14" rx="7"/></clipPath>
</defs>
<style>
  .count { animation: pulse 3s ease-in-out infinite; }
  .shine { animation: sweep 2.8s linear infinite; }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .72 } }
  @keyframes sweep { from { transform: translateX(-160px) } to { transform: translateX(${inner + 160}px) } }
  @media (prefers-reduced-motion: reduce) { .count, .shine { animation: none } }
</style>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="20" fill="#0a0a14"/>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="20" fill="url(#vignette)"/>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="20" fill="url(#grid)"/>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="20" fill="url(#scan)"/>
<rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="19" fill="none" stroke="url(#neon)" stroke-width="3"/>
<path d="M${PAD} 24h60M${W - PAD - 60} ${H - 24}h60" stroke="url(#neon)" stroke-width="3" stroke-linecap="round"/>

<text x="${PAD}" y="62" font-family="${mono}" font-size="15" font-weight="700" letter-spacing="4" fill="#8f93c9">SCRATCH SCORE</text>
<text class="count" x="${PAD - 4}" y="158" font-family="${mono}" font-size="96" font-weight="800" fill="#19e3ff" opacity=".9" filter="url(#glow)">${total}</text>
<text x="${PAD - 4}" y="158" font-family="${mono}" font-size="96" font-weight="800" fill="#ffffff">${total}<tspan font-size="30" fill="#5d6094" font-weight="700">/100</tspan></text>
<text x="${PAD}" y="186" font-family="${mono}" font-size="15" fill="#19e3ff">@${esc(username)}</text>

<rect x="${bx}" y="40" width="${bw}" height="128" rx="14" fill="#120f24" stroke="#ff2bd6" stroke-opacity=".55" stroke-width="2"/>
<text x="${bx + bw / 2}" y="72" text-anchor="middle" font-family="${mono}" font-size="14" font-weight="700" letter-spacing="5" fill="#ff7be6">RANK</text>
<text x="${bx + bw / 2}" y="${rank.length > 9 ? 124 : 128}" text-anchor="middle" font-family="${mono}" font-size="${rank.length > 9 ? 17 : 26}" font-weight="800" fill="#ff2bd6" filter="url(#softglow)">${esc(rank)}</text>
<text x="${bx + bw / 2}" y="160" text-anchor="middle" font-family="${mono}" font-size="11" letter-spacing="1" fill="#8f93c9">${maxed}/5 STATS MAXED</text>

<rect x="${PAD}" y="206" width="${inner}" height="14" rx="7" fill="#1b1830" stroke="#2c2850"/>
<g clip-path="url(#bar)">
  <rect x="${PAD}" y="206" width="${fillW.toFixed(1)}" height="14" fill="url(#xp)" filter="url(#softglow)"/>
  <rect class="shine" x="${PAD}" y="206" width="120" height="14" fill="url(#shine)" opacity=".7"/>
</g>
<text x="${PAD}" y="246" font-family="${mono}" font-size="14" font-weight="700" fill="#d9dcff">SCORE ${total}/100${total === 100 ? '  <tspan fill="#ffc531">★ PERFECT!</tspan>' : ''}</text>
<text x="${W - PAD}" y="246" text-anchor="end" font-family="${mono}" font-size="14" fill="#8f93c9">${left > 0 ? `${left} MORE TO <tspan fill="#ffc531" font-weight="700">100</tspan>` : '<tspan fill="#ffc531" font-weight="700">MAXED OUT</tspan>'}</text>

<text x="${PAD}" y="286" font-family="${mono}" font-size="15" font-weight="700" letter-spacing="4" fill="#ffc531">★ STATS</text>
<text x="${W - PAD}" y="286" text-anchor="end" font-family="${mono}" font-size="13" fill="#8f93c9">20 POINTS EACH · 5 STATS</text>
${tiles}

<text x="${PAD}" y="${fy}" font-family="${mono}" font-size="13" fill="#8f93c9">BEST STAT <tspan fill="#19e3ff" font-weight="700">▸ ${esc(best.label.toUpperCase())}</tspan></text>
<text x="${W - PAD - 70}" y="${fy}" text-anchor="end" font-family="${mono}" font-size="12" fill="#5d6094">LIVE · UPDATES EVERY 6 HOURS</text>
</svg>`;
}

const u = encodeURIComponent(USER);
const user = await getJSON(`${API}/users/${u}`);
const projects = await getAll(`/users/${u}/projects`, 50);
const followers = await getAll(`/users/${u}/followers`, 250);
const studios = await getAll(`/users/${u}/studios/curate`, 50);

// The project list always says 0 remixes, so ask each project for its real stats
// (a few at a time to go easy on Scratch). Falls back to the list's numbers.
const detailed = [];
for (let i = 0; i < projects.items.length; i += 8) {
  const batch = projects.items.slice(i, i + 8);
  detailed.push(...await Promise.all(batch.map((p) =>
    getJSON(`${API}/projects/${p.id}`).catch(() => p))));
}
const sum = (k) => detailed.reduce((s, p) => s + (p.stats?.[k] || 0), 0);
const stats = {
  stars: sum("favorites"),
  hearts: sum("loves"),
  remixes: sum("remixes"),
  // Studios you curate that someone else made = studio invites you accepted.
  studio_invites: studios.items.filter((st) => st.host !== user.id).length,
  followers: followers.items.length,
};

const result = score(stats, TARGETS);
const svg = renderSVG(USER, result);
writeFileSync(IMAGE, svg);
// ?v= changes with the picture so GitHub shows the new one right away.
const v = createHash("sha256").update(svg).digest("hex").slice(0, 8);

const readme = readFileSync(README, "utf8");
const s = readme.indexOf(START), e = readme.indexOf(END);
if (s === -1 || e < s) throw new Error(`Add ${START} and ${END} to ${README}`);
const block = `${START}
<p align="center">
  <a href="https://scratch.mit.edu/users/${USER}/"><img src="${IMAGE}?v=${v}" width="100%" alt="Scratch score: ${result.total} out of 100"></a>
</p>
${END}`;
writeFileSync(README, readme.slice(0, s) + block + readme.slice(e + END.length));

console.log(`Score: ${result.total}/100 (${grade(result.total)})`);
for (const p of result.parts) console.log(`  ${p.label}: ${p.value} -> ${p.points.toFixed(1)}/20`);
