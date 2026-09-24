import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MARKET_LIST,
  formatMarketList,
  type ActionRecord,
  type Control,
  type Controls,
  type Market,
  type Metrics,
} from './use-incident-sim'

const clock = (ts?: number) =>
  ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''

const priceFmt = (market: Market, v: number) =>
  v.toLocaleString('en-US', {
    minimumFractionDigits: market === 'SOL-PERP' ? 2 : 1,
    maximumFractionDigits: market === 'SOL-PERP' ? 2 : 1,
  })

// Market | Liq/min | Δ | Mark | 24h | Status | Liquidations | Trading
// Below sm, Δ / Mark / 24h are hidden so the controls stay reachable at 390px.
const MATRIX_COLS =
  'grid grid-cols-[3.25rem_minmax(0,1fr)_minmax(0,1.4fr)_4.25rem_4.25rem] sm:grid-cols-[3.5rem_repeat(4,minmax(0,1fr))_minmax(0,1.5fr)_5rem_5rem] items-center gap-x-2'

const CONTROL_COPY: Record<Control, { run: string; running: string; resume: string; action: string }> = {
  pause: { run: 'Pause', running: 'Pausing', resume: 'Resume', action: 'margin liquidations' },
  halt: { run: 'Halt', running: 'Halting', resume: 'Resume', action: 'trading' },
}

function ControlButton({
  market,
  control,
  record,
  onToggle,
}: {
  market: Market
  control: Control
  record: ActionRecord
  onToggle: (market: Market, control: Control) => void
}) {
  const copy = CONTROL_COPY[control]
  const busy = record.status === 'executing'
  const on = record.status === 'executed'
  const verb = busy ? copy.running : on ? copy.resume : copy.run

  return (
    <button
      type="button"
      onClick={() => onToggle(market, control)}
      disabled={busy}
      aria-pressed={on}
      aria-label={`${verb} ${market} ${copy.action}`}
      className={cn(
        'flex h-7 w-full items-center justify-center gap-1 rounded-sm text-[11px] font-medium',
        'transition-colors duration-75 active:translate-y-px disabled:cursor-progress',
        busy
          ? 'bg-gray-800 text-gray-400'
          : on
            ? control === 'pause'
              ? 'border border-ok/60 text-ok hover:bg-ok/10 active:bg-ok/20'
              : 'border border-warn/60 text-warn hover:bg-warn/10 active:bg-warn/20'
            : control === 'pause'
              ? 'bg-white text-black hover:bg-gray-200 active:bg-gray-300'
              : 'bg-crit-fill text-white hover:bg-crit-fill-hover active:bg-[#9e0010]',
      )}
    >
      {busy && <Loader2 className="size-3 animate-spin" aria-hidden />}
      {verb}
    </button>
  )
}

function marketStatus(
  pause: ActionRecord,
  halt: ActionRecord,
  delta: number,
): { label: string; lamp: string; text: string; at?: number } {
  if (halt.status === 'executed') return { label: 'HALTED', lamp: 'bg-warn', text: 'text-warn', at: halt.at }
  if (pause.status === 'executed') return { label: 'PAUSED', lamp: 'bg-ok', text: 'text-ok', at: pause.at }
  if (pause.status === 'executing' || halt.status === 'executing')
    return { label: 'EXECUTING', lamp: 'bg-warn', text: 'text-warn' }
  if (delta > 0) return { label: 'CASCADING', lamp: 'bg-crit', text: 'text-crit' }
  return { label: 'LIVE', lamp: 'bg-gray-600', text: 'text-gray-400' }
}

