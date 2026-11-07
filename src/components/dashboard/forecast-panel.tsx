import { useMemo, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { FORECAST_WINDOW, HORIZON, MEAN_TICK_S, fmtEta, forecastCascade, type CascadeForecast, type Regime } from './forecast'
import { LIQUIDATION_THRESHOLD, MARKET_LIST, MARKET_SHARE, type Market, type Metrics } from './use-incident-sim'

const VIOLET = '#a78bfa'
const SHOWN_HISTORY = 16

const REGIME: Record<Regime, { label: string; short: string; tone: string }> = {
  accelerating: { label: 'ACCELERATING', short: 'UP', tone: 'text-crit' },
  stable: { label: 'NO CLEAR TREND', short: 'FLAT', tone: 'text-warn' },
  decaying: { label: 'DECAYING', short: 'DOWN', tone: 'text-ok' },
}

/** History, threshold and the forecast cone on one linear axis */
function ForecastChart({ history, forecast, threshold }: { history: number[]; forecast: CascadeForecast; threshold: number }) {
  const W = 100
  const H = 40
  const shown = history.slice(-SHOWN_HISTORY)
  const total = shown.length + HORIZON
  // Cap the axis so a wide upper band can't flatten everything else
  const max = Math.max(...shown, threshold * 1.2, Math.min(Math.max(...forecast.projection.mid), threshold * 3)) * 1.05
  const x = (i: number) => (i / (total - 1)) * W
  const y = (v: number) => H - (Math.min(v, max) / max) * (H - 2) - 1
  const now = shown.length - 1
  const path = (vs: number[], from: number) => vs.map((v, i) => `${i ? 'L' : 'M'}${x(from + i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const last = shown[now]
  const band =
    `M${x(now)},${y(last)} ` +
    forecast.projection.high.map((v, i) => `L${x(now + 1 + i).toFixed(2)},${y(v).toFixed(2)}`).join(' ') +
    ' ' +
    [...forecast.projection.low].reverse().map((v, i) => `L${x(now + HORIZON - i).toFixed(2)},${y(v).toFixed(2)}`).join(' ') +
    ' Z'

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-20 w-full overflow-visible"
      role="img"
      aria-label={`Liquidation rate, last ${shown.length} ticks and a ${HORIZON}-tick forecast; projected ${Math.round(forecast.projection.mid[HORIZON - 1])} per minute`}
    >
      <rect x={x(now)} y={0} width={W - x(now)} height={H} fill={VIOLET} fillOpacity={0.05} />
      <path d={band} fill={VIOLET} fillOpacity={0.22} stroke="none" />
      <line x1={0} x2={W} y1={y(threshold)} y2={y(threshold)} stroke="var(--color-crit)" strokeOpacity={0.7} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      <line x1={x(now)} x2={x(now)} y1={0} y2={H} stroke="#fff" strokeOpacity={0.25} vectorEffect="non-scaling-stroke" />
      <path d={path(shown, 0)} fill="none" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <path d={path([last, ...forecast.projection.mid], now)} fill="none" stroke={VIOLET} strokeWidth={1.5} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 bg-black px-2.5 py-2">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="mt-0.5 font-mono text-[18px] leading-tight font-semibold text-white tabular-nums">{children}</div>
      {sub && <div className="mt-0.5 font-mono text-[10px] text-gray-500 tabular-nums">{sub}</div>}
    </div>
  )
}

/**
 * Predicts where the cascade is heading: growth per tick with a confidence
 * interval, time to the SEV-1 threshold, and which market will cross its share
 * of it first. See forecast.ts for the model.
 */
export function ForecastPanel({
  metrics,
  isPaused,
  isHalted,
}: {
  metrics: Metrics
  isPaused: Record<Market, boolean>
  isHalted: Record<Market, boolean>
}) {
  const total = useMemo(() => forecastCascade(metrics.liqHistory, LIQUIDATION_THRESHOLD), [metrics.liqHistory])
  const perMarket = useMemo(
    () =>
      MARKET_LIST.map((m) => ({
        m,
        f: forecastCascade(metrics.liqByMarket[m], LIQUIDATION_THRESHOLD * MARKET_SHARE[m]),
      })).sort((p, q) => (q.f?.growth ?? 0) - (p.f?.growth ?? 0)),
    [metrics.liqByMarket],
  )
  if (!total) return null

  const regime = REGIME[total.regime]
  const eta = total.breachInS
  const clear = total.clearInS
  const nextToBreach = perMarket
    .filter(({ m, f }) => f?.breachInS && !isPaused[m] && !isHalted[m])
    .sort((p, q) => p.f!.breachInS!.mid - q.f!.breachInS!.mid)[0]

  let headline: { label: string; value: string; sub: string; tone: string }
  if (metrics.critical) {
    headline = clear
      ? { label: 'Back under threshold in', value: fmtEta(clear.mid), sub: `95% CI ${fmtEta(clear.low)}–${fmtEta(clear.high)}`, tone: 'text-ok' }
      : { label: 'SEV-1 threshold', value: 'BREACHED', sub: 'not yet decaying: mitigate', tone: 'text-crit' }
  } else if (eta) {
    headline = {
      label: 'SEV-1 breach projected in',
      value: fmtEta(eta.mid),
      sub: `95% CI ${fmtEta(eta.low)}–${fmtEta(eta.high)}`,
      tone: eta.mid <= 30 ? 'text-crit' : 'text-warn',
    }
  } else {
    headline = { label: 'SEV-1 breach', value: 'NOT PROJECTED', sub: 'rate flat or falling', tone: 'text-ok' }
  }

  return (
    <section aria-labelledby="forecast-heading" className="rounded-sm border border-white/10 bg-black">
      <div className="flex h-7 items-center justify-between gap-2 border-b border-white/10 px-2.5 font-mono text-[11px]">
        <h2 id="forecast-heading" className="font-sans text-[12px] font-medium text-white">
          Cascade forecast
        </h2>
        <span className="hidden truncate text-[10px] text-gray-500 sm:inline">
          log-linear OLS · last {FORECAST_WINDOW} ticks · 95% CI (Student's t)
        </span>
        <span className={cn('shrink-0', regime.tone)}>■ {regime.label}</span>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-white/10 bg-white/10 md:grid-cols-4">
        <Stat label={headline.label} sub={headline.sub}>
          <span className={headline.tone}>{headline.value}</span>
        </Stat>
        <Stat
          label="Growth R per tick"
          sub={`95% CI ${total.growthLow.toFixed(2)}–${total.growthHigh.toFixed(2)}×`}
        >
          <span className={total.growth > 1 ? 'text-crit' : 'text-ok'}>{total.growth.toFixed(3)}×</span>
        </Stat>
        <Stat
          label={total.doublingS ? 'Doubling time' : total.halfLifeS ? 'Half-life' : 'Doubling time'}
          sub={`each liquidation → ${total.growth.toFixed(2)} next tick`}
        >
          {total.doublingS ? fmtEta(total.doublingS) : total.halfLifeS ? fmtEta(total.halfLifeS) : '—'}
        </Stat>
        <Stat label="1-step forecast error" sub={`R² ${total.r2.toFixed(2)} on the fit window`}>
          {total.backtestMape === null ? '—' : `${(total.backtestMape * 100).toFixed(1)}%`}
          <span className="ml-1 text-[10px] font-normal text-gray-500">MAPE</span>
        </Stat>
      </div>

      <div className="grid grid-cols-1 gap-2 p-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="mb-1 flex justify-between font-mono text-[10px] text-gray-500">
            <span>liq/min · last {SHOWN_HISTORY} ticks</span>
            <span style={{ color: VIOLET }}>
              +{Math.round(HORIZON * MEAN_TICK_S)}s → {Math.round(total.projection.mid[HORIZON - 1]).toLocaleString('en-US')}/min
            </span>
          </div>
          <ForecastChart history={metrics.liqHistory} forecast={total} threshold={LIQUIDATION_THRESHOLD} />
          <div className="mt-1 flex gap-3 font-mono text-[10px] text-gray-500">
            <span><span className="text-white">—</span> actual</span>
            <span style={{ color: VIOLET }}>┅ forecast + 95% band</span>
            <span className="text-crit">┅ SEV-1 {LIQUIDATION_THRESHOLD}/min</span>
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-1 flex justify-between font-mono text-[10px] text-gray-500">
            <span>per market, fastest first (limit = its share of {LIQUIDATION_THRESHOLD}/min)</span>
            {nextToBreach && (
              <span className="text-warn">next to breach: {nextToBreach.m.replace('-PERP', '')}</span>
            )}
          </div>
          <table className="w-full border-collapse font-mono text-[11px] tabular-nums">
            <thead>
              <tr className="text-left text-[10px] text-gray-500">
                <th scope="col" className="py-0.5 font-normal">Market</th>
                <th scope="col" className="py-0.5 text-right font-normal">R/tick</th>
                <th scope="col" className="py-0.5 text-right font-normal">Limit in</th>
                <th scope="col" className="py-0.5 text-right font-normal">Trend</th>
              </tr>
            </thead>
            <tbody>
              {perMarket.map(({ m, f }) => {
                const mitigated = isPaused[m] || isHalted[m]
                const r = f ? REGIME[f.regime] : null
                return (
                  <tr key={m} className="border-t border-white/5">
                    <th scope="row" className="py-0.5 text-left font-normal text-white">{m.replace('-PERP', '')}</th>
                    <td className={cn('py-0.5 text-right', f && f.growth > 1 ? 'text-crit' : 'text-ok')}>{f ? f.growth.toFixed(2) : '—'}</td>
                    <td className="py-0.5 text-right text-gray-300">
                      {mitigated ? <span className="text-[#06b6d4]">mitigated</span> : f?.breachInS ? fmtEta(f.breachInS.mid) : f && f.level >= LIQUIDATION_THRESHOLD * MARKET_SHARE[m] ? <span className="text-crit">over</span> : '—'}
                    </td>
                    <td className={cn('py-0.5 text-right text-[10px]', r?.tone)}>{r?.short}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
