/**
 * Cascade forecaster. Predicts where the liquidation rate is heading, using
 * nothing but the recent history the dashboard already has.
 *
 * Model: a cascade compounds, so ln(L) is linear in time. An ordinary least
 * squares fit of ln(L_t) = a + b·t over the last FORECAST_WINDOW ticks gives:
 *   R = e^b             growth per tick (the cascade's reproduction ratio:
 *                       each liquidation "spawns" R in the next tick; R > 1 is
 *                       self-sustaining, R < 1 dies out)
 *   doubling = ln2 / b  (b > 0)   half-life = ln2 / -b  (b < 0)
 *   breach   = (ln T - ln L̂_now) / b   ticks until the fitted rate hits T
 * Confidence bands use the slope's standard error and Student's t (small n).
 * The model is back-tested on the same series: each of the last BACKTEST_TICKS
 * readings is predicted one step ahead from the window before it, and the
 * mean absolute percentage error (MAPE) is reported so its accuracy is visible.
 */

export const FORECAST_WINDOW = 8
/** Simulation ticks land every 2–3 s */
export const MEAN_TICK_S = 2.5
/** Ticks projected forward in the forecast cone */
export const HORIZON = 6
const BACKTEST_TICKS = 8

export interface GrowthFit {
  /** ln-rate intercept at x = 0 */
  a: number
  /** ln-rate slope per tick */
  b: number
  /** standard error of b */
  se: number
  /** residual standard deviation, in ln units */
  s: number
  r2: number
  n: number
}

/** Two-sided 95% Student's t critical values by degrees of freedom */
const T95 = [Infinity, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131]
export const tCrit95 = (df: number) => (df < 1 ? Infinity : (T95[df] ?? 1.96))

/** OLS fit of ln(value) against tick index. Zeros are floored to 1 so ln stays finite. */
export function fitLogLinear(values: readonly number[]): GrowthFit | null {
  const n = values.length
  if (n < 3) return null
  const ys = values.map((v) => Math.log(Math.max(v, 1)))
  const xMean = (n - 1) / 2
  const yMean = ys.reduce((acc, y) => acc + y, 0) / n
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxx += (i - xMean) ** 2
    sxy += (i - xMean) * (ys[i] - yMean)
    syy += (ys[i] - yMean) ** 2
  }
  const b = sxy / sxx
  const a = yMean - b * xMean
  const sse = ys.reduce((acc, y, i) => acc + (y - (a + b * i)) ** 2, 0)
  const s = Math.sqrt(sse / (n - 2))
  return { a, b, se: s / Math.sqrt(sxx), s, r2: syy === 0 ? 1 : 1 - sse / syy, n }
}

export type Regime = 'accelerating' | 'stable' | 'decaying'

export interface Interval {
  mid: number
  low: number
  /** Infinity when the slow end of the interval never reaches the target */
  high: number
}

export interface CascadeForecast {
  /** R: growth per tick, with its 95% interval */
  growth: number
  growthLow: number
  growthHigh: number
  regime: Regime
  /** Seconds for the rate to double (accelerating) or halve (decaying); null if flat */
  doublingS: number | null
  halfLifeS: number | null
  /** Fitted current rate (less noisy than the last reading) */
  level: number
  /** Seconds until the fitted rate reaches the threshold; null if already above or not growing */
  breachInS: Interval | null
  /** Seconds until the rate falls back under the threshold; null unless above and decaying */
  clearInS: Interval | null
  /** Next HORIZON ticks: central projection and 95% band */
  projection: { mid: number[]; low: number[]; high: number[] }
  r2: number
  /** One-step-ahead mean absolute percentage error over recent ticks; null if too little history */
  backtestMape: number | null
}

/** Seconds until ln-level `from` reaches ln-level `to` at slope b (ticks → s); Infinity if it never does */
const secondsTo = (from: number, to: number, b: number) => {
  const ticks = (to - from) / b
  return ticks >= 0 && Number.isFinite(ticks) ? ticks * MEAN_TICK_S : Infinity
}

/** One-step-ahead back-test: fit each window, predict the next reading, compare */
export function backtest(history: readonly number[], window = FORECAST_WINDOW, ticks = BACKTEST_TICKS) {
  const errors: number[] = []
  for (let i = Math.max(window, history.length - ticks); i < history.length; i++) {
    const fit = fitLogLinear(history.slice(i - window, i))
    const actual = history[i]
    if (!fit || actual <= 0) continue
    errors.push(Math.abs(Math.exp(fit.a + fit.b * window) - actual) / actual)
  }
  return errors.length ? errors.reduce((acc, e) => acc + e, 0) / errors.length : null
}

export function forecastCascade(history: readonly number[], threshold: number, window = FORECAST_WINDOW): CascadeForecast | null {
  const recent = history.slice(-window)
  const fit = fitLogLinear(recent)
  if (!fit) return null
  const { a, b, se, s, r2, n } = fit
  const t = tCrit95(n - 2)
  const bLow = b - t * se
  const bHigh = b + t * se
  const lnLevel = a + b * (n - 1)
  const lnT = Math.log(threshold)
  const above = lnLevel >= lnT

  const regime: Regime = bLow > 0 ? 'accelerating' : bHigh < 0 ? 'decaying' : 'stable'

  let breachInS: Interval | null = null
  if (!above && b > 0) {
    // A steeper slope reaches the threshold sooner
    breachInS = {
      mid: secondsTo(lnLevel, lnT, b),
      low: secondsTo(lnLevel, lnT, bHigh),
      high: bLow > 0 ? secondsTo(lnLevel, lnT, bLow) : Infinity,
    }
  }
  let clearInS: Interval | null = null
  if (above && b < 0) {
    clearInS = {
      mid: secondsTo(lnLevel, lnT, b),
      low: secondsTo(lnLevel, lnT, bLow),
      high: bHigh < 0 ? secondsTo(lnLevel, lnT, bHigh) : Infinity,
    }
  }

  const ks = Array.from({ length: HORIZON }, (_, i) => i + 1)
  return {
    growth: Math.exp(b),
    growthLow: Math.exp(bLow),
    growthHigh: Math.exp(bHigh),
    regime,
    doublingS: b > 0.005 ? (Math.LN2 / b) * MEAN_TICK_S : null,
    halfLifeS: b < -0.005 ? (Math.LN2 / -b) * MEAN_TICK_S : null,
    level: Math.exp(lnLevel),
    breachInS,
    clearInS,
    projection: {
      mid: ks.map((k) => Math.exp(lnLevel + b * k)),
      // Parameter uncertainty widens with k; residual noise is a fixed band
      low: ks.map((k) => Math.exp(lnLevel + bLow * k - t * s)),
      high: ks.map((k) => Math.exp(lnLevel + bHigh * k + t * s)),
    },
    r2,
    backtestMape: backtest(history, window),
  }
}

/** "14s", "2m 05s", "—" for no finite value */
export const fmtEta = (s: number) => {
  if (!Number.isFinite(s)) return '—'
  const r = Math.max(0, Math.round(s))
  return r < 60 ? `${r}s` : `${Math.floor(r / 60)}m ${String(r % 60).padStart(2, '0')}s`
}
