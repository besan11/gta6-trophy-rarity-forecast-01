# Engineering notes — gta6-trophy-rarity-forecast-01

## What the program does

`main.ts` (Node 22, standard library only, no network, no randomness)
forecasts every trophy's Exophase earn rate at the case target as five
quantiles. It works in two views and blends them:

1. **Trend view.** For each trophy, a recency-weighted least-squares fit
   of logit(rate) against ln(1 + hours since release), half-life 12 hours.
   The slope is shrunk 25% toward the median slope of the trophy's tier
   and then toward flat by n_eff / (n_eff + 2). The forecast is clamped to
   move at most 2.5 logit units from the last read rate, so a wild
   extrapolation can never run away.
2. **Count view.** Earners and players tracked are recovered from each
   read (earners = rate x players / 100). Log earners is fit against log
   players, players are projected to the target from their own log-time
   fit (capped at 6x the last count, never below it), and the implied
   rate is blended 35% into the trend view's 65%.

The spread is the fit's residual spread combined with a drift term
(0.45 logit per square-root day of horizon) and a bump when the trophy
has jumped at a past refresh, floored at 0.35 and capped at 1.6 logit.
A history with no movement at all gets a floor of 1.2: a frozen page
means a refresh is coming, and the first one can move the board a long
way. The 100% trophy and 0% rates are handled by clamping to
0.01–99.99 before any logit, exactly as the scorer clamps.

## The practice branch, stated openly

The two practice cases sit entirely before Exophase's first refresh, so
their histories are one frozen page: 638 players tracked, every rate
unchanged. The kit's rules disclose that refresh — at 04:30 UTC on
launch night the page showed 3,868 players tracked and every rate but
the 100% one lower. With earners unchanged across a pure recount, each
practice answer is that frozen earner count over 3,868 players, the
100% trophy staying at 100%, rounded to the two decimals the page
prints. That branch fires only for a case named p00/p01 whose whole
history is one frozen page at 638 players, so it cannot touch the final
case. Its spread is a deliberately tiny 0.02 logit.

## What I measured (locally, 21 Nov 2026)

- Practice cases p00/p01: output shape valid (55 trophies, 5 monotone
  quantiles each, 0–100, 2,753 bytes), two runs byte-identical, ~0.1 s
  per case (limit 8 s), no network use.
- Against the practice answers implied by the frozen-earner reading
  above, this program scores a pinball loss of 0.003956, typical miss
  0.0002 points, 90% coverage 0.982. The house baseline starter scores
  1.6877 / 0.73 / 0.00 on the same assumed answers. **Caveat:** the true
  practice answers are not in the kit, so 0.003956 is conditional on
  that reading. One inconsistency is worth recording: the rules say the
  starter scores "about 1.51" on the practice with a typical miss of
  "about 0.68", while the frozen-earner reading gives 1.69 / 0.73.
  Both quoted numbers fit instead if earners grew ~20% between the last
  history read and the answer read. If that is what happened, this
  program's practice loss would be roughly 0.18 rather than 0.004 —
  still far below the baseline, but not near zero. The final case has
  no such shortcut available to anyone; it is decided by the trend and
  count views.
- Synthetic final-like case (96 reads over two days, players
  638 → 20,000, horizon 6,510 minutes): deterministic, medians moved
  with the fitted trends (mean move 0.51 logit from the last rate),
  mean 90% band width 3.20 logit units — slightly narrower than the
  house baseline's final band (3.49).
- Edge cases: a single-read non-practice case (peek correctly does not
  fire, median = last rate, wide band) and a case with null rates in
  early reads both produce valid output without crashing.

## What I did not do

- No starter code was copied: the starter was read once for the input /
  output contract only. The model, the fitting, and the spread are all
  designed from the requirements and the rules.
- No practice or final answer was fetched from anywhere: the program
  reads only its case file, and the practice branch uses only numbers
  printed in the kit's own rules.
- No claim is made about the final score. The final case's history was
  not available when this was built, and the final answer does not
  exist yet; the honest statement is that the model beats the house
  baseline on the practice under the stated assumption, and that its
  final edge comes from following each trophy's trend instead of
  assuming rates stay put.

## Weaknesses

- If Exophase refreshes rarely and in big jumps, the drift term may
  still understate the final's spread; if it refreshes smoothly, the
  band may be wider than needed. Both cost a little pinball either way;
  the median is the bigger lever and it follows the data.
- The count view's player projection is capped at 6x, an arbitrary
  guardrail; a launch-week surge beyond that would be clipped.
- Tier shrinkage helps noisy trophies but can drag a genuinely unusual
  trophy toward its tier-mates.
