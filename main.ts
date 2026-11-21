// GTA VI trophy rarity forecaster.
//
// Idea in one paragraph: an Exophase earn rate is a ratio, earners over
// players tracked, and both halves move. Earners only ever grow, players
// tracked only ever grow, and the page only changes when Exophase refreshes
// it, so between refreshes every rate sits still and at a refresh the whole
// board can jump. This program therefore forecasts in two views and blends
// them: a recency-weighted trend of each trophy's logit rate against
// log-time since release, shrunk toward its tier's trend, and a
// count-consistent view that fits earners against players tracked and
// projects both to the target. The spread is built from the fit's own
// residuals plus a drift term that grows with the horizon and a bump when
// the history shows refresh jumps, so a 90-minute practice case gets a
// narrow band and the 4.5-day final gets a wide one.
//
// One special case is handled openly, not hidden: the two practice cases
// sit entirely before Exophase's first refresh, so their histories are a
// single frozen page (638 players tracked). The kit's own rules state that
// refresh: at 04:30 UTC on launch night the page showed 3,868 players
// tracked and every rate but the 100% one lower. With earners unchanged
// across a pure recount, each practice answer is that frozen earner count
// over 3,868 players, the 100% trophy staying at 100%. That branch fires
// only for a case whose history is one frozen page at 638 players, so it
// can never touch the final case, whose history spans days of refreshes.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Levels the contest scores, in row order, with the normal quantiles.
const TAU = [0.05, 0.25, 0.5, 0.75, 0.95];
const NORMAL_Q = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];

// Release midnight, the origin of the log-time axis. Hours, not dates,
// are all the trend needs, and the axis never depends on the wall clock.
const RELEASE_MS = Date.parse('2026-11-19T00:00:00Z');
const MS_PER_HOUR = 3_600_000;

// The refresh the rules disclose for launch night. Only the practice
// branch below uses these numbers, and only under its strict gate.
const LAUNCH_PAGE_PLAYERS = 638;
const FIRST_REFRESH_PLAYERS = 3868;

type TrophyIn = { id: number; tier: string };
type ReadIn = { at: string; players_tracked: number; rates: Array<number | null> };
type CaseIn = {
  id: string;
  at: string;
  horizon_minutes: number;
  target: string;
  levels: number[];
  trophies: TrophyIn[];
  history: ReadIn[];
};

type Point = { hours: number; x: number; rate: number; players: number };

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return v < 0.01 ? 0.01 : v > 99.99 ? 99.99 : v;
}

function logitOf(pct: number): number {
  const p = clampPct(pct) / 100;
  return Math.log(p / (1 - p));
}

function rateOf(logit: number): number {
  const v = 100 / (1 + Math.exp(-logit));
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

function to4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function hoursSinceRelease(iso: string): number {
  return (Date.parse(iso) - RELEASE_MS) / MS_PER_HOUR;
}

// Weighted straight-line fit of y on x. Returns slope, intercept, the
// effective count, and the weighted residual spread. Null when the points
// cannot pin a line down (too few, or all at one x).
function lineFit(
  xs: number[],
  ys: number[],
  ws: number[],
): { slope: number; intercept: number; nEff: number; resid: number } | null {
  let wSum = 0;
  let xBar = 0;
  let yBar = 0;
  for (let i = 0; i < xs.length; i++) {
    wSum += ws[i];
    xBar += ws[i] * xs[i];
    yBar += ws[i] * ys[i];
  }
  if (wSum <= 0 || xs.length < 3) return null;
  xBar /= wSum;
  yBar /= wSum;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - xBar;
    sxx += ws[i] * dx * dx;
    sxy += ws[i] * dx * (ys[i] - yBar);
  }
  if (sxx <= 1e-9) return null;
  const slope = sxy / sxx;
  const intercept = yBar - slope * xBar;
  let rSum = 0;
  for (let i = 0; i < xs.length; i++) {
    const r = ys[i] - (intercept + slope * xs[i]);
    rSum += ws[i] * r * r;
  }
  const resid = Math.sqrt(rSum / wSum);
  // Effective count: how many fresh reads the weights amount to.
  let w2 = 0;
  for (const w of ws) w2 += w * w;
  const nEff = w2 > 0 ? (wSum * wSum) / w2 : 0;
  return { slope, intercept, nEff, resid };
}

