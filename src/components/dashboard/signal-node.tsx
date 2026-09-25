import { useState } from 'react'
import { Headset, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  LIQUIDATION_THRESHOLD,
  MARKET_LIST,
  STALE_REF_SLIP,
  STALE_REF_VOLATILITY,
  US_STOCK_PERPS,
  formatMarketList,
  type Market,
  type Metrics,
} from './use-incident-sim'

const intFmt = (v: number) => Math.round(v).toLocaleString('en-US')
const priceFmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function Sparkline({
  values,
  threshold,
  critical,
  label,
  format = (v) => v.toLocaleString('en-US'),
}: {
  values: number[]
  threshold?: number
  critical: boolean
  label: string
  format?: (v: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...values, (threshold ?? 0) * 1.15, 1)
  const W = 100
  const H = 28
  const x = (i: number) => (i / (values.length - 1)) * W
  const y = (v: number) => H - (v / max) * (H - 2) - 1
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const stroke = critical ? 'var(--color-crit)' : '#fff'
  const last = values.length - 1
  const shown = hover ?? last

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-8 w-full overflow-visible"
        role="img"
        aria-label={`${label}, last ${values.length} readings, latest ${values[last]}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setHover(Math.round(((e.clientX - r.left) / r.width) * last))
        }}
        onPointerLeave={() => setHover(null)}
      >
        {threshold !== undefined && (
          <line
            x1={0}
            x2={W}
            y1={y(threshold)}
            y2={y(threshold)}
            stroke="var(--color-crit)"
            strokeOpacity={0.7}
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="miter" />
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="#fff" strokeOpacity={0.35} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {/* Square end marker, kept in HTML so the stretched viewBox doesn't distort it */}
      <span
        className="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${(x(shown) / W) * 100}%`, top: `${(y(values[shown]) / H) * 100}%`, background: stroke }}
      />
      <div className="mt-2 flex justify-between font-mono text-[10px] text-gray-500">
        <span>{hover === null ? `${values.length} ticks` : `t-${last - hover}`}</span>
        <span className="text-white">{format(values[shown])}</span>
      </div>
    </div>
  )
}

function MetricCell({
  icon: Icon,
  label,
  unit,
  value,
  delta,
  history,
  threshold,
  critical,
}: {
  icon: typeof Zap
  label: string
  unit: string
  value: number
  delta: number
  history: number[]
  threshold?: number
  critical: boolean
}) {
  return (
    <div
      className={cn(
        'w-full rounded-sm border bg-black px-2.5 py-2 md:max-w-[280px]',
        critical ? 'border-crit' : 'border-white/10',
      )}
    >
      <div className="flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1.5 text-gray-400">
          <Icon className={cn('size-3', critical ? 'text-crit' : 'text-gray-500')} aria-hidden />
          {label}
        </span>
        <span className="font-mono text-gray-500">{unit}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2 font-mono tabular-nums">
        <span className={cn('text-[28px] leading-none font-medium tracking-tight', critical ? 'text-crit' : 'text-white')}>
          {intFmt(value)}
        </span>
        <span className={cn('text-[11px]', delta > 0 ? 'text-crit' : delta < 0 ? 'text-ok' : 'text-gray-500')}>
          {delta > 0 ? '+' : delta < 0 ? '−' : '±'}
          {Math.abs(delta).toLocaleString('en-US')}
        </span>
      </div>
      <div className="mt-2">
        <Sparkline values={history} threshold={threshold} critical={critical} label={label} />
      </div>
    </div>
  )
}

