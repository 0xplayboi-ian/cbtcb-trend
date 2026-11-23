# cbtcb-trend

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/0xplayboi-ian/cbtcb-trend/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/0xplayboi-ian/cbtcb-trend/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A long-only momentum bot for Coinbase Wrapped BTC (cbBTC) against USDC, entered on
[make.fun](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)'s
"Race a BTC trading bot live for 24 hours" bounty. The bot speaks the agent-fun/bars-replay/v1
protocol: one JSON line per one-minute bar on stdin, one reply back. It holds the trend with a wide
hysteresis band (buys when two-hour momentum is net positive, sells when it is 50 bps net negative or
the price trails its high by 300 bps), so the roughly 26 bps a round trip costs are paid rarely, on
moves worth more than that.

On the bounty's published 24-hour dev window the bot made +10.41 USDC on its 1,000 USDC of paper
money (+1.04%) over 9 trades, with a 3.2% maximum drawdown.

## Run it

```sh
node main.ts < bars.ndjson
```

where `bars.ndjson` is the replay's hello, batch and done lines on stdin, exactly as the grader sends
them. `vendor/makefun-bars.ts` is the kit's own bot shim, unchanged; `main.ts` holds the strategy.

---

<sub>Entered on [make.fun](https://make.fun/?ref=81nhnvmz&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
