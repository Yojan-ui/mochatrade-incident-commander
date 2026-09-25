import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Sparkline } from './signal-node'
import {
  ESCALATION_LIQ_VOLUME_USD,
  ESCALATION_TICKET_VELOCITY,
  MARKET_LIST,
  usd,
  type Metrics,
} from './use-incident-sim'

const GREEN = 'text-[#22c55e]'
const RED = 'text-crit'

/** Filled share of the trigger, with a hard tick at 100%; the bar runs to 150% so overshoot stays visible */
function TriggerBar({ value, threshold, label }: { value: number; threshold: number; label: string }) {
  const ratio = value / threshold
  const over = ratio >= 1
  const fill = Math.min(ratio / 1.5, 1) * 100
  return (
    <div>
      <div className="relative h-2 border border-white/20 bg-black" role="meter" aria-label={label} aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={150}>
        <div className={cn('absolute inset-y-0 left-0', over ? 'bg-crit' : 'bg-[#22c55e]')} style={{ width: `${fill}%` }} />
        {/* the trigger line */}
        <div className="absolute -inset-y-1 left-2/3 w-px bg-white" aria-hidden />
      </div>
      <div className="relative mt-1 h-3.5 font-mono text-[10px] text-gray-500 tabular-nums">
        <span>
          <span className={over ? RED : GREEN}>{Math.round(ratio * 100)}%</span> of trigger
        </span>
        {/* Pinned under the trigger line at 100% (two thirds of the 150% bar) */}
        <span className="absolute top-0 left-2/3 -translate-x-1/2" aria-hidden>
          ▲
        </span>
      </div>
    </div>
  )
}

function Feed({
  title,
  unit,
  value,
  delta,
  history,
  threshold,
  tripped,
  format,
  triggerLabel,
  children,
}: {
  title: string
  unit: string
  value: string
  delta: number
  history: number[]
  threshold: number
  tripped: boolean
  format: (v: number) => string
  triggerLabel: string
  children?: ReactNode
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2 p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[12px] font-medium text-gray-300">{title}</h3>
        <span className="font-mono text-[10px] whitespace-nowrap text-gray-500">trigger {triggerLabel}</span>
      </div>
      <div className="flex items-baseline justify-between gap-3 font-mono tabular-nums">
        <span className={cn('text-[30px] leading-none font-semibold tracking-tight', tripped ? RED : GREEN)}>
          {value}
          <span className="ml-1.5 text-[11px] font-normal text-gray-500">{unit}</span>
        </span>
        <span className={cn('text-[11px]', delta > 0 ? RED : delta < 0 ? GREEN : 'text-gray-500')}>
          {delta > 0 ? '+' : delta < 0 ? '−' : '±'}
          {format(Math.abs(delta))}
        </span>
      </div>
      <TriggerBar value={history[history.length - 1]} threshold={threshold} label={`${title}, share of escalation trigger`} />
      <Sparkline values={history} threshold={threshold} critical={tripped} label={title} format={format} />
      {children}
    </section>
  )
}

/**
 * Two feeds that decide escalation, and one banner that says so. Built to cut
 * noise: each feed is one number, its distance to the trigger, and its trend.
 */
export function LiveSignalsPanel({ metrics }: { metrics: Metrics }) {
  const { escalation, liqVolumeHistory, ticketVelocityHistory, liqVolumeByMarket } = metrics
  const volDelta = metrics.liqVolumeUsd - (liqVolumeHistory[liqVolumeHistory.length - 2] ?? metrics.liqVolumeUsd)
  const tktDelta = metrics.ticketVelocity - (ticketVelocityHistory[ticketVelocityHistory.length - 2] ?? metrics.ticketVelocity)
  const reasons = [
    escalation.volume && `LIQ VOLUME ${usd(metrics.liqVolumeUsd)}/MIN ≥ ${usd(ESCALATION_LIQ_VOLUME_USD)}`,
    escalation.tickets && `TICKETS ${metrics.ticketVelocity}/MIN ≥ ${ESCALATION_TICKET_VELOCITY}`,
  ].filter(Boolean)
  const topMarkets = [...MARKET_LIST].sort((a, b) => liqVolumeByMarket[b] - liqVolumeByMarket[a])

  return (
    <section aria-labelledby="live-signals-heading" className={cn('rounded-sm border bg-black', escalation.active ? 'border-crit' : 'border-white/10')}>
      {escalation.active ? (
        <div role="alert" className="escalation-blink flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-crit bg-crit-fill px-2.5 py-1.5 font-mono text-white">
          <span className="text-[13px] font-bold tracking-wide">■ SEV-1 ESCALATION</span>
          <span className="text-[11px] font-semibold">{reasons.join('  |  ')}</span>
        </div>
      ) : (
        <div className="flex h-7 items-center justify-between border-b border-white/10 px-2.5 font-mono text-[11px]">
          <h2 id="live-signals-heading" className="font-sans text-[12px] font-medium text-white">
            Live signals
          </h2>
          <span className={GREEN}>■ below escalation triggers</span>
        </div>
      )}
      {escalation.active && (
        <h2 id="live-signals-heading" className="sr-only">
          Live signals
        </h2>
      )}

      <div className="grid grid-cols-1 divide-y divide-white/10 md:grid-cols-2 md:divide-x md:divide-y-0">
        <Feed
          title="Liquidation Volume (USD)"
          unit="/min"
          value={usd(metrics.liqVolumeUsd)}
          delta={volDelta}
          history={liqVolumeHistory}
          threshold={ESCALATION_LIQ_VOLUME_USD}
          tripped={escalation.volume}
          format={usd}
          triggerLabel={`≥ ${usd(ESCALATION_LIQ_VOLUME_USD)}/min`}
        >
          {/* Where the money is being liquidated, largest first */}
          <div className="grid grid-cols-5 gap-px border border-white/10 bg-white/10 font-mono text-[10px] tabular-nums">
            {topMarkets.map((m) => (
              <div key={m} className="bg-black px-1.5 py-1">
                <div className="text-gray-500">{m.replace('-PERP', '')}</div>
                <div className="text-white">{usd(liqVolumeByMarket[m])}</div>
              </div>
            ))}
          </div>
        </Feed>
        <Feed
          title="Support Ticket Velocity (Tickets/Min)"
          unit="/min"
          value={metrics.ticketVelocity.toLocaleString('en-US')}
          delta={tktDelta}
          history={ticketVelocityHistory}
          threshold={ESCALATION_TICKET_VELOCITY}
          tripped={escalation.tickets}
          format={(v) => Math.round(v).toLocaleString('en-US')}
          triggerLabel={`≥ ${ESCALATION_TICKET_VELOCITY}/min`}
        >
          <div className="flex justify-between border border-white/10 px-1.5 py-1 font-mono text-[10px] tabular-nums">
            <span className="text-gray-500">
              open backlog <span className="text-white">{metrics.tickets.toLocaleString('en-US')}</span>
            </span>
            <span className="text-gray-500">
              per liquidation{' '}
              <span className="text-white">{metrics.liquidations ? (metrics.ticketVelocity / metrics.liquidations).toFixed(2) : '—'}</span>
            </span>
          </div>
        </Feed>
      </div>
    </section>
  )
}