function Connector({ critical }: { critical: boolean }) {
  const color = critical ? 'text-crit' : 'text-white/70'
  return (
    <>
      <div className={cn('relative hidden h-px min-w-6 flex-1 md:block', critical ? 'bg-crit/50' : 'bg-white/15')} aria-hidden>
        <span className={cn('packet', color, critical && '[animation-duration:0.6s]')} />
      </div>
      <div className={cn('relative h-5 w-px md:hidden', critical ? 'bg-crit/50' : 'bg-white/15')} aria-hidden>
        <span className={cn('packet-v', color, critical && '[animation-duration:0.6s]')} />
      </div>
    </>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'crit' | 'ok' | 'warn' }) {
  return (
    <div className="min-w-0 px-2.5 py-1.5">
      <dt className="truncate text-[11px] text-gray-500">{label}</dt>
      <dd
        className={cn(
          'font-mono text-[12px] tabular-nums',
          tone === 'crit' ? 'text-crit' : tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-white',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

export function SignalNode({
  metrics,
  isPaused,
  isHalted,
}: {
  metrics: Metrics
  isPaused: Record<Market, boolean>
  isHalted: Record<Market, boolean>
}) {
  // Every figure below comes straight from the committed snapshot; nothing is recomputed here
  const { critical, drawdown, load, ticketDelta } = metrics
  // A halted market also stops liquidating, so it counts as stopped for the engine
  const stoppedCount = MARKET_LIST.filter((m) => isPaused[m] || isHalted[m]).length
  const haltedCount = MARKET_LIST.filter((m) => isHalted[m]).length
  const total = MARKET_LIST.length

  return (
    <section
      aria-label="Live meltdown signals"
      className={cn('flex flex-col rounded-sm border bg-panel', critical ? 'border-crit' : 'border-white/10')}
    >
      <header
        className={cn(
          'flex h-7 items-center justify-between border-b px-2.5 text-[11px]',
          critical ? 'border-crit bg-crit-fill text-white' : 'border-white/10 text-gray-400',
        )}
      >
        <span className="font-medium">Meltdown signals</span>
        <span className="font-mono">
          {critical ? `SEV-1  liq ${intFmt(metrics.liquidations)}/min > ${LIQUIDATION_THRESHOLD}` : `threshold ${LIQUIDATION_THRESHOLD}/min`}
        </span>
      </header>

      <div className="flex flex-1 items-center">
        <div className="relative flex w-full flex-col items-center px-3 py-5 md:flex-row md:justify-center md:px-4 md:py-8">
          <MetricCell
            icon={Zap}
            label="Liquidations"
            unit="/min"
            value={metrics.liquidations}
            delta={metrics.liqDelta}
            history={metrics.liqHistory}
            threshold={LIQUIDATION_THRESHOLD}
            critical={critical}
          />
          <Connector critical={critical} />

          {/* Core */}
          <div className={cn('relative shrink-0 rounded-sm border bg-black px-4 py-3 text-center', critical ? 'border-crit' : 'border-white/20')}>
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-gray-400">
              <span className={cn('size-1.5', critical ? 'bg-crit' : 'bg-ok')} aria-hidden />
              BTC-PERP mark
            </div>
            <div className="mt-1 font-mono text-[20px] font-medium text-white tabular-nums">
              {priceFmt(metrics.prices['BTC-PERP'])}
            </div>
            <div className={cn('font-mono text-[11px] tabular-nums', drawdown < 0 ? 'text-crit' : 'text-ok')}>
              {drawdown >= 0 ? '+' : ''}
              {(drawdown * 100).toFixed(2)}% 24h
            </div>
          </div>

          <Connector critical={critical} />
          <MetricCell
            icon={Headset}
            label="Support tickets"
            unit="open"
            value={metrics.tickets}
            delta={metrics.ticketDelta}
            history={metrics.ticketHistory}
            critical={false}
          />
        </div>
      </div>

      {metrics.usEquityClosed && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-warn/50 bg-warn/[0.06] px-2.5 py-1.5">
          <span className="rounded-sm bg-warn px-1.5 py-0.5 font-mono text-[11px] font-bold text-black">
            US EQUITY MARKETS: CLOSED (OFF-HOURS)
          </span>
          <span className="font-mono text-[11px] text-warn">
            {formatMarketList(US_STOCK_PERPS)} on stale reference price
            <span className="mx-1.5 text-warn/50">|</span>
            volatility ×{STALE_REF_VOLATILITY}
            <span className="mx-1.5 text-warn/50">|</span>
            slip ×{STALE_REF_SLIP}
          </span>
        </div>
      )}

      <dl className="grid grid-cols-3 border-t border-white/10 md:grid-cols-6 [&>*]:border-white/10 [&>*:not(:nth-child(3n+1))]:border-l [&>*:nth-child(n+4)]:border-t md:[&>*:nth-child(n+4)]:border-t-0 md:[&>*:nth-child(4)]:border-l">
        <Stat label="Threshold load" value={`${Math.round(load * 100)}%`} tone={load >= 1 ? 'crit' : load >= 0.8 ? 'warn' : undefined} />
        <Stat label="Peak liq/min" value={intFmt(metrics.peakLiquidations)} />
        <Stat label="Avg liq/min" value={intFmt(metrics.avgLiquidations)} />
        <Stat label="Tickets Δ/tick" value={`${ticketDelta >= 0 ? '+' : '−'}${Math.abs(ticketDelta)}`} tone={ticketDelta > 40 ? 'warn' : undefined} />
        <Stat
          label="Liq engine"
          value={stoppedCount === 0 ? 'RUNNING' : stoppedCount === total ? 'PAUSED' : `${total - stoppedCount}/${total} RUNNING`}
          tone={stoppedCount === 0 ? 'crit' : stoppedCount === total ? 'ok' : 'warn'}
        />
        <Stat
          label="Order entry"
          value={haltedCount === 0 ? 'OPEN' : haltedCount === total ? 'HALTED' : `${haltedCount}/${total} HALTED`}
          tone={haltedCount === 0 ? undefined : 'warn'}
        />
      </dl>
    </section>
  )
}