function ControlMatrix({
  metrics,
  controls,
  onToggle,
}: {
  metrics: Metrics
  controls: Controls
  onToggle: (market: Market, control: Control) => void
}) {
  return (
    <div className="flex flex-col self-start rounded-sm border border-white/10 bg-panel">
      <div className="flex h-7 items-center justify-between border-b border-white/10 px-2.5">
        <h3 className="text-[12px] font-medium text-white">Market controls</h3>
        <span className="font-mono text-[10px] text-gray-500">each market independent</span>
      </div>

      <div role="table" aria-label="Per-market incident controls" className="font-mono text-[11px]">
        <div role="row" className={cn(MATRIX_COLS, 'h-6 border-b border-white/10 px-2.5 font-sans text-[10px] text-gray-500')}>
          <span role="columnheader">Market</span>
          <span role="columnheader" className="text-right">
            Liq/min
          </span>
          <span role="columnheader" className="hidden text-right sm:block">
            Δ tick
          </span>
          <span role="columnheader" className="hidden text-right sm:block">
            Mark
          </span>
          <span role="columnheader" className="hidden text-right sm:block">
            24h
          </span>
          <span role="columnheader" className="pl-2">
            Status
          </span>
          <span role="columnheader" className="text-center">
            Liquidations
          </span>
          <span role="columnheader" className="text-center">
            Trading
          </span>
        </div>

        {MARKET_LIST.map((m) => {
          const { pause, halt } = controls.markets[m]
          const liq = metrics.liqByMarket[m][metrics.liqByMarket[m].length - 1]
          const delta = metrics.liqDeltaByMarket[m]
          const dd = metrics.drawdownByMarket[m]
          const status = marketStatus(pause, halt, delta)
          return (
            <div
              key={m}
              role="row"
              className={cn(
                MATRIX_COLS,
                'min-h-10 border-b border-white/[0.06] px-2.5 py-1.5 last:border-b-0 tabular-nums',
                halt.status === 'executed' && 'bg-warn/[0.04]',
              )}
            >
              <span role="cell" className="font-semibold text-white">
                {m.replace('-PERP', '')}
              </span>
              <span role="cell" className={cn('text-right', status.label === 'CASCADING' ? 'text-crit' : 'text-white')}>
                {liq.toLocaleString('en-US')}
              </span>
              <span
                role="cell"
                className={cn('hidden text-right sm:block', delta > 0 ? 'text-crit' : delta < 0 ? 'text-ok' : 'text-gray-500')}
              >
                {delta > 0 ? '+' : delta < 0 ? '−' : '±'}
                {Math.abs(delta).toLocaleString('en-US')}
              </span>
              <span role="cell" className="hidden text-right text-white sm:block">
                {priceFmt(m, metrics.prices[m])}
              </span>
              <span role="cell" className={cn('hidden text-right sm:block', dd < 0 ? 'text-crit' : 'text-ok')}>
                {(dd * 100).toFixed(2)}%
              </span>
              <span
                role="cell"
                className="flex min-w-0 items-center gap-1.5 pl-2 text-[10px]"
                title={status.at ? `${status.label} since ${clock(status.at)}` : undefined}
              >
                <span className={cn('size-2 shrink-0', status.lamp)} aria-hidden />
                <span className={status.text}>{status.label}</span>
              </span>
              <span role="cell">
                <ControlButton market={m} control="pause" record={pause} onToggle={onToggle} />
              </span>
              <span role="cell">
                <ControlButton market={m} control="halt" record={halt} onToggle={onToggle} />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function draftMessage(metrics: Metrics, isPaused: Record<Market, boolean>, isHalted: Record<Market, boolean>) {
  const halted = MARKET_LIST.filter((m) => isHalted[m])
  const paused = MARKET_LIST.filter((m) => isPaused[m] && !isHalted[m])
  const parts = [
    `We're investigating a sharp drop across perpetual markets that triggered elevated liquidations (${metrics.liquidations.toLocaleString('en-US')}/min).`,
  ]
  if (halted.length) parts.push(`Trading is halted on ${formatMarketList(halted)} while we stabilize.`)
  if (paused.length)
    parts.push(`Margin liquidations are paused on ${formatMarketList(paused)}; no positions there are being force-closed.`)
  parts.push('Funds are safe. Next update in 15 minutes.')
  return parts.join(' ')
}

function BroadcastPanel({
  record,
  message,
  onBroadcast,
}: {
  record: ActionRecord
  message: string
  onBroadcast: () => void
}) {
  const busy = record.status === 'executing'
  const sent = record.status === 'executed'
  return (
    <div className={cn('flex flex-col rounded-sm border bg-panel', sent ? 'border-ok/60' : 'border-white/10')}>
      <div className="flex h-7 items-center justify-between border-b border-white/10 px-2.5">
        <h3 className="min-w-0 truncate text-[12px] font-medium text-white">Broadcast incident status</h3>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px]">
          <span className={cn('size-2', sent ? 'bg-ok' : busy ? 'bg-warn' : 'bg-gray-700')} aria-hidden />
          <span className={sent ? 'text-ok' : busy ? 'text-warn' : 'text-gray-500'}>
            {sent ? `#${record.count} SENT ${clock(record.at)}` : busy ? 'EXECUTING' : 'STANDBY'}
          </span>
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <p className="text-[12px] leading-snug text-gray-400">Status page, in-app banner and @MochaTradeStatus. All markets.</p>
        <div className="rounded-sm border border-white/10 bg-black px-2 py-1.5 font-mono text-[11px] leading-snug text-gray-300">
          <span className="mb-0.5 block text-[10px] text-gray-500">Draft #{record.count + 1}</span>
          {message}
        </div>
        <button
          type="button"
          onClick={onBroadcast}
          disabled={busy}
          className={cn(
            'mt-auto flex h-8 w-full items-center justify-center gap-2 rounded-sm text-[12px] font-medium',
            'transition-colors duration-75 active:translate-y-px disabled:cursor-progress',
            busy ? 'bg-gray-800 text-gray-400' : 'bg-white text-black hover:bg-gray-200 active:bg-gray-300',
          )}
        >
          {busy && <Loader2 className="size-3 animate-spin" aria-hidden />}
          {busy ? 'Sending' : sent ? 'Send new update' : 'Send status update'}
        </button>
      </div>
    </div>
  )
}

export function ActionGrid({
  metrics,
  controls,
  isPaused,
  isHalted,
  onToggle,
  onBroadcast,
}: {
  metrics: Metrics
  controls: Controls
  isPaused: Record<Market, boolean>
  isHalted: Record<Market, boolean>
  onToggle: (market: Market, control: Control) => void
  onBroadcast: () => void
}) {
  return (
    <section aria-labelledby="actions-heading">
      <div className="mb-1.5 flex items-baseline justify-between">
        <h2 id="actions-heading" className="text-[12px] font-medium text-gray-400">
          Response actions
        </h2>
        <span className="hidden font-mono text-[10px] text-gray-500 sm:inline">logged to INC-2417</span>
      </div>
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,5fr)_minmax(0,3fr)]">
        <ControlMatrix metrics={metrics} controls={controls} onToggle={onToggle} />
        <BroadcastPanel
          record={controls.broadcast}
          message={draftMessage(metrics, isPaused, isHalted)}
          onBroadcast={onBroadcast}
        />
      </div>
    </section>
  )
}
