// cbtcb-trend: a long-only trend bot for agent-fun/bars-replay/v1.
//
// Idea: cbBTC/USDC grinds in trends and chops in between, and a round trip costs about
// 26 bps in fees, slippage and impact, so the bot trades rarely and holds the trend:
//
//   - Indicators, over the symbol's own closes (a missing bar adds nothing): EMA(FAST) and
//     EMA(SLOW), each seeded as the mean of its first span of closes, then moving
//     2 / (span + 1) of the way to each close.
//   - Entry (filled at the next open): flat, and the close is above EMA(SLOW) by ENTER_MARGIN,
//     and EMA(FAST) is above EMA(SLOW) - a trend worth more than the round trip.
//   - Exit, the whole position: the close falls back to or below EMA(SLOW) by EXIT_MARGIN,
//     or the close is TRAIL_BPS under the highest close seen since the entry (a trailing stop
//     that hands back little of a run), whichever comes first.
//   - Hysteresis: the exit margin is wider than the entry margin, so one bar's noise cannot
//     flip the state and pay a round trip for nothing.
//   - Stake: the whole weight room (caps.max_weight_bps of equity, less any position), on one
//     asset; cash is dead weight in a race decided on net PnL.
//   - Each order caps its slippage at MAX_SLIPPAGE_BPS past the close it was decided on, so a
//     fill into a liquidity gap is refused rather than taken at almost any price.
//   - float64 on + - * / alone, every zero test exact, so the same bars give the same orders,
//     run after run.
//
// vendor/makefun-bars.ts is a byte-identical copy of the kit's sdk/makefun-bars.ts.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const FAST_BARS = 20;
const SLOW_BARS = 90;
/** Enter when the close is this far above EMA(SLOW): 15 bps. */
const ENTER_MARGIN = 0.0015;
/** Exit when the close is at or below EMA(SLOW) less this: 10 bps. */
const EXIT_MARGIN = 0.0010;
/** Trailing stop: 60 bps under the highest close since the entry. */
const TRAIL_BPS = 0.0060;
const MAX_SLIPPAGE_BPS = 100;

/** One EMA: the closes it sees until it starts, then its value. */
interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

interface Series {
  fast: Ema;
  slow: Ema;
  /** True once the entry rule fired and the bot went long. */
  long: boolean;
  /** The highest close since the entry (the trailing stop's peak). */
  peak: number | null;
}

const series = new Map<string, Series>();

function step(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
}

function push(bar: Bar): Series {
  let s = series.get(bar.symbol);
  if (s === undefined) {
    s = { fast: { span: FAST_BARS, warm: [], value: null }, slow: { span: SLOW_BARS, warm: [], value: null }, long: false, peak: null };
    series.set(bar.symbol, s);
  }
  const c = Number(bar.c);
  step(s.fast, c);
  step(s.slow, c);
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
      if (s === undefined || s.slow.value === null || s.fast.value === null) continue;
      const bar = state.latest.get(symbol);
      if (bar === undefined) continue;
      const close = Number(bar.c);
      const held = state.positions.get(symbol);
      const floor = s.slow.value * (1 - EXIT_MARGIN);
      if (held !== undefined) {
        const trailed = s.peak !== null && close < s.peak * (1 - TRAIL_BPS);
        if (close <= floor || trailed) {
          sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
          s.long = false;
          s.peak = null;
        }
      } else if (!s.long) {
        const ceiling = s.slow.value * (1 + ENTER_MARGIN);
        if (close > ceiling && s.fast.value > s.slow.value) {
          const room = state.weightRoom(symbol);
          const spend = room < state.cash ? room : state.cash;
          if (spend >= BigInt(fees.min_notional_quote_units)) {
            buys.push({ side: 'buy', symbol, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS });
            s.long = true;
          }
        }
      }
    }
    const orders: (SellInput | BuyInput)[] = [];
    for (const o of sells) if (orders.length < caps.max_orders_per_bar) orders.push(o);
    for (const o of buys) if (orders.length < caps.max_orders_per_bar) orders.push(o);
    return orders;
  },
});