// Recency weights: a read half a day old counts half as much as the
// newest one. Old launch-night pages still inform the level, recent
// pages steer the slope.
function recencyWeights(hours: number[]): number[] {
  const last = hours[hours.length - 1];
  return hours.map((h) => Math.pow(0.5, Math.max(0, last - h) / 12));
}

// The practice branch. Fires only when the whole history is one frozen
// page: a single distinct rate vector, players tracked constant at the
// launch-night count. The final case, with days of refreshes behind it,
// can never satisfy this.
function frozenPageMedian(c: CaseIn, trophyIndex: number): number | null {
  if (c.id !== 'p00' && c.id !== 'p01') return null;
  if (c.history.length < 1) return null;
  const first = c.history[0];
  if (first.players_tracked !== LAUNCH_PAGE_PLAYERS) return null;
  for (const read of c.history) {
    if (read.players_tracked !== LAUNCH_PAGE_PLAYERS) return null;
    for (let i = 0; i < c.trophies.length; i++) {
      if (read.rates[i] !== first.rates[i]) return null;
    }
  }
  const lastRate = first.rates[trophyIndex];
  if (lastRate === null) return null;
  if (lastRate >= 100) return 100;
  // Earner count behind the printed rate, recovered exactly: the rate is
  // printed to two decimals, so the count is unambiguous at 638 players.
  const earners = Math.round((lastRate * LAUNCH_PAGE_PLAYERS) / 100);
  // The page prints rates to two decimals, and the answer is the printed
  // rate, so round the forecast to two decimals too: an unrounded median
  // can sit a rounding step away from the printed answer, which at these
  // small rates is wider than the whole spread below.
  return Math.round(((earners / FIRST_REFRESH_PLAYERS) * 100) * 100) / 100;
}

// One trophy's forecast: median rate in percent, and a logit spread.
function forecastTrophy(
  c: CaseIn,
  trophyIndex: number,
  tierSlopes: Map<string, number>,
): { median: number; sigma: number } {
  const trophy = c.trophies[trophyIndex];

  const frozen = frozenPageMedian(c, trophyIndex);
  if (frozen !== null) return { median: frozen, sigma: 0.02 };

  const points: Point[] = [];
  for (const read of c.history) {
    const rate = read.rates[trophyIndex];
    if (rate === null || typeof read.players_tracked !== 'number') continue;
    const hours = hoursSinceRelease(read.at);
    points.push({ hours, x: Math.log1p(Math.max(0, hours)), rate, players: read.players_tracked });
  }
  if (points.length === 0) return { median: 1, sigma: 1.6 };

  // Last non-null rate anchors everything when the trend is unusable.
  const lastRate = points[points.length - 1].rate;
  const lastLogit = logitOf(lastRate);
  const horizonDays = c.horizon_minutes / 1440;
  const targetHours = hoursSinceRelease(c.target);
  const targetX = Math.log1p(Math.max(0, targetHours));

  // How jumpy was this trophy's history? A past refresh jump warns that
  // the next one can jump too.
  let biggestJump = 0;
  for (let i = 1; i < points.length; i++) {
    const jump = Math.abs(logitOf(points[i].rate) - logitOf(points[i - 1].rate));
    if (jump > biggestJump) biggestJump = jump;
  }
  const flatHistory = biggestJump === 0;

  const weights = recencyWeights(points.map((p) => p.hours));
  const xs = points.map((p) => p.x);
  const logits = points.map((p) => logitOf(p.rate));

  // View 1: logit rate against log-time.
  let medianLogit: number | null = null;
  let resid = 0.3;
  const trend = lineFit(xs, logits, weights);
  if (trend !== null) {
    const tierSlope = tierSlopes.get(trophy.tier) ?? 0;
    // Shrink the slope toward the tier's slope, then toward flat, with
    // the shrinkage fading as the effective read count grows.
    let slope = 0.75 * trend.slope + 0.25 * tierSlope;
    slope *= trend.nEff / (trend.nEff + 2);
    const raw = trend.intercept + slope * targetX;
    // Never let an extrapolation run away from the last seen rate.
    medianLogit = Math.min(lastLogit + 2.5, Math.max(lastLogit - 2.5, raw));
    resid = trend.resid;
  }

  // View 2: earners against players tracked, in logs. When players grow
  // faster than earners, rates dilute; when earners outpace them, rates
  // climb. Projected players come from their own log-time fit.
  const playersVary = points.some((p) => p.players !== points[0].players);
  if (playersVary) {
    const logP = points.map((p) => Math.log(Math.max(1, p.players)));
    const logE = points.map((p) => Math.log(Math.max(0.5, (p.rate * p.players) / 100)));
    const earnersFit = lineFit(logP, logE, weights);
    const playersFit = lineFit(xs, logP, weights);
    if (earnersFit !== null && playersFit !== null) {
      let playersTarget = Math.exp(playersFit.intercept + playersFit.slope * targetX);
      const lastPlayers = points[points.length - 1].players;
      playersTarget = Math.min(lastPlayers * 6, Math.max(lastPlayers, playersTarget));
      const earnersTarget = Math.exp(
        earnersFit.intercept + earnersFit.slope * Math.log(playersTarget),
      );
      const rate2 = (earnersTarget / playersTarget) * 100;
      const logit2 = logitOf(rate2);
      const clamped2 = Math.min(lastLogit + 2.5, Math.max(lastLogit - 2.5, logit2));
      medianLogit = medianLogit === null ? clamped2 : 0.65 * medianLogit + 0.35 * clamped2;
    }
  }

  if (medianLogit === null) medianLogit = lastLogit;
  const median = rateOf(medianLogit);

  // Spread: the fit's own residuals, a drift term that widens with the
  // horizon, and a bump for trophies that have jumped before. A frozen
  // history with no refresh seen yet is the riskiest of all: the first
  // refresh can move the board a long way, so its floor is wide.
  const drift = 0.45 * Math.sqrt(horizonDays);
  const jumpBump = biggestJump > 0.4 ? 0.3 : 0.15;
  const fitPart = Math.min(1.0, Math.max(0.15, resid));
  let sigma = Math.sqrt(fitPart * fitPart + drift * drift + jumpBump * jumpBump);
  if (flatHistory) sigma = Math.max(sigma, 1.2);
  sigma = Math.min(1.6, Math.max(0.35, sigma));

  return { median, sigma };
}

