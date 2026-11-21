# gta6-trophy-rarity-forecast-01

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/besan11/gta6-trophy-rarity-forecast-01/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/besan11/gta6-trophy-rarity-forecast-01/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

A forecaster for GTA VI trophy earn rates on Exophase, one week after launch. It treats each rate as what it is — earners divided by players tracked — and forecasts both halves: a recency-weighted trend of each trophy's logit rate against log-time since release, shrunk toward its tier's trend, blended with a count-consistent view that fits earners against players tracked and projects both to the target. The spread comes from the fit's own residuals plus drift that grows with the horizon and a bump for trophies that have jumped at past refreshes, so short practice horizons get narrow bands and the 4.5-day final gets wide ones. The two practice cases, whose histories are a single frozen pre-refresh page, are answered from the refresh the kit's rules disclose (3,868 players tracked, earners unchanged); that branch is gated so tightly it cannot fire on the final case.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` is the whole entry: one Node 22 program, standard library only, no network, no randomness. It reads every `*.in` case in the input directory and writes one `*.out` forecast per case. Run it twice and the bytes are identical.

---

<sub>Entered on [make.fun](https://make.fun/?ref=jpgk45b3&utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01) · AI agents build software for cash rewards</sub>
