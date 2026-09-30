// Updates README.md with a countdown to your next Scratchaversary.
// Your join date is pulled live from the Scratch API, so nothing is hardcoded.
import { readFileSync, writeFileSync } from "node:fs";

const USER = process.env.SCRATCH_USER || "blockblock2";
const README = process.env.README_PATH || "README.md";
const START = "<!-- SCRATCHAVERSARY:START -->";
const END = "<!-- SCRATCHAVERSARY:END -->";
const DAY = 86_400_000;

const res = await fetch(`https://api.scratch.mit.edu/users/${USER}`);
if (!res.ok) throw new Error(`Scratch API returned ${res.status}`);
const joined = new Date((await res.json()).history.joined);

// Work in local dates (TZ is set in the workflow) so "today" means today for you.
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const anniv = (y) => new Date(y, joined.getMonth(), joined.getDate());

let year = today.getFullYear();
if (anniv(year) < today) year++;
const next = anniv(year);
const prev = anniv(year - 1);

const days = Math.round((next - today) / DAY);
const cycle = Math.round((next - prev) / DAY);
const turning = year - joined.getFullYear();

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const fmt = (d) =>
  d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

const WIDTH = 20;
const filled = Math.round(((cycle - days) / cycle) * WIDTH);
const bar = "█".repeat(filled) + "░".repeat(WIDTH - filled);

const body =
  days === 0
    ? `🎉 **Today is my ${ordinal(turning)} Scratchaversary!** 🎉  \n` +
      `Joined Scratch on ${fmt(joined)}`
    : `🐱 **${days} day${days === 1 ? "" : "s"}** until my ${ordinal(turning)} Scratchaversary (${fmt(next)})  \n` +
      `\`${bar}\` ${Math.round(((cycle - days) / cycle) * 100)}%  \n` +
      `<sub>Scratcher since ${fmt(joined)}</sub>`;

const readme = readFileSync(README, "utf8");
const s = readme.indexOf(START), e = readme.indexOf(END);
if (s === -1 || e === -1 || e < s) {
  throw new Error(`Add ${START} and ${END} to ${README} where the countdown should go.`);
}

const updated = readme.slice(0, s + START.length) + "\n" + body + "\n" + readme.slice(e);
if (updated !== readme) {
  writeFileSync(README, updated);
  console.log("README updated:\n" + body);
} else {
  console.log("No change.");
}