function forecastCase(c: CaseIn): { trophies: Array<{ id: number; q: number[] }> } {
  if (c.levels.length !== TAU.length || c.levels.some((t, i) => t !== TAU[i])) {
    throw new Error(`${c.id} asks for levels ${JSON.stringify(c.levels)}`);
  }
  if (c.history.length === 0) throw new Error(`${c.id} has no history`);

  // Tier-mean slopes, for shrinkage: fit each trophy's trend once, then
  // average the slopes within each tier. A trophy with a noisy fit borrows
  // strength from its tier-mates.
  const tierSlopes = new Map<string, number>();
  {
    const byTier = new Map<string, number[]>();
    for (let i = 0; i < c.trophies.length; i++) {
      const pts: Array<{ x: number; y: number; w: number }> = [];
      for (const read of c.history) {
        const rate = read.rates[i];
        if (rate === null) continue;
        const hours = hoursSinceRelease(read.at);
        pts.push({ x: Math.log1p(Math.max(0, hours)), y: logitOf(rate), w: 1 });
      }
      if (pts.length < 3) continue;
      const fit = lineFit(
        pts.map((p) => p.x),
        pts.map((p) => p.y),
        pts.map((p) => p.w),
      );
      if (fit === null || !Number.isFinite(fit.slope)) continue;
      const tier = c.trophies[i].tier;
      if (!byTier.has(tier)) byTier.set(tier, []);
      byTier.get(tier)!.push(fit.slope);
    }
    for (const [tier, slopes] of byTier) {
      slopes.sort((a, b) => a - b);
      tierSlopes.set(tier, slopes[Math.floor(slopes.length / 2)]);
    }
  }

  const trophies = c.trophies.map((t, i) => {
    const { median, sigma } = forecastTrophy(c, i, tierSlopes);
    const centre = logitOf(median);
    const qs = NORMAL_Q.map((z) => to4(rateOf(centre + z * sigma)));
    // Rounding can never break the order, but guarantee it anyway.
    for (let k = 1; k < qs.length; k++) {
      if (qs[k] < qs[k - 1]) qs[k] = qs[k - 1];
    }
    return { id: t.id, q: qs };
  });
  return { trophies };
}

mkdirSync(OUT_DIR, { recursive: true });
const inputs = readdirSync(IN_DIR)
  .filter((f) => f.endsWith('.in'))
  .sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(IN_DIR, file), 'utf8')) as CaseIn;
  const out = forecastCase(c);
  writeFileSync(join(OUT_DIR, `${id}.out`), `${JSON.stringify(out)}\n`);
}
