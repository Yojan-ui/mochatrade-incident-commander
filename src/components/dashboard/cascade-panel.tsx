import { Suspense, lazy } from 'react'
import { cn } from '@/lib/utils'
import { ControlButton, marketStatus } from './action-grid'
import type { LaneState } from './cascade-dynamics'
import { REPLAY_LENGTH, fmtPrice, usd, type Control, type Controls, type Market, type Metrics } from './use-incident-sim'

// three.js only loads when an asset tab is opened, keeping it out of the main bundle
const CascadeGraph3D = lazy(() => import('./cascade-graph-3d'))

const LEGEND = [
  { swatch: 'bg-[#22c55e]', label: 'healthy' },
  { swatch: 'bg-[#eab308]', label: 'thinning' },
  { swatch: 'bg-[#ef4444]', label: 'ravine' },
  { swatch: 'bg-[#06b6d4]', label: 'breaker' },
]

function Readout({ label, children, tone }: { label: string; children: string; tone?: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-gray-500">{label} </span>
      <span className={tone ?? 'text-white'}>{children}</span>
    </span>
  )
}

/** Focused single-asset view: the LOB surface plus that asset's own breaker controls */
export function CascadePanel({
  assetId,
  metrics,
  controls,
  state,
  onToggle,
  id,
  labelledBy,
}: {
  assetId: Market
  metrics: Metrics
  controls: Controls
  state: LaneState
  onToggle: (market: Market, control: Control) => void
  id: string
  labelledBy: string
}) {
  // The same replay tick driving the surface's uSeverity
  const liq = metrics.liqByMarket[assetId][metrics.liqByMarket[assetId].length - 1]
  const dd = metrics.drawdownByMarket[assetId]
  const { pause, halt } = controls.markets[assetId]
  const status = marketStatus(pause, halt, metrics.liqDeltaByMarket[assetId])

  return (
    <section id={id} role="tabpanel" aria-labelledby={labelledBy} className="rounded-sm border border-white/10 bg-panel">
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-white/10 px-2.5 py-1 font-mono text-[11px] tabular-nums">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="font-sans font-medium text-white">{assetId} bid-side order book</span>
          <Readout
            label="replay"
            tone={metrics.replayPhase === 'PRE-CRASH' ? 'text-[#22c55e]' : 'text-[#ef4444]'}
          >
            {`tick ${String(metrics.replayTick).padStart(3, '0')}/${REPLAY_LENGTH} ${metrics.replayPhase}`}
          </Readout>
          <Readout
            label="severity"
            tone={state !== 'live' ? 'text-[#06b6d4]' : metrics.severity >= 0.5 ? 'text-[#ef4444]' : 'text-white'}
          >
            {state !== 'live' ? '0.00 BREAKER' : metrics.severity.toFixed(2)}
          </Readout>
          <Readout label="hist liq vol">{`${usd(metrics.liquidationVol)}/min`}</Readout>
          <Readout label="stress">{`${metrics.stressByMarket[assetId].toFixed(2)}×`}</Readout>
          <Readout label="liq/min">{liq.toLocaleString('en-US')}</Readout>
          <Readout label="mark">{fmtPrice(assetId, metrics.prices[assetId])}</Readout>
          <Readout label="24h" tone={dd < 0 ? 'text-crit' : 'text-ok'}>{`${(dd * 100).toFixed(2)}%`}</Readout>
        </span>
        <span className="flex items-center gap-3 text-[10px] text-gray-500">
          {LEGEND.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className={cn('size-2', l.swatch)} aria-hidden />
              {l.label}
            </span>
          ))}
        </span>
      </div>

      <Suspense fallback={<div className="h-[300px] bg-black md:h-[400px]" />}>
        <CascadeGraph3D assetId={assetId} metrics={metrics} state={state} className="h-[300px] w-full md:h-[400px]" />
      </Suspense>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-2.5 py-1.5">
        <span className="flex items-center gap-2 font-mono text-[11px]">
          <span className="text-gray-500">circuit breaker</span>
          <span className={cn('size-2', status.lamp)} aria-hidden />
          <span className={status.text}>{status.label}</span>
        </span>
        <span className="flex gap-2">
          <span className="w-40">
            <ControlButton market={assetId} control="pause" record={pause} onToggle={onToggle} />
          </span>
          <span className="w-40">
            <ControlButton market={assetId} control="halt" record={halt} onToggle={onToggle} />
          </span>
        </span>
      </div>
    </section>
  )
}
