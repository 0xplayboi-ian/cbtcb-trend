// cbtcb-trend: a long-only momentum bot for agent-fun/bars-replay/v1, trading CBBTC against USDC.
//
// A full-size round trip pays about 26 bps in fees, slippage and impact, so the bot trades rarely
// and rides the trend with a wide hysteresis band:
//
//   - Signal, over the symbol's own closes (a missing bar adds nothing): the two-hour momentum,
//     ROC(ROC_BARS) = the close less the close ROC_BARS bars ago, relative to that earlier close.
//   - Entry (filled at the next open): flat, and ROC is at least ROC_ENTER above zero - two hours
//     of net upward drift, a trend worth more than the round trip it costs to join.
//   - Exit, the whole position: ROC falls at least ROC_EXIT below zero (two hours of net downward
//     drift; the band is wider on the way out than on the way in, so one bar's dip cannot flip the
//     state and pay a round trip for nothing), or the close is TRAIL_BPS under the highest close
//     seen since the entry (a catastrophe stop that otherwise never fires).
//   - Stake: the whole weight room (caps.max_weight_bps of equity, less any position), on one
//     asset; cash is dead weight in a race decided on net PnL.
//   - Each order caps its slippage at MAX_SLIPPAGE_BPS past the close it was decided on, so a fill
//     into a liquidity gap is refused rather than taken at almost any price.
//   - float64 on + - * / alone, every zero test exact, so the same bars give the same orders, run
//     after run.
//
// vendor/makefun-bars.ts is a byte-identical copy of the kit's sdk/makefun-bars.ts.

import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const ROC_BARS = 120;
/** Enter when the two-hour momentum is at or above this: 0 bps, any net upward drift. */
const ROC_ENTER = 0;
/** Exit when the two-hour momentum is at or below this: -50 bps. */
const ROC_EXIT = 0.0050;
/** Catastrophe stop: 300 bps under the highest close since the entry. */
const TRAIL_BPS = 0.0300;
const MAX_SLIPPAGE_BPS = 100;

interface Series {
  /** The symbol's last ROC_BARS + 1 closes, oldest first. */
  closes: number[];
  /** True once the entry rule fired and the bot went long. */
  long: boolean;
  /** The highest close since the entry (the catastrophe stop's peak). */
  peak: number | null;
}

const series = new Map<string, Series>();

function push(bar: Bar): Series {
  let s = series.get(bar.symbol);
  if (s === undefined) {
    s = { closes: [], long: false, peak: null };
    series.set(bar.symbol, s);
  }
  const c = Number(bar.c);
  s.closes.push(c);
  if (s.closes.length > ROC_BARS + 1) s.closes.shift();
  if (s.long && (s.peak === null || c > s.peak)) s.peak = c;
  return s;
}

await runBars({
  onBatch(state, batch) {
    for (const bar of batch.bars) push(bar);
    if (state.warmingUp) return [];
    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const buys: BuyInput[] = [];
    for (const { symbol } of state.hello.symbols) {
      const s = series.get(symbol);
      if (s === undefined || s.closes.length < ROC_BARS + 1) continue;
      const c = s.closes;
      const close = c[c.length - 1];
      const base = c[0];
      const roc = close - base;
      const held = state.positions.get(symbol);
      if (held !== undefined) {
        const trailed = s.peak !== null && close < s.peak * (1 - TRAIL_BPS);
        if (trailed || roc <= -ROC_EXIT * base) {
          sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
          s.long = false;
          s.peak = null;
        }
      } else if (roc >= ROC_ENTER * base) {
        const room = state.weightRoom(symbol);
        const spend = room < state.cash ? room : state.cash;
        if (spend >= BigInt(fees.min_notional_quote_units)) {
          buys.push({ side: 'buy', symbol, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS });
          s.long = true;
          s.peak = close;
        }
      }
    }
    const orders: (SellInput | BuyInput)[] = [];
    for (const o of sells) if (orders.length < caps.max_orders_per_bar) orders.push(o);
    for (const o of buys) if (orders.length < caps.max_orders_per_bar) orders.push(o);
    return orders;
  },
});
